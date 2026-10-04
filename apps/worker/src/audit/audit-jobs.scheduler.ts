import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { WORKER_ENV, type WorkerEnv } from '../config/env';
import { AUDIT_ANCHOR_STORE, type AuditAnchorStore } from './anchor-store';
import { AuditAnchorJob } from './audit-anchor.job';
import { AuditSummaryJob } from './audit-summary.job';

export const AUDIT_JOBS_QUEUE = 'audit-jobs';

/**
 * Jadwal job P04 (ADR-0072), zona Asia/Jakarta: jangkar tiap jam di menit 00, ringkasan harian tiap jam di menit 20
 * (mengisi hari yang belum diringkas; tidak berbuat apa-apa bila sudah lengkap). Dibuat terpisah dan tipis agar mudah
 * dipindah ke registri job berkala P11 bila sudah ada.
 */
export const AUDIT_JOB_SCHEDULES = {
  anchor: { id: 'audit-anchor-hourly', pattern: '0 * * * *' },
  summarize: { id: 'audit-summary-hourly', pattern: '20 * * * *' },
} as const;
const INTERVAL_MS = 60 * 60_000;

/**
 * Penjadwal BullMQ (job scheduler, satu eksekusi per jadwal walau worker lebih dari satu; concurrency 1). Mode
 * mengikuti `OUTBOX_SCHEDULER`: tanpa Redis di luar produksi → timer di proses ini (tiap jam sejak start).
 */
@Injectable()
export class AuditJobsScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(AuditJobsScheduler.name);
  private connection?: Redis;
  private queue?: Queue;
  private worker?: Worker;
  private timer?: NodeJS.Timeout;
  private stopped = false;

  constructor(
    @Inject(WORKER_ENV) private readonly env: WorkerEnv,
    @Inject(AUDIT_ANCHOR_STORE) private readonly store: AuditAnchorStore | null,
    private readonly anchors: AuditAnchorJob,
    private readonly summaries: AuditSummaryJob,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.env.NODE_ENV === 'test') return; // tes memanggil runOnce() sendiri
    await this.start();
  }

  /**
   * `firstRunDelayMs` (mode timer saja): putaran pertama baru setelah satu interval, agar worker yang baru menyala
   * (pengembangan, E2E) tidak langsung meringkas 90 hari semua tenant DB tes. Tes memberi 0.
   */
  async start(opts: { firstRunDelayMs?: number } = {}): Promise<void> {
    if (!this.anchors.enabled) {
      this.logger.warn(
        'AUDIT_ANCHOR_KEY kosong: jangkar hash audit tidak ditulis (hanya boleh di luar produksi).',
      );
    }
    if (this.store) {
      await this.store.assertWorm().catch((err: unknown) => {
        this.logger.error(
          `bucket WORM jangkar audit tidak siap: ${err instanceof Error ? err.message : 'error'}`,
        );
      });
    } else if (this.anchors.enabled) {
      this.logger.warn(
        'AUDIT_ANCHOR_BUCKET kosong: jangkar audit hanya di database (hanya boleh di luar produksi).',
      );
    }
    const mode = this.env.OUTBOX_SCHEDULER;
    if (
      mode === 'interval' ||
      (mode === 'auto' && this.env.APP_ENV !== 'production' && !(await this.redisReachable()))
    ) {
      this.startInterval(opts.firstRunDelayMs ?? INTERVAL_MS);
      return;
    }
    this.connection = new Redis(this.env.REDIS_URL, { maxRetriesPerRequest: null });
    // Awalan per database: semua instans worker satu deployment berbagi jadwal (satu eksekusi), sedangkan worker
    // pengembangan/E2E/worktree lain yang memakai Redis yang sama tidak saling mengambil job (DB-nya berbeda).
    const prefix = `bull:${new URL(this.env.DATABASE_URL).pathname.slice(1) || 'simrs'}`;
    this.queue = new Queue(AUDIT_JOBS_QUEUE, { connection: this.connection, prefix });
    for (const [name, s] of Object.entries(AUDIT_JOB_SCHEDULES)) {
      await this.queue.upsertJobScheduler(
        s.id,
        { pattern: s.pattern, tz: 'Asia/Jakarta' },
        { name, data: {}, opts: { removeOnComplete: 100, removeOnFail: 100 } },
      );
    }
    this.worker = new Worker(AUDIT_JOBS_QUEUE, (job) => this.run(job.name), {
      connection: this.connection,
      prefix,
      concurrency: 1,
    });
    this.worker.on('failed', (job, err) => this.logger.error(`job ${job?.name ?? '?'} gagal: ${err.name}`));
    this.logger.log('Job audit aktif · jangkar tiap jam, ringkasan harian');
  }

  /** Satu putaran job menurut nama; dipakai BullMQ dan timer. */
  async run(name: string): Promise<unknown> {
    if (name === 'anchor') {
      const r = await this.anchors.runOnce();
      if (r.anchored > 0 || r.failed > 0) {
        this.logger.log(`jangkar audit: ${r.anchored} tenant dijangkar, ${r.failed} gagal`);
      }
      return { tenants: r.tenants, anchored: r.anchored, failed: r.failed };
    }
    if (name === 'summarize') {
      const r = await this.summaries.runOnce();
      if (r.created > 0 || r.failed > 0) {
        this.logger.log(`ringkasan audit: ${r.created} hari ditulis, ${r.failed} tenant gagal`);
      }
      return r;
    }
    return null;
  }

  private async redisReachable(): Promise<boolean> {
    const probe = new Redis(this.env.REDIS_URL, {
      lazyConnect: true,
      connectTimeout: 1000,
      maxRetriesPerRequest: 0,
      retryStrategy: () => null,
    });
    try {
      await probe.connect();
      await probe.ping();
      return true;
    } catch {
      return false;
    } finally {
      probe.disconnect();
    }
  }

  /** Timer tanpa tumpang tindih (pengembangan tanpa Redis): tiap jam sejak start. */
  private startInterval(firstRunDelayMs: number): void {
    const tick = async () => {
      for (const name of Object.keys(AUDIT_JOB_SCHEDULES)) {
        if (this.stopped) return;
        try {
          await this.run(name);
        } catch (err) {
          this.logger.error(`job audit ${name} gagal: ${err instanceof Error ? err.name : 'error'}`);
        }
      }
      if (!this.stopped) this.timer = setTimeout(tick, INTERVAL_MS);
    };
    this.timer = setTimeout(tick, firstRunDelayMs);
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    await this.worker?.close();
    await this.queue?.close();
    this.connection?.disconnect();
  }
}
