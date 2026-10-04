import type { RecordAttemptOptions } from '@simrs/db';
import { jakartaParts, OUTBOX_MAX_ATTEMPTS } from '@simrs/shared';
import type { RetryPolicy } from './operation-types';

/** Jeda backoff maksimum bawaan (ADR-0003). */
export const DEFAULT_RETRY_CAP_MS = 5 * 60_000;

/**
 * Kebijakan BPJS (SEP, task ID, antrean): coba ulang sampai akhir hari layanan WIB, jeda maks. 10 menit, lalu DLQ
 * + kirim ulang manual (keputusan fase 2 #13). Bawaan `defineBpjsOperation`.
 */
export const SERVICE_DAY_RETRY: RetryPolicy = { untilEndOfServiceDay: true, capMs: 10 * 60_000 };

/** WIB = UTC+7 tanpa musim panas. */
const WIB_OFFSET_HOURS = 7;

/** 00.00 WIB hari berikutnya dari `at`: akhir hari layanan tempat `at` berada. */
export function endOfServiceDay(at: Date): Date {
  const p = jakartaParts(at);
  return new Date(Date.UTC(p.year, p.month - 1, p.day + 1, -WIB_OFFSET_HOURS, 0, 0, 0));
}

/** Umur maksimum bawaan untuk pesan yang terus ditunda (`defer`): penundaan tidak boleh tanpa ujung. */
export const DEFAULT_MAX_DEFER_MS = 24 * 60 * 60_000;

export interface RetryLimits extends Pick<RecordAttemptOptions, 'maxAttempts' | 'capMs' | 'deadline'> {
  /** Penundaan yang jatuh pada/sesudah waktu ini membuat pesan DLQ. */
  deferDeadline: Date;
}

/**
 * Batas coba ulang untuk satu pesan. `fallbackMaxAttempts` (opsi dispatch, dipakai tes) hanya berlaku untuk operasi
 * tanpa kebijakan sendiri. Hari layanan dan umur penundaan dihitung dari `createdAt` pesan (saat kejadian domain
 * dicatat).
 */
export function retryLimits(
  policy: RetryPolicy | undefined,
  msg: { createdAt: Date },
  fallbackMaxAttempts?: number,
): RetryLimits {
  const deadline = policy?.untilEndOfServiceDay ? endOfServiceDay(msg.createdAt) : undefined;
  const maxAttempts =
    policy?.maxAttempts ?? (deadline ? Infinity : (fallbackMaxAttempts ?? OUTBOX_MAX_ATTEMPTS));
  const deferAge = msg.createdAt.getTime() + (policy?.maxDeferMs ?? DEFAULT_MAX_DEFER_MS);
  const deferDeadline = new Date(deadline ? Math.min(deadline.getTime(), deferAge) : deferAge);
  return { maxAttempts, capMs: policy?.capMs ?? DEFAULT_RETRY_CAP_MS, deadline, deferDeadline };
}
