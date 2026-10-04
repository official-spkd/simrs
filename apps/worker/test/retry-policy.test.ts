/**
 * Kebijakan retry per operasi (keputusan fase 2 #13): batas akhir hari layanan dihitung di zona Asia/Jakarta,
 * bukan UTC dan bukan zona mesin.
 */
import { OUTBOX_MAX_ATTEMPTS } from '@simrs/shared';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAX_DEFER_MS,
  DEFAULT_RETRY_CAP_MS,
  endOfServiceDay,
  retryLimits,
  SERVICE_DAY_RETRY,
} from '../src/outbox/retry-policy';

describe('endOfServiceDay (WIB)', () => {
  it('akhir hari layanan = 00.00 WIB berikutnya = 17.00 UTC', () => {
    // 5 Okt 10.00 WIB
    expect(endOfServiceDay(new Date('2026-10-05T03:00:00Z')).toISOString()).toBe('2026-10-05T17:00:00.000Z');
    // 5 Okt 00.30 WIB (masih 4 Okt di UTC) → tetap hari layanan 5 Okt
    expect(endOfServiceDay(new Date('2026-10-04T17:30:00Z')).toISOString()).toBe('2026-10-05T17:00:00.000Z');
  });

  it('batas detik: 23.59.59 WIB dan 00.00.00 WIB masuk hari yang berbeda', () => {
    expect(endOfServiceDay(new Date('2026-10-05T16:59:59.999Z')).toISOString()).toBe(
      '2026-10-05T17:00:00.000Z',
    );
    expect(endOfServiceDay(new Date('2026-10-05T17:00:00.000Z')).toISOString()).toBe(
      '2026-10-06T17:00:00.000Z',
    );
  });

  it('pergantian bulan dan tahun', () => {
    expect(endOfServiceDay(new Date('2026-10-31T10:00:00Z')).toISOString()).toBe('2026-10-31T17:00:00.000Z');
    expect(endOfServiceDay(new Date('2026-12-31T16:00:00Z')).toISOString()).toBe('2026-12-31T17:00:00.000Z');
    expect(endOfServiceDay(new Date('2026-12-31T17:00:00Z')).toISOString()).toBe('2027-01-01T17:00:00.000Z');
  });
});

describe('retryLimits', () => {
  const createdAt = new Date('2026-10-05T03:00:00Z');

  it('tanpa kebijakan: 8 percobaan (atau nilai opsi dispatch), jeda maks. 5 menit, tanpa batas waktu', () => {
    expect(retryLimits(undefined, { createdAt })).toEqual({
      maxAttempts: OUTBOX_MAX_ATTEMPTS,
      capMs: DEFAULT_RETRY_CAP_MS,
      deadline: undefined,
      deferDeadline: new Date(createdAt.getTime() + DEFAULT_MAX_DEFER_MS),
    });
    expect(retryLimits(undefined, { createdAt }, 3).maxAttempts).toBe(3);
  });

  it('kebijakan operasi mengalahkan opsi dispatch', () => {
    expect(retryLimits({ maxAttempts: 20, capMs: 60_000, maxDeferMs: 60_000 }, { createdAt }, 3)).toEqual({
      maxAttempts: 20,
      capMs: 60_000,
      deadline: undefined,
      deferDeadline: new Date(createdAt.getTime() + 60_000),
    });
  });

  it('sampai akhir hari layanan: tidak dibatasi hitungan, batas = 00.00 WIB berikutnya dari saat pesan dibuat', () => {
    expect(retryLimits(SERVICE_DAY_RETRY, { createdAt }, 3)).toEqual({
      maxAttempts: Infinity,
      capMs: 10 * 60_000,
      deadline: new Date('2026-10-05T17:00:00Z'),
      // Penundaan juga berhenti di akhir hari layanan (lebih dulu dari batas umur 24 jam).
      deferDeadline: new Date('2026-10-05T17:00:00Z'),
    });
    expect(retryLimits({ ...SERVICE_DAY_RETRY, maxAttempts: 50 }, { createdAt }).maxAttempts).toBe(50);
  });
});
