import { Injectable, Logger } from '@nestjs/common';
import { AppError, type ErrorCode } from '@simrs/shared';
import { sanitizeForLog } from '../../common/error.filter';
import type { PendingAudit } from '../../common/request-context';
import { TenantDb } from '../tenant-db';
import { LOOKUP_NAME, LOOKUP_TIMEOUT_MS, type LookupConnector, type LookupTarget } from './lookup-connector';

export interface LookupOptions {
  /** Pasien yang menjadi subjek lookup (audit). */
  patientId?: string | null;
  /** Sumber terkait, mis. id encounter atau booking (audit). */
  resourceId?: string | null;
  /** Alasan yang diketik pengguna, bila ada (audit). */
  reason?: string | null;
}

export interface LookupPersistOptions<O, R> extends LookupOptions {
  /**
   * Simpan/olah hasil di transaksi pendek ketiga, atomik dengan audit "selesai" (mis. snapshot eligibilitas).
   * Repository (`TenantDb.tx()`) dan event domain bekerja di dalamnya. Jangan memanggil sistem luar di sini.
   */
  persist: (output: O) => Promise<R>;
}

const UNAVAILABLE: Record<LookupTarget, { code: ErrorCode; message: string }> = {
  bpjs: {
    code: 'BPJS_UNAVAILABLE',
    message: 'Layanan BPJS tidak merespons. Coba lagi beberapa saat lagi.',
  },
  dukcapil: {
    code: 'INTEGRATION_UNAVAILABLE',
    message: 'Layanan Dukcapil tidak merespons. Coba lagi atau isi data secara manual.',
  },
};

class LookupTimeoutError extends Error {
  constructor() {
    super('lookup timeout');
    this.name = 'LookupTimeoutError';
  }
}

type FailureReason = 'timeout' | 'error' | 'rejected';

/**
 * ADR-0025 · Lookup baca-saja ke sistem luar dari handler API, DI LUAR transaksi database:
 *
 * 1. transaksi pendek: audit `requested` di-commit SEBELUM sistem luar dihubungi (gagal tertutup: tanpa jejak, tanpa
 *    lookup); otorisasi sudah dikerjakan interceptor di transaksi pendek sebelumnya,
 * 2. panggil konektor dengan batas waktu (maks 5 dtk, `AbortSignal`), tanpa memegang koneksi pool,
 * 3. transaksi pendek: audit `completed` + `persist` opsional, atomik.
 *
 * Gagal/terlambat → audit `failed` lalu 503 berkode stabil (`BPJS_UNAVAILABLE` untuk BPJS). Hanya dari handler
 * `@NoRequestTransaction()`; di dalam transaksi → galat program. Masukan/keluaran (bisa PHI) tidak pernah masuk log
 * maupun audit; log hanya nama lookup, alasan, durasi, dan request id.
 */
@Injectable()
export class LookupGateway {
  private readonly logger = new Logger('LookupGateway');

  constructor(private readonly db: TenantDb) {}

  lookup<I, O>(connector: LookupConnector<I, O>, input: I, options?: LookupOptions): Promise<O>;
  lookup<I, O, R>(
    connector: LookupConnector<I, O>,
    input: I,
    options: LookupPersistOptions<O, R>,
  ): Promise<R>;
  async lookup<I, O, R>(
    connector: LookupConnector<I, O>,
    input: I,
    options: LookupOptions & { persist?: (output: O) => Promise<R> } = {},
  ): Promise<O | R> {
    if (!LOOKUP_NAME.test(connector.name)) {
      throw new Error(`Nama konektor lookup tidak sah: ${connector.name}`);
    }
    if (this.db.inTransaction()) {
      throw new Error(
        'LookupGateway.lookup() dipanggil di dalam transaksi. Pasang @NoRequestTransaction() pada handler (ADR-0025).',
      );
    }
    const base: PendingAudit = {
      action: connector.auditAction ?? 'read',
      resourceType: connector.name,
      resourceId: options.resourceId ?? null,
      patientId: options.patientId ?? null,
      reason: options.reason ?? null,
    };
    const audit = (details: Record<string, unknown>) => this.db.audit({ ...base, details });

    // 1. Jejak permintaan di-commit lebih dulu.
    await this.db.transaction(async () => audit({ phase: 'requested', target: connector.target }));

    // 2. Sistem luar, tanpa transaksi.
    const started = performance.now();
    let output: O;
    try {
      output = await this.callWithTimeout(connector, input);
    } catch (err) {
      const durationMs = Math.round(performance.now() - started);
      const reason: FailureReason =
        err instanceof AppError ? 'rejected' : err instanceof LookupTimeoutError ? 'timeout' : 'error';
      await this.recordFailure(connector, reason, durationMs, err, audit);
      if (err instanceof AppError) throw err;
      const { code, message } = UNAVAILABLE[connector.target];
      throw new AppError(code, message, 503, { lookup: connector.name, reason });
    }
    const durationMs = Math.round(performance.now() - started);

    // 3. Hasil + audit selesai, atomik.
    return this.db.transaction(async () => {
      const result = options.persist ? await options.persist(output) : output;
      audit({
        phase: 'completed',
        target: connector.target,
        durationMs,
        ...(connector.summarize ? { summary: connector.summarize(output) } : {}),
      });
      return result;
    });
  }

  private async callWithTimeout<I, O>(connector: LookupConnector<I, O>, input: I): Promise<O> {
    const timeoutMs = Math.min(connector.timeoutMs ?? LOOKUP_TIMEOUT_MS, LOOKUP_TIMEOUT_MS);
    const controller = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new LookupTimeoutError());
      }, timeoutMs);
    });
    try {
      // Promise.race memasang penangan pada keduanya: penolakan yang datang belakangan tidak menjadi unhandled.
      return await Promise.race([
        Promise.resolve().then(() => connector.call(input, controller.signal)),
        timeout,
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Audit `failed` sebaik mungkin: jejak `requested` sudah tersimpan, jadi kegagalan menulis ini tidak menutupi 503. */
  private async recordFailure(
    connector: LookupConnector<unknown, unknown>,
    reason: FailureReason,
    durationMs: number,
    err: unknown,
    audit: (details: Record<string, unknown>) => void,
  ): Promise<void> {
    const code = err instanceof AppError ? err.code : undefined;
    if (reason !== 'rejected') {
      this.logger.warn(
        {
          lookup: connector.name,
          target: connector.target,
          reason,
          durationMs,
          err: sanitizeForLog(err),
          requestId: this.db.requestId(),
        },
        'Lookup sistem luar gagal',
      );
    }
    try {
      await this.db.transaction(async () =>
        audit({ phase: 'failed', target: connector.target, reason, durationMs, ...(code ? { code } : {}) }),
      );
    } catch (auditErr) {
      this.logger.error(
        { lookup: connector.name, err: sanitizeForLog(auditErr), requestId: this.db.requestId() },
        'Audit hasil lookup gagal ditulis',
      );
    }
  }
}
