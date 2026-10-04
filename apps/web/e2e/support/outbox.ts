import { enqueueOutbox } from '@simrs/db';
import { type IntegrationTarget, newId } from '@simrs/shared';
import { inTenant, TENANTS, type TenantCode } from './accounts';

/** Pesan outbox seperti yang dilihat E2E (worker E2E memprosesnya dan mengirim ke mock). */
export interface OutboxView {
  status: string;
  attempts: number;
  lastError: string | null;
}

/**
 * Pesan `ping` (operasi contoh: dikirim ke `/<target>/_echo` di mock) langsung di DB tes, seperti yang ditulis API di
 * transaksi domainnya. Untuk menguji jalur outbox → worker → mock tanpa modul domain.
 */
export async function enqueueTestPing(
  target: IntegrationTarget,
  tenant: TenantCode = 'RSFA',
): Promise<string> {
  const tenantId = TENANTS[tenant];
  const msg = await inTenant(tenantId, (tx) =>
    enqueueOutbox(tx, tenantId, {
      target,
      operation: 'ping',
      idempotencyKey: `e2e-${newId()}`,
      payload: { from: 'e2e' },
    }),
  );
  return msg.id;
}

/** Keadaan pesan outbox saat ini (untuk `expect.poll`). */
export function outboxView(id: string, tenant: TenantCode = 'RSFA'): Promise<OutboxView | null> {
  return inTenant(TENANTS[tenant], (tx) =>
    tx.outboxMessage.findUnique({ where: { id }, select: { status: true, attempts: true, lastError: true } }),
  );
}
