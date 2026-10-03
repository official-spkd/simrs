import { AsyncLocalStorage } from 'node:async_hooks';
import type { TenantTx } from '@simrs/db';
import type { AuditAction, AuditOutcome } from '@simrs/shared';

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

export interface RequestActor {
  userId: string | null;
  /** Peran aktif (diisi P03); 'dev' untuk mode header pengembang. */
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
  tx: TenantTx;
  actor: RequestActor;
  requestId: string | null;
  ip: string | null;
  userAgent: string | null;
  audit: PendingAudit[];
}

export const requestContext = new AsyncLocalStorage<TenantRequestContext>();
