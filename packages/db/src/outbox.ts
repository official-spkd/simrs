import { backoffDelayMs, newId, OUTBOX_MAX_ATTEMPTS, type OutboxEnvelope } from '@simrs/shared';
import type { Prisma, TenantTx } from './client';

/**
 * Tulis pesan outbox di dalam transaksi domain yang sama (ADR-0003). Idempoten per (tenant, target, key):
 * menulis ulang dengan key sama tidak membuat pesan kedua.
 */
export async function enqueueOutbox(tx: TenantTx, tenantId: string, msg: OutboxEnvelope) {
  return tx.outboxMessage.upsert({
    where: {
      tenantId_target_idempotencyKey: { tenantId, target: msg.target, idempotencyKey: msg.idempotencyKey },
    },
    update: {},
    create: {
      id: newId(),
      tenantId,
      target: msg.target,
      operation: msg.operation,
      idempotencyKey: msg.idempotencyKey,
      payload: msg.payload as Prisma.InputJsonValue,
    },
  });
}

/** Lama klaim `processing` sebelum pesan boleh diambil ulang (worker mati di tengah kirim). */
export const OUTBOX_LEASE_MS = 60_000;

/**
 * Ambil pesan siap kirim milik tenant aktif dan tandai `processing` (FOR UPDATE SKIP LOCKED: aman untuk beberapa worker).
 * Klaim berlaku selama lease; pesan `processing` yang lease-nya habis diambil ulang.
 * Harus dipanggil di dalam `withTenant`. Pengiriman HTTP dilakukan SETELAH transaksi ini commit.
 */
export async function claimDueOutbox(
  tx: TenantTx,
  limit: number,
  now = new Date(),
  leaseMs = OUTBOX_LEASE_MS,
) {
  const ids = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM outbox_messages
    WHERE status IN ('pending', 'failed', 'processing') AND next_attempt_at <= ${now}
    ORDER BY created_at
    LIMIT ${limit}
    FOR UPDATE SKIP LOCKED`;
  if (ids.length === 0) return [];
  const idList = ids.map((r) => r.id);
  await tx.outboxMessage.updateMany({
    where: { id: { in: idList } },
    data: { status: 'processing', nextAttemptAt: new Date(now.getTime() + leaseMs) },
  });
  return tx.outboxMessage.findMany({ where: { id: { in: idList } }, orderBy: { createdAt: 'asc' } });
}

export interface AttemptResult {
  ok: boolean;
  statusCode?: number;
  error?: string;
  durationMs: number;
  responseExcerpt?: string;
  /** Galat permanen (mis. 4xx validasi): langsung DLQ tanpa retry. */
  permanent?: boolean;
}

/** Catat hasil satu percobaan; hitung jadwal retry atau pindahkan ke DLQ (status `dead`). */
export async function recordOutboxAttempt(
  tx: TenantTx,
  message: { id: string; tenantId: string; attempts: number },
  result: AttemptResult,
  opts: { now?: Date; maxAttempts?: number; random?: () => number } = {},
) {
  const now = opts.now ?? new Date();
  const attemptNo = message.attempts + 1;
  const maxAttempts = opts.maxAttempts ?? OUTBOX_MAX_ATTEMPTS;
  await tx.deliveryAttempt.create({
    data: {
      id: newId(),
      tenantId: message.tenantId,
      outboxMessageId: message.id,
      attemptNo,
      startedAt: new Date(now.getTime() - result.durationMs),
      durationMs: result.durationMs,
      statusCode: result.statusCode ?? null,
      outcome: result.ok ? 'sent' : 'failed',
      error: result.error?.slice(0, 500) ?? null,
      responseExcerpt: result.responseExcerpt?.slice(0, 500) ?? null,
    },
  });

  if (result.ok) {
    return tx.outboxMessage.update({
      where: { id: message.id },
      data: { status: 'sent', attempts: attemptNo, sentAt: now, lastError: null },
    });
  }
  const dead = result.permanent || attemptNo >= maxAttempts;
  return tx.outboxMessage.update({
    where: { id: message.id },
    data: {
      status: dead ? 'dead' : 'failed',
      attempts: attemptNo,
      lastError: result.error?.slice(0, 500) ?? `HTTP ${result.statusCode ?? '?'}`,
      deadAt: dead ? now : null,
      nextAttemptAt: dead
        ? now
        : new Date(now.getTime() + backoffDelayMs(attemptNo, 1000, 5 * 60_000, opts.random)),
    },
  });
}
