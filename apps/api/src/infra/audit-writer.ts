import type { TenantTx } from '@simrs/db';
import { newId } from '@simrs/shared';
import type { PendingAudit } from '../common/request-context';

export interface AuditMeta {
  actorUserId: string | null;
  actorRole: string | null;
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
}

/**
 * Tulis entri audit di transaksi bertenant yang diberikan. seq, waktu, dan hash diisi trigger database.
 * Satu-satunya tempat yang menyisipkan `audit_events` (dipakai interceptor permintaan dan alur login).
 */
export async function writeAudit(
  tx: TenantTx,
  tenantId: string,
  meta: AuditMeta,
  events: PendingAudit[],
): Promise<void> {
  if (events.length === 0) return;
  await tx.auditEvent.createMany({
    data: events.map((e) => ({
      id: newId(),
      tenantId,
      actorUserId: meta.actorUserId,
      actorRole: meta.actorRole,
      patientId: e.patientId ?? null,
      resourceType: e.resourceType,
      resourceId: e.resourceId ?? null,
      action: e.action,
      outcome: e.outcome ?? 'success',
      reason: e.reason ?? null,
      ip: meta.ip,
      userAgent: meta.userAgent?.slice(0, 300) ?? null,
      requestId: meta.requestId,
      details: e.details === undefined ? undefined : (e.details as object),
    })),
  });
}
