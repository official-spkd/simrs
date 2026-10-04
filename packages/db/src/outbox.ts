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

/** Batas coba ulang satu pesan (kebijakan per operasi ditentukan worker; bawaan = ADR-0003). */
export interface RecordAttemptOptions {
  now?: Date;
  /** Percobaan maksimum sebelum DLQ (bawaan `OUTBOX_MAX_ATTEMPTS`); `Infinity` = hanya dibatasi `deadline`. */
  maxAttempts?: number;
  /** Batas atas jeda backoff (bawaan 5 menit). */
  capMs?: number;
  /**
   * Tidak ada percobaan pada/sesudah waktu ini: bila jadwal ulang jatuh di atau setelahnya, pesan langsung DLQ
   * (mis. akhir hari layanan WIB untuk SEP/task ID BPJS, keputusan fase 2 #13).
   */
  deadline?: Date;
  random?: () => number;
}

/** Catat hasil satu percobaan; hitung jadwal retry atau pindahkan ke DLQ (status `dead`). */
export async function recordOutboxAttempt(
  tx: TenantTx,
  message: { id: string; tenantId: string; attempts: number },
  result: AttemptResult,
  opts: RecordAttemptOptions = {},
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
  const retryAt = new Date(
    now.getTime() + backoffDelayMs(attemptNo, 1000, opts.capMs ?? 5 * 60_000, opts.random),
  );
  const pastDeadline = opts.deadline !== undefined && retryAt.getTime() >= opts.deadline.getTime();
  const dead = result.permanent || attemptNo >= maxAttempts || pastDeadline;
  const error = result.error ?? `HTTP ${result.statusCode ?? '?'}`;
  return tx.outboxMessage.update({
    where: { id: message.id },
    data: {
      status: dead ? 'dead' : 'failed',
      attempts: attemptNo,
      lastError: (pastDeadline && !result.permanent
        ? `${error} · batas waktu coba ulang terlewati`
        : error
      ).slice(0, 500),
      deadAt: dead ? now : null,
      nextAttemptAt: dead ? now : retryAt,
    },
  });
}

/**
 * Tunda pesan yang sudah diklaim tanpa menghabiskan percobaan (mis. task ID BPJS menunggu task sebelumnya):
 * kembali `pending` dan jatuh tempo pada `until`. Tidak ada baris `delivery_attempts` karena tidak ada yang dikirim;
 * alasannya terlihat di `last_error` (`ditunda: …`) sampai pesan terkirim.
 */
export async function deferOutboxMessage(
  tx: TenantTx,
  message: { id: string },
  opts: { until: Date; reason: string },
) {
  return tx.outboxMessage.update({
    where: { id: message.id },
    data: {
      status: 'pending',
      nextAttemptAt: opts.until,
      lastError: `ditunda: ${opts.reason}`.slice(0, 500),
    },
  });
}
