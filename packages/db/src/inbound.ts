import {
  backoffDelayMs,
  INBOUND_ERROR_MAX,
  INBOUND_LEASE_MS,
  INBOUND_MAX_ATTEMPTS,
  INBOUND_RETRY_BASE_MS,
  INBOUND_RETRY_CAP_MS,
  type InboundSource,
  newId,
} from '@simrs/shared';
import type { InboundEvent } from './generated/prisma/client';
import type { TenantTx } from './client';

/**
 * Pemroses pesan MASUK generik (rencana fase 4 §4.1a; dipakai ulang webhook TPDI fase 6). Pola:
 * 1. penerima (API) menyimpan pesan mentah yang sudah aman (mis. HL7 tanpa PID) dengan `storeInboundEvent`, dedup per
 *    tenant × sumber × idempotency key, lalu langsung menjawab (ACK/2xx),
 * 2. worker mengklaim pesan jatuh tempo (`claimDueInbound`, FOR UPDATE SKIP LOCKED + sewa),
 * 3. penangan per sumber menulis hasilnya di transaksi yang sama dengan `markInboundProcessed` (atomik, ADR-0017);
 *    bila gagal, transaksi itu batal dan `recordInboundFailure` menjadwalkan ulang (backoff eksponensial) atau
 *    menghentikannya (`dead`, tampil di layar pemilik sumber, bukan DLQ diam).
 */

export interface StoreInboundInput {
  source: InboundSource;
  idempotencyKey: string;
  /** Header aman (tanpa token/tanda tangan), mis. tipe konten dan cap waktu perangkat. */
  headers: Record<string, string | null>;
  rawBody: string;
  deviceId?: string | null;
}

export type StoreInboundResult =
  | { kind: 'stored'; id: string }
  /** Kunci sama, isi sama: pengiriman ulang (jawab sukses tanpa menyimpan lagi). */
  | { kind: 'duplicate'; id: string }
  /** Kunci sama, isi berbeda: pengirim memakai ulang ID pesan untuk pesan lain. */
  | { kind: 'conflict'; id: string };

/** Simpan pesan masuk sekali per (tenant, sumber, kunci). Harus dipanggil di dalam transaksi tenant. */
export async function storeInboundEvent(
  tx: TenantTx,
  tenantId: string,
  input: StoreInboundInput,
): Promise<StoreInboundResult> {
  const id = newId();
  const inserted = await tx.$queryRaw<Array<{ id: string }>>`
    INSERT INTO inbound_events (id, tenant_id, source, idempotency_key, headers, raw_body, device_id)
    VALUES (${id}::uuid, ${tenantId}::uuid, ${input.source}, ${input.idempotencyKey},
            ${JSON.stringify(input.headers)}::jsonb, ${input.rawBody}, ${input.deviceId ?? null}::uuid)
    ON CONFLICT (tenant_id, source, idempotency_key) DO NOTHING
    RETURNING id::text AS id`;
  if (inserted[0]) return { kind: 'stored', id: inserted[0].id };
  const existing = await tx.inboundEvent.findUniqueOrThrow({
    where: {
      tenantId_source_idempotencyKey: {
        tenantId,
        source: input.source,
        idempotencyKey: input.idempotencyKey,
      },
    },
    select: { id: true, rawBody: true, deviceId: true },
  });
  const same = existing.rawBody === input.rawBody && existing.deviceId === (input.deviceId ?? null);
  return { kind: same ? 'duplicate' : 'conflict', id: existing.id };
}

/**
 * Klaim pesan jatuh tempo milik sumber yang punya penangan (`received`/`failed`, atau `processing` yang sewanya habis),
 * tandai `processing` sampai `now + lease`. Urut waktu terima lalu id (UUID v7).
 */
export async function claimDueInbound(
  tx: TenantTx,
  sources: readonly string[],
  limit: number,
  now = new Date(),
  leaseMs = INBOUND_LEASE_MS,
): Promise<InboundEvent[]> {
  if (sources.length === 0) return [];
  const ids = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id::text AS id FROM inbound_events
    WHERE status IN ('received', 'failed', 'processing') AND next_attempt_at <= ${now}
      AND source = ANY(${[...sources]}::text[])
    ORDER BY received_at, id
    LIMIT ${limit}
    FOR UPDATE SKIP LOCKED`;
  if (ids.length === 0) return [];
  const idList = ids.map((r) => r.id);
  await tx.inboundEvent.updateMany({
    where: { id: { in: idList } },
    data: { status: 'processing', nextAttemptAt: new Date(now.getTime() + leaseMs) },
  });
  return tx.inboundEvent.findMany({
    where: { id: { in: idList } },
    orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }],
  });
}

/** Tandai selesai di transaksi penangan (commit bersama hasilnya). Gagal bila klaimnya sudah diambil worker lain. */
export async function markInboundProcessed(
  tx: TenantTx,
  event: { id: string; attempts: number },
  now = new Date(),
): Promise<void> {
  const n = await tx.inboundEvent.updateMany({
    where: { id: event.id, status: 'processing', attempts: event.attempts },
    data: {
      status: 'processed',
      attempts: event.attempts + 1,
      processedAt: now,
      error: null,
      nextAttemptAt: now,
    },
  });
  if (n.count !== 1) throw new Error(`Pesan masuk ${event.id} sudah tidak diklaim worker ini`);
}

export interface InboundFailureOptions {
  now?: Date;
  /** Galat permanen (isi tidak bisa diproses, mis. barcode tak dikenal setelah batas): langsung `dead`. */
  permanent?: boolean;
  maxAttempts?: number;
  random?: () => number;
}

/** Catat kegagalan satu percobaan: jadwal ulang (`failed`) atau berhenti (`dead`). */
export async function recordInboundFailure(
  tx: TenantTx,
  event: { id: string; attempts: number },
  error: string,
  opts: InboundFailureOptions = {},
): Promise<'failed' | 'dead'> {
  const now = opts.now ?? new Date();
  const attemptNo = event.attempts + 1;
  const dead = opts.permanent === true || attemptNo >= (opts.maxAttempts ?? INBOUND_MAX_ATTEMPTS);
  const retryAt = new Date(
    now.getTime() + backoffDelayMs(attemptNo, INBOUND_RETRY_BASE_MS, INBOUND_RETRY_CAP_MS, opts.random),
  );
  await tx.inboundEvent.updateMany({
    where: { id: event.id, status: 'processing' },
    data: {
      status: dead ? 'dead' : 'failed',
      attempts: attemptNo,
      error: error.slice(0, INBOUND_ERROR_MAX),
      nextAttemptAt: dead ? now : retryAt,
    },
  });
  return dead ? 'dead' : 'failed';
}
