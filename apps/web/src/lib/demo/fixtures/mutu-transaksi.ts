import type { DischargeRecord } from '../../mutu-transaksi';
import { shiftDate } from './waktu';

/**
 * B06 · Catatan pulang rawat inap 1–4 Okt 2026 (sintetis, deterministik): 50 kepulangan, 44 resume ber-TTE ≤ 24
 * jam (88%, sama dengan indikator IMP-RS di layar Mutu). Semua waktu sebelum jam demo (Sen, 5 Okt · 10.45).
 */
export function dischargeRecords(): DischargeRecord[] {
  return Array.from({ length: 50 }, (_, i) => {
    // Enam resume terlambat (30 jam setelah pulang), satu di antaranya belum ber-TTE.
    const late = i % 8 === 3 && i < 48;
    const day = shiftDate('2026-10-05', late ? -4 : -(1 + (i % 4)));
    const dischargedAt = `${day}T1${i % 6}:00:00+07:00`;
    const hours = late ? 30 : 6 + (i % 12);
    const signed = !(late && i > 40);
    return {
      dischargedAt,
      resumeSignedAt: signed ? new Date(Date.parse(dischargedAt) + hours * 3_600_000).toISOString() : null,
    };
  });
}
