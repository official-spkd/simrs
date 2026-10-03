import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import {
  claimDueOutbox,
  createPrismaClient,
  listActiveTenantIds,
  type PrismaClient,
  recordOutboxAttempt,
  withTenant,
} from '@simrs/db';
import { WORKER_ENV, type WorkerEnv } from '../config/env';
import { HttpConnector } from './http-connector';

export interface DispatchSummary {
  tenants: number;
  claimed: number;
  sent: number;
  failed: number;
  dead: number;
}

export interface DispatchOptions {
  now?: Date;
  maxAttempts?: number;
}

/**
 * Prosesor outbox generik (ADR-0003, ADR-0008):
 * 1. ambil daftar tenant aktif (fungsi SECURITY DEFINER sempit),
 * 2. per tenant: klaim pesan jatuh tempo dalam transaksi singkat (RLS aktif),
 * 3. kirim HTTP di LUAR transaksi,
 * 4. catat hasil dalam transaksi baru: terkirim, dijadwalkan ulang (backoff), atau DLQ (`dead`).
 */
@Injectable()
export class OutboxDispatcher implements OnModuleDestroy {
  private readonly logger = new Logger(OutboxDispatcher.name);
  readonly prisma: PrismaClient;

  constructor(
    @Inject(WORKER_ENV) private readonly env: WorkerEnv,
    private readonly connector: HttpConnector,
  ) {
    this.prisma = createPrismaClient({ connectionString: env.DATABASE_URL, max: 5 });
  }

  async dispatchOnce(opts: DispatchOptions = {}): Promise<DispatchSummary> {
    const summary: DispatchSummary = { tenants: 0, claimed: 0, sent: 0, failed: 0, dead: 0 };
    const tenantIds = await listActiveTenantIds(this.prisma);
    summary.tenants = tenantIds.length;
    for (const tenantId of tenantIds) {
      const claimed = await withTenant(this.prisma, tenantId, (tx) =>
        claimDueOutbox(tx, this.env.OUTBOX_BATCH_SIZE, opts.now ?? new Date()),
      );
      summary.claimed += claimed.length;
      for (const msg of claimed) {
        const result = await this.connector.send(msg);
        const updated = await withTenant(this.prisma, tenantId, (tx) =>
          recordOutboxAttempt(tx, msg, result, { now: opts.now, maxAttempts: opts.maxAttempts }),
        );
        if (updated.status === 'sent') summary.sent += 1;
        else if (updated.status === 'dead') {
          summary.dead += 1;
          // Alarm DLQ: tanpa payload (bisa memuat PHI), hanya ID dan sebab.
          this.logger.warn(
            `DLQ: outbox ${msg.id} (tenant ${tenantId}, ${msg.target}/${msg.operation}) · ${updated.lastError}`,
          );
        } else summary.failed += 1;
      }
    }
    return summary;
  }

  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
  }
}
