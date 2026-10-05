import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import {
  createPrismaClient,
  databaseNow,
  listActiveTenantIds,
  pendingAuditSummaryDays,
  type PrismaClient,
  readAuditAnomalySettings,
  summarizeAuditDay,
  withTenant,
} from '@simrs/db';
import { WORKER_ENV, type WorkerEnv } from '../config/env';

export interface SummaryRunSummary {
  tenants: number;
  /** Ringkasan hari yang baru ditulis. */
  created: number;
  failed: number;
}

/** Jendela layar temuan maks. 90 hari (hari ini selalu dihitung langsung). */
const LOOKBACK_DAYS = 90;
/** Hari dianggap final 10 menit setelah 00.00 WIB (transaksi menjelang tengah malam sudah commit). */
const SETTLE_MS = 10 * 60_000;
/** Batas hari per tenant per putaran: cukup untuk mengisi ulang seluruh jendela setelah jam malam diubah. */
const MAX_DAYS_PER_RUN = LOOKBACK_DAYS;

/**
 * P04 · Job ringkasan harian temuan anomali (ADR-0072). Per tenant aktif: tanggal WIB yang sudah final dalam 90 hari
 * terakhir dan belum punya ringkasan dengan parameter sekarang dihitung, terbaru dulu. Idempoten (ringkasan per
 * tenant × hari × parameter unik, append-only); aman dijalankan ulang atau bersamaan.
 */
@Injectable()
export class AuditSummaryJob implements OnModuleDestroy {
  private readonly logger = new Logger(AuditSummaryJob.name);
  readonly prisma: PrismaClient;

  constructor(@Inject(WORKER_ENV) env: WorkerEnv) {
    this.prisma = createPrismaClient({ connectionString: env.DATABASE_URL, max: 2 });
  }

  async runOnce(
    opts: { tenantIds?: string[]; now?: Date; maxDays?: number } = {},
  ): Promise<SummaryRunSummary> {
    const tenantIds = opts.tenantIds ?? (await listActiveTenantIds(this.prisma));
    const summary: SummaryRunSummary = { tenants: tenantIds.length, created: 0, failed: 0 };
    for (const tenantId of tenantIds) {
      try {
        summary.created += await this.summarizeTenant(tenantId, opts.now, opts.maxDays ?? MAX_DAYS_PER_RUN);
      } catch (err) {
        summary.failed += 1;
        this.logger.error(
          `ringkasan audit tenant ${tenantId} gagal: ${err instanceof Error ? err.name : 'error'}`,
        );
      }
    }
    return summary;
  }

  /** Satu tenant (dipanggil job berkala P11 `audit.daily-summary`); mengembalikan jumlah hari yang ditulis. */
  async summarizeTenant(tenantId: string, now?: Date, maxDays = MAX_DAYS_PER_RUN): Promise<number> {
    const { settings, days } = await withTenant(this.prisma, tenantId, async (tx) => {
      const s = await readAuditAnomalySettings(tx);
      const at = now ?? (await databaseNow(tx));
      return {
        settings: s,
        days: await pendingAuditSummaryDays(tx, s, {
          now: at,
          lookbackDays: LOOKBACK_DAYS,
          settleMs: SETTLE_MS,
        }),
      };
    });
    let created = 0;
    // Terbaru dulu: layar paling sering membuka 7–30 hari terakhir.
    for (const day of days.reverse().slice(0, maxDays)) {
      const r = await withTenant(
        this.prisma,
        tenantId,
        (tx) => summarizeAuditDay(tx, tenantId, day, settings),
        {
          timeoutMs: 120_000,
        },
      );
      if (r.created) created += 1;
    }
    return created;
  }

  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
  }
}
