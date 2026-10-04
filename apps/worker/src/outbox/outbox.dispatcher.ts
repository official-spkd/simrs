import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import {
  claimDueOutbox,
  createPrismaClient,
  listActiveTenantIds,
  type OutboxMessage,
  type PrismaClient,
  recordOutboxAttempt,
  withTenant,
} from '@simrs/db';
import { PatientCrypto } from '@simrs/shared/node';
import { WORKER_ENV, type WorkerEnv } from '../config/env';
import { HttpConnector, type SendResult } from './http-connector';
import { type OperationContext, OUTBOX_OPERATIONS, PermanentOperationError } from './operations';

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
  /** Batasi ke tenant tertentu (tes paralel tidak saling mengambil pesan); bawaan semua tenant aktif. */
  tenantIds?: string[];
}

const errorName = (err: unknown) => (err instanceof Error ? err.name : 'Error');

/**
 * Prosesor outbox generik (ADR-0003, ADR-0008):
 * 1. ambil daftar tenant aktif (fungsi SECURITY DEFINER sempit),
 * 2. per tenant: klaim pesan jatuh tempo dalam transaksi singkat (RLS aktif),
 * 3. siapkan permintaan (operasi boleh membaca DB tenant, mis. mendekripsi NIK), lalu kirim HTTP di LUAR
 *    transaksi,
 * 4. catat hasil dalam transaksi baru: terkirim (+ proses respons secara atomik), dijadwalkan ulang (backoff),
 *    atau DLQ (`dead`).
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

  private context(tenantId: string): OperationContext {
    return {
      tenantId,
      read: (fn) => withTenant(this.prisma, tenantId, fn),
      crypto: new PatientCrypto(
        { encKeyB64: this.env.FIELD_ENCRYPTION_KEY, hashKeyB64: this.env.FIELD_HASH_KEY },
        tenantId,
      ),
    };
  }

  /** Siapkan dan kirim satu pesan; galat persiapan dipetakan ke hasil percobaan (bukan dilempar). */
  private async attempt(msg: OutboxMessage, tenantId: string): Promise<SendResult> {
    const op = OUTBOX_OPERATIONS.get(msg.operation);
    if (!op) {
      return { ok: false, permanent: true, durationMs: 0, error: `Operasi belum didukung: ${msg.operation}` };
    }
    let prepared;
    try {
      prepared = await op.prepare(msg, this.context(tenantId));
    } catch (err) {
      return {
        ok: false,
        permanent: err instanceof PermanentOperationError,
        durationMs: 0,
        error: err instanceof PermanentOperationError ? err.message : `persiapan gagal: ${errorName(err)}`,
      };
    }
    if ('skip' in prepared) {
      return { ok: true, durationMs: 0, responseExcerpt: `dilewati: ${prepared.skip}` };
    }
    return this.connector.send(msg, prepared, { sensitive: op.sensitive });
  }

  async dispatchOnce(opts: DispatchOptions = {}): Promise<DispatchSummary> {
    const summary: DispatchSummary = { tenants: 0, claimed: 0, sent: 0, failed: 0, dead: 0 };
    const tenantIds = opts.tenantIds ?? (await listActiveTenantIds(this.prisma));
    summary.tenants = tenantIds.length;
    const record = { now: opts.now, maxAttempts: opts.maxAttempts };
    for (const tenantId of tenantIds) {
      const claimed = await withTenant(this.prisma, tenantId, (tx) =>
        claimDueOutbox(tx, this.env.OUTBOX_BATCH_SIZE, opts.now ?? new Date()),
      );
      summary.claimed += claimed.length;
      for (const msg of claimed) {
        const { responseBody, ...result } = await this.attempt(msg, tenantId);
        const op = OUTBOX_OPERATIONS.get(msg.operation);
        let updated;
        try {
          updated = await withTenant(this.prisma, tenantId, async (tx) => {
            // Respons diproses di transaksi yang sama dengan pencatatan "terkirim": tidak ada hasil setengah jadi.
            if (result.ok && op?.onSuccess && responseBody !== undefined) {
              await op.onSuccess(tx, msg, responseBody);
            }
            return recordOutboxAttempt(tx, msg, result, record);
          });
        } catch (err) {
          const failure = {
            ...result,
            ok: false,
            permanent: true,
            error:
              err instanceof PermanentOperationError
                ? err.message
                : `pemrosesan respons gagal: ${errorName(err)}`,
          };
          updated = await withTenant(this.prisma, tenantId, (tx) =>
            recordOutboxAttempt(tx, msg, failure, record),
          );
        }
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
