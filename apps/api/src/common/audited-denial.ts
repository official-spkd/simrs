import { AppError, type ErrorCode } from '@simrs/shared';
import type { PendingAudit } from './request-context';

/**
 * Penolakan 403 yang wajib tercatat walau transaksi permintaan dibatalkan (mis. ABAC akses pasien, P03).
 * `TenantTransactionInterceptor` menulis `entry` sebagai `access_denied` di transaksi terpisah yang di-commit,
 * lalu meneruskan galat ini ke klien. Tanpa PHI di `entry.details`. `error` mengganti kode/status bila penolakannya
 * bukan soal izin (mis. batas laju pencarian anjungan → 429 `RATE_LIMITED`).
 */
export class AuditedDenial extends AppError {
  constructor(
    message: string,
    readonly entry: Omit<PendingAudit, 'action' | 'outcome'>,
    details?: unknown,
    error: { code: ErrorCode; status: number } = { code: 'FORBIDDEN', status: 403 },
  ) {
    super(error.code, message, error.status, details);
    this.name = 'AuditedDenial';
  }
}
