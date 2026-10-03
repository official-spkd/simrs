import { AppError } from '@simrs/shared';
import type { PendingAudit } from './request-context';

/**
 * Penolakan 403 yang wajib tercatat walau transaksi permintaan dibatalkan (mis. ABAC akses pasien, P03).
 * `TenantTransactionInterceptor` menulis `entry` sebagai `access_denied` di transaksi terpisah yang di-commit,
 * lalu meneruskan galat ini ke klien. Tanpa PHI di `entry.details`.
 */
export class AuditedDenial extends AppError {
  constructor(
    message: string,
    readonly entry: Omit<PendingAudit, 'action' | 'outcome'>,
    details?: unknown,
  ) {
    super('FORBIDDEN', message, 403, details);
    this.name = 'AuditedDenial';
  }
}
