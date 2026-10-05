import type { RecordAttemptOptions } from '@simrs/db';
import { jakartaParts, jakartaWallTime, OUTBOX_MAX_ATTEMPTS } from '@simrs/shared';
import type { RetryPolicy } from './operation-types';

/** Jeda backoff maksimum bawaan (ADR-0003). */
export const DEFAULT_RETRY_CAP_MS = 5 * 60_000;

/**
 * Kebijakan BPJS (SEP, task ID, antrean): coba ulang sampai akhir hari layanan WIB, jeda maks. 10 menit, lalu DLQ
 * + kirim ulang manual (keputusan fase 2 #13). Bawaan `defineBpjsOperation`.
 */
export const SERVICE_DAY_RETRY: RetryPolicy = { untilEndOfServiceDay: true, capMs: 10 * 60_000 };

/** 00.00 WIB hari berikutnya dari `at`: akhir hari layanan tempat `at` berada. */
export function endOfServiceDay(at: Date): Date {
  const p = jakartaParts(at);
  return jakartaWallTime(p.year, p.month, p.day + 1);
}

/** Umur maksimum bawaan untuk pesan yang terus ditunda (`defer`): penundaan tidak boleh tanpa ujung. */
export const DEFAULT_MAX_DEFER_MS = 24 * 60 * 60_000;

export interface RetryLimits extends Pick<RecordAttemptOptions, 'maxAttempts' | 'capMs' | 'deadline'> {
  /** Penundaan yang jatuh pada/sesudah waktu ini membuat pesan DLQ. */
  deferDeadline: Date;
}

/**
 * Batas coba ulang untuk satu pesan. `fallbackMaxAttempts` (opsi dispatch, dipakai tes) hanya berlaku untuk operasi
 * tanpa kebijakan sendiri. Hari layanan dan umur penundaan dihitung dari `coalesce(requeuedAt, createdAt)`: saat
 * kejadian domain dicatat, atau saat dikirim ulang manual dari DLQ.
 */
export function retryLimits(
  policy: RetryPolicy | undefined,
  msg: { createdAt: Date; requeuedAt?: Date | null },
  fallbackMaxAttempts?: number,
): RetryLimits {
  // Kirim ulang manual dari DLQ (`requeued_at`) membuka jendela hari layanan baru dari saat itu.
  const start = msg.requeuedAt ?? msg.createdAt;
  const deadline = policy?.untilEndOfServiceDay ? endOfServiceDay(start) : undefined;
  const maxAttempts =
    policy?.maxAttempts ?? (deadline ? Infinity : (fallbackMaxAttempts ?? OUTBOX_MAX_ATTEMPTS));
  const deferAge = start.getTime() + (policy?.maxDeferMs ?? DEFAULT_MAX_DEFER_MS);
  const deferDeadline = new Date(deadline ? Math.min(deadline.getTime(), deferAge) : deferAge);
  return { maxAttempts, capMs: policy?.capMs ?? DEFAULT_RETRY_CAP_MS, deadline, deferDeadline };
}
