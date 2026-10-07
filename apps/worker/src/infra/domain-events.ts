import type { Prisma, TenantTx } from '@simrs/db';
import { type DomainEventName, type DomainEventPayload, newId, parseDomainEvent } from '@simrs/shared';

/**
 * Simpan event domain dari worker ke `domain_events` (append-only; dibaca ulang fase 5/7). Muatan divalidasi skema
 * bersama (tanpa PHI). Penangan event dalam proses milik API tidak berjalan di sini; worker menulis sendiri reaksi yang
 * wajib (notifikasi/outbox) di transaksi yang sama.
 */
export async function recordDomainEvent<N extends DomainEventName>(
  tx: TenantTx,
  tenantId: string,
  name: N,
  payload: DomainEventPayload<N>,
  opts: { occurredAt: Date; actorDeviceId?: string | null },
): Promise<string> {
  const parsed = parseDomainEvent(name, payload);
  const id = newId();
  await tx.domainEvent.create({
    data: {
      id,
      tenantId,
      name,
      payload: parsed as Prisma.InputJsonValue,
      occurredAt: opts.occurredAt,
      actorDeviceId: opts.actorDeviceId ?? null,
    },
  });
  return id;
}
