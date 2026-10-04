import { AsyncLocalStorage } from 'node:async_hooks';
import type { TenantTx } from '@simrs/db';
import type { AuditAction, AuditOutcome, PermissionScope } from '@simrs/shared';

/** Satu entri audit yang akan ditulis di akhir transaksi permintaan. Tanpa PHI di `details`. */
export interface PendingAudit {
  action: AuditAction;
  resourceType: string;
  resourceId?: string | null;
  patientId?: string | null;
  reason?: string | null;
  outcome?: AuditOutcome;
  details?: Record<string, unknown>;
}

/** Peran pelaku pada mode header pengembang (APP_ENV=local saja): melewati matriks izin. */
export const DEV_ROLE = 'dev';

export interface RequestActor {
  userId: string | null;
  /** Kode peran dari penugasan aktif sesi; `DEV_ROLE` untuk mode header pengembang. */
  role: string | null;
  sessionId: string | null;
  /** Unit kerja yang dipilih saat login (diisi P03/layar Login). */
  unitId: string | null;
}

/**
 * Konteks satu permintaan bertenant: transaksi database (RLS aktif), pelaku, metadata, dan antrean audit.
 * Dibuat oleh `TenantTransactionInterceptor`; dibaca repository lewat `TenantDb`.
 */
export interface TenantRequestContext {
  tenantId: string;
  /**
   * Transaksi permintaan. `null` pada handler `@NoRequestTransaction()` (lookup sinkron ADR-0025, SSE ADR-0026)
   * di luar transaksi pendek `TenantDb.transaction()`: di sana `TenantDb.tx()` menolak dengan galat program.
   */
  tx: TenantTx | null;
  actor: RequestActor;
  requestId: string | null;
  ip: string | null;
  userAgent: string | null;
  /** Lingkup izin yang diberikan untuk endpoint ini (P03), null bila endpoint tanpa @RequirePermission. */
  permissionScope: PermissionScope | null;
  audit: PendingAudit[];
}

export const requestContext = new AsyncLocalStorage<TenantRequestContext>();
