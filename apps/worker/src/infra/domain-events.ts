import type { Prisma, TenantTx } from '@simrs/db';
import {
  type DomainEventPayload,
  isWorkerEmittedEvent,
  newId,
  parseDomainEvent,
  type WorkerEmittedEvent,
} from '@simrs/shared';

/**
 * Simpan event domain dari worker ke `domain_events` (append-only; dibaca ulang fase 5/7). Muatan divalidasi skema
 * bersama (tanpa PHI). Hanya event `WORKER_EMITTED_EVENTS`: penangan in-process milik API tidak berjalan untuk event
 * worker (dan API menolak mendaftarkannya), jadi reaksi wajib lewat outbox/notifikasi di transaksi ini atau
 * `pg_notify`/SSE dari tabel sumber.
 */
export async function recordDomainEvent<N extends WorkerEmittedEvent>(
  tx: TenantTx,
  tenantId: string,
  name: N,
  payload: DomainEventPayload<N>,
  opts: { occurredAt: Date; actorDeviceId?: string | null },
): Promise<string> {
  if (!isWorkerEmittedEvent(name)) {
    throw new Error(`Event ${name} tidak boleh ditulis worker (WORKER_EMITTED_EVENTS)`);
  }
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
