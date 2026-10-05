import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import {
  createPrismaClient,
  isModuleEnabled,
  listActiveTenantIds,
  type PrismaClient,
  withTenant,
} from '@simrs/db';
import { APP_TIME_ZONE, jakartaParts } from '@simrs/shared';
import { Queue, type RepeatOptions, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import { WORKER_ENV, type WorkerEnv } from '../config/env';
import { bullConnection, resolveSchedulerMode, type SchedulerMode } from '../infra/scheduler-mode';
import {
  PERIODIC_JOB_REGISTRY,
  type PeriodicJob,
  type PeriodicRunSummary,
  type PeriodicSchedule,
} from './periodic-jobs';

export const PERIODIC_QUEUE = 'periodic';
/** Selang minimum: job berkala bukan pengganti outbox (yang sudah berputar tiap 2 detik). */
export const MIN_PERIODIC_EVERY_MS = 10_000;
/** Selang maksimum; jadwal lebih jarang memakai `dailyAt`. */
export const MAX_PERIODIC_EVERY_MS = 24 * 60 * 60_000;

const JOB_NAME = /^[a-z][a-z0-9-]*(\.[a-z0-9-]+)+$/;
const DAILY_AT = /^([01]\d|2[0-3]):([0-5]\d)$/;
const WIB_OFFSET_HOURS = 7;

/** Validasi peta job saat start (gagal cepat bila nama/jadwal salah). */
export function assertValidJobs(jobs: ReadonlyMap<string, PeriodicJob>): void {
  for (const [name, job] of jobs) {
    if (!JOB_NAME.test(name)) throw new Error(`Nama job berkala tidak valid: ${name} (pola <konteks>.<job>)`);
    const s = job.schedule;
    if ('everyMs' in s) {
      if (
        !Number.isInteger(s.everyMs) ||
        s.everyMs < MIN_PERIODIC_EVERY_MS ||
        s.everyMs > MAX_PERIODIC_EVERY_MS
      ) {
        throw new Error(`Jadwal job ${name}: everyMs ${MIN_PERIODIC_EVERY_MS}–${MAX_PERIODIC_EVERY_MS}`);
      }
    } else if (!DAILY_AT.test(s.dailyAt)) {
      throw new Error(`Jadwal job ${name}: dailyAt harus HH:MM (WIB)`);
    }
  }
}

/** Kejadian berikutnya `HH:MM` WIB yang lebih besar dari `after`. */
export function nextDailyRun(dailyAt: string, after: Date): Date {
  const m = DAILY_AT.exec(dailyAt);
  if (!m) throw new Error(`dailyAt harus HH:MM: ${dailyAt}`);
  const [hour, minute] = [Number(m[1]), Number(m[2])];
  const p = jakartaParts(after);
  const at = (dayOffset: number) =>
    new Date(Date.UTC(p.year, p.month - 1, p.day + dayOffset, hour - WIB_OFFSET_HOURS, minute));
  const today = at(0);
  return today.getTime() > after.getTime() ? today : at(1);
}

/** Jadwal → opsi repeat BullMQ: selang tetap, atau cron harian ber-zona Asia/Jakarta. */
export function repeatOptions(schedule: PeriodicSchedule): Omit<RepeatOptions, 'key'> {
  if ('everyMs' in schedule) return { every: schedule.everyMs };
  const [hour, minute] = schedule.dailyAt.split(':').map(Number);
  return { pattern: `${minute} ${hour} * * *`, tz: APP_TIME_ZONE };
}

const schedulerId = (name: string) => `periodic:${name}`;

/**
 * P11 minimal · job berkala per tenant. Dengan Redis: satu job scheduler BullMQ per job (antrean `periodic`,
 * concurrency 1, sehingga satu job berjalan di satu worker pada satu waktu meski worker lebih dari satu); jadwal
 * yang sudah tidak ada di peta dihapus saat start. Tanpa Redis di luar produksi: timer di proses ini (job
 * dijalankan berurutan), sama dengan `OUTBOX_SCHEDULER=auto`.
 * Tiap putaran memanggil job sekali per tenant aktif; galat satu tenant dicatat dan tidak menghentikan tenant lain.
 */
@Injectable()
export class PeriodicScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(PeriodicScheduler.name);
  private prisma?: PrismaClient;
  private connection?: Redis;
  private queue?: Queue;
  private worker?: Worker;
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private serial: Promise<unknown> = Promise.resolve();
  private stopped = false;

  constructor(
    @Inject(WORKER_ENV) private readonly env: WorkerEnv,
    @Inject(PERIODIC_JOB_REGISTRY) private readonly jobs: ReadonlyMap<string, PeriodicJob>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.env.NODE_ENV === 'test') return; // tes memanggil start() sendiri
    await this.start();
  }

  /** Klien DB dibuat saat pertama dibutuhkan: peta kosong = tidak ada koneksi tambahan. */
  private db(): PrismaClient {
    this.prisma ??= createPrismaClient({ connectionString: this.env.DATABASE_URL, max: 2 });
    return this.prisma;
  }

  async start(): Promise<SchedulerMode> {
    assertValidJobs(this.jobs);
    const mode = await resolveSchedulerMode(this.env);
    if (mode === 'interval') {
      for (const [name, job] of this.jobs) this.arm(name, job, true);
      if (this.jobs.size > 0) {
        this.logger.warn(`Redis tidak dipakai: ${this.jobs.size} job berkala memakai timer (pengembangan).`);
      }
      return mode;
    }

    this.connection = bullConnection(this.env);
    const prefix = this.env.BULLMQ_PREFIX;
    this.queue = new Queue(PERIODIC_QUEUE, { connection: this.connection, prefix });
    for (const [name, job] of this.jobs) {
      await this.queue.upsertJobScheduler(schedulerId(name), repeatOptions(job.schedule), {
        name,
        data: {},
        opts: { removeOnComplete: 100, removeOnFail: 100 },
      });
    }
    // Job yang dihapus dari peta tidak boleh terus menumpuk di antrean.
    const wanted = new Set([...this.jobs.keys()].map(schedulerId));
    for (const s of await this.queue.getJobSchedulers()) {
      if (!wanted.has(s.key)) await this.queue.removeJobScheduler(s.key);
    }
    if (this.jobs.size === 0) return mode;
    this.worker = new Worker(
      PERIODIC_QUEUE,
      async (job) => {
        if (!this.jobs.has(job.name)) return null;
        // Waktu jadwal (dibuat + jeda tunda), bukan waktu mulai, sebagai "sekarang" job.
        return this.runJob(job.name, { now: new Date(job.timestamp + (job.opts.delay ?? 0)) });
      },
      { connection: this.connection, prefix, concurrency: 1 },
    );
    this.worker.on('failed', (job, err) =>
      this.logger.error(`job berkala ${job?.name ?? '?'} gagal: ${err.name}`),
    );
    this.logger.log(`Job berkala aktif (BullMQ): ${[...this.jobs.keys()].join(', ')}`);
    return mode;
  }

  /**
   * Jalankan satu job untuk semua tenant aktif (atau `tenantIds`), berurutan per tenant. Galat per tenant dicatat
   * dan dihitung, tidak dilempar.
   */
  async runJob(name: string, opts: { now?: Date; tenantIds?: string[] } = {}): Promise<PeriodicRunSummary> {
    const job = this.jobs.get(name);
    if (!job) throw new Error(`Job berkala tidak dikenal: ${name}`);
    const now = opts.now ?? new Date();
    const db = this.db();
    const tenantIds = opts.tenantIds ?? (await listActiveTenantIds(db));
    const summary: PeriodicRunSummary = {
      job: name,
      tenants: tenantIds.length,
      ok: 0,
      skipped: 0,
      failed: 0,
    };
    for (const tenantId of tenantIds) {
      try {
        const moduleCode = job.module;
        if (moduleCode && !(await withTenant(db, tenantId, (tx) => isModuleEnabled(tx, moduleCode)))) {
          summary.skipped += 1;
          continue;
        }
        await job.run({ tenantId, now, tx: (fn) => withTenant(db, tenantId, fn) });
        summary.ok += 1;
      } catch (err) {
        summary.failed += 1;
        // Tanpa pesan galat (bisa memuat data): nama galat cukup untuk alarm, rinciannya di log job sendiri.
        this.logger.error(
          `job berkala ${name} gagal untuk tenant ${tenantId}: ${err instanceof Error ? err.name : 'Error'}`,
        );
      }
    }
    return summary;
  }

  /** Timer berantai per job; semua job lewat satu antrean janji agar berjalan berurutan seperti di BullMQ. */
  private arm(name: string, job: PeriodicJob, first = false): void {
    if (this.stopped) return;
    const s = job.schedule;
    const now = new Date();
    const due =
      'everyMs' in s ? new Date(now.getTime() + (first ? 0 : s.everyMs)) : nextDailyRun(s.dailyAt, now);
    const timer = setTimeout(() => {
      this.serial = this.serial
        .then(() => this.runJob(name, { now: due }))
        .catch((err: unknown) =>
          this.logger.error(`job berkala ${name} gagal: ${err instanceof Error ? err.name : 'Error'}`),
        )
        .finally(() => this.arm(name, job));
    }, due.getTime() - now.getTime());
    this.timers.set(name, timer);
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    for (const t of this.timers.values()) clearTimeout(t);
    await this.worker?.close();
    await this.queue?.close();
    this.connection?.disconnect();
    await this.prisma?.$disconnect();
  }
}
