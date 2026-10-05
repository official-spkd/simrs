import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import {
  createPrismaClient,
  KeyRotationBlockedError,
  listKeyRotationTenantIds,
  type PrismaClient,
  rotateTenantKeys,
  type TenantKeyRotationReport,
} from '@simrs/db';
import { WORKER_ENV, type WorkerEnv } from '../config/env';

export interface KeyRotationRunSummary {
  /** `single_key` = cincin hanya berisi kunci aktif: tidak ada yang perlu diputar. */
  skipped?: 'single_key';
  tenants: number;
  rewritten: number;
  failed: number;
  /** Tenant yang dihentikan pemeriksaan awal (gagal tertutup), dengan kode masalahnya. */
  blocked: Array<{ tenantId: string; codes: string[] }>;
  reports: TenantKeyRotationReport[];
  interrupted: boolean;
}

/** Jeda sebelum putaran pertama setelah worker hidup (biarkan API/worker lain siap dulu). */
const FIRST_RUN_DELAY_MS = 30_000;

/**
 * P05 · Job enkripsi ulang kolom (rotasi kunci v2, ADR-0015 pembaruan 5 Okt 2026).
 *
 * `FIELD_KEY_ROTATION=auto`: selama cincin `FIELD_ENCRYPTION_KEYS`/`FIELD_HASH_KEYS` masih memuat kunci lama,
 * worker menjalankan satu putaran per `FIELD_KEY_ROTATION_INTERVAL_MINUTES` untuk semua tenant (juga nonaktif).
 * Tiap putaran memakai batch pendek + jeda dan kursor di `field_key_rotations`, sehingga worker yang berhenti di
 * tengah melanjutkan dari batch terakhir. Beberapa worker aman berjalan bersamaan (baris status dikunci per batch).
 * Operator bisa menjalankan hal yang sama kapan saja lewat `pnpm db:rotate-keys --run`.
 *
 * Log hanya berisi ID tenant, nama tabel, kode galat, dan hitungan: tidak pernah nilai atau kunci.
 */
@Injectable()
export class KeyRotationJob implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('KeyRotation');
  readonly prisma: PrismaClient;
  private readonly abort = new AbortController();
  private timer?: NodeJS.Timeout;
  private running?: Promise<KeyRotationRunSummary>;

  constructor(@Inject(WORKER_ENV) private readonly env: WorkerEnv) {
    this.prisma = createPrismaClient({ connectionString: env.DATABASE_URL, max: 2 });
  }

  onApplicationBootstrap(): void {
    if (this.env.NODE_ENV === 'test' || this.env.FIELD_KEY_ROTATION !== 'auto') return;
    this.schedule(FIRST_RUN_DELAY_MS);
    this.logger.log(
      `Rotasi kunci otomatis aktif · tiap ${this.env.FIELD_KEY_ROTATION_INTERVAL_MINUTES} menit, batch ${this.env.FIELD_KEY_ROTATION_BATCH}`,
    );
  }

  private schedule(delayMs: number): void {
    this.timer = setTimeout(() => {
      void this.runOnce()
        .catch((err: unknown) =>
          this.logger.error(`putaran rotasi kunci gagal: ${err instanceof Error ? err.name : 'error'}`),
        )
        .finally(() => {
          if (!this.abort.signal.aborted) {
            this.schedule(this.env.FIELD_KEY_ROTATION_INTERVAL_MINUTES * 60_000);
          }
        });
    }, delayMs);
  }

  /** Satu putaran untuk semua tenant (atau `tenantIds`); putaran yang sedang berjalan tidak digandakan. */
  runOnce(opts: { tenantIds?: string[]; signal?: AbortSignal } = {}): Promise<KeyRotationRunSummary> {
    this.running ??= this.run(opts).finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  private async run(opts: { tenantIds?: string[]; signal?: AbortSignal }): Promise<KeyRotationRunSummary> {
    const keys = this.env.fieldKeys;
    const summary: KeyRotationRunSummary = {
      tenants: 0,
      rewritten: 0,
      failed: 0,
      blocked: [],
      reports: [],
      interrupted: false,
    };
    if (keys.enc.ids.length === 1 && keys.hash.ids.length === 1) return { ...summary, skipped: 'single_key' };
    const signal = opts.signal ? AbortSignal.any([opts.signal, this.abort.signal]) : this.abort.signal;
    const tenantIds = opts.tenantIds ?? (await listKeyRotationTenantIds(this.prisma));
    for (const tenantId of tenantIds) {
      if (signal.aborted) {
        summary.interrupted = true;
        break;
      }
      summary.tenants += 1;
      try {
        const r = await rotateTenantKeys(this.prisma, tenantId, keys, {
          batchSize: this.env.FIELD_KEY_ROTATION_BATCH,
          pauseMs: this.env.FIELD_KEY_ROTATION_PAUSE_MS,
          signal,
        });
        summary.reports.push(r);
        const rewritten = r.targets.reduce((n, t) => n + t.rewritten, 0);
        const failed = r.targets.reduce((n, t) => n + t.failed, 0);
        summary.rewritten += rewritten;
        summary.failed += failed;
        summary.interrupted ||= r.interrupted;
        if (rewritten + failed > 0) {
          const remaining = r.targets.reduce((n, t) => n + (t.remaining ?? 0), 0);
          this.logger.log(
            `rotasi kunci tenant ${tenantId} → ${r.encKeyId}/${r.hashKeyId}: ditulis ulang ${rewritten}, gagal ${failed}, sisa ${remaining}`,
          );
        }
      } catch (err) {
        if (!(err instanceof KeyRotationBlockedError)) throw err;
        summary.blocked.push({ tenantId, codes: err.problems.map((p) => p.code) });
        this.logger.error(err.message);
      }
    }
    return summary;
  }

  async onModuleDestroy(): Promise<void> {
    this.abort.abort();
    if (this.timer) clearTimeout(this.timer);
    await this.running?.catch(() => undefined);
    await this.prisma.$disconnect();
  }
}
