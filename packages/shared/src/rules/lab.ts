import type { LabFlag, LabRange } from '../schemas/penunjang';
import {
  CRITICAL_RECIPIENT_NAME_MIN,
  type CriticalRecipient,
  type LabReferenceRange,
  type QcOutcome,
  type WestgardRule,
} from '../schemas/penunjang-api';
import type { SupportErrorCode } from '../errors';

/**
 * S01/S09 · Aturan murni laboratorium dan nilai kritis (rencana fase 4 §4.0a, keputusan no. 23): satu sumber untuk API
 * (berwenang), web (petunjuk), dan mode presentasi. Dipindah dari `apps/web/src/lib/penunjang.ts`.
 */

/**
 * Flag hasil: KRITIS bila melewati batas kritis (lebih dari batas atas atau kurang dari batas bawah), H/L bila di
 * luar rentang rujukan, selain itu N. Nilai tepat di batas dianggap masih di dalam rentang.
 */
export function labFlag(value: number, ref: LabRange | null, critical: LabRange | null): LabFlag {
  if (critical) {
    if (critical.high !== null && value > critical.high) return 'KRITIS';
    if (critical.low !== null && value < critical.low) return 'KRITIS';
  }
  if (ref?.high !== null && ref?.high !== undefined && value > ref.high) return 'H';
  if (ref?.low !== null && ref?.low !== undefined && value < ref.low) return 'L';
  return 'N';
}

/** Delta check: selisih absolut terhadap hasil sebelumnya yang terakhir melebihi batas (`limit`). */
export function deltaCheck(value: number, previous: readonly number[], limit: number | null): boolean {
  const last = previous.at(-1);
  if (limit === null || last === undefined) return false;
  return Math.abs(value - last) > limit + 1e-9;
}

/**
 * Rentang rujukan yang berlaku untuk pasien: cocok jenis kelamin (atau `any`) dan umur dalam hari di
 * [`ageMinDays`, `ageMaxDays`). Yang spesifik jenis kelamin menang atas `any`; null bila tidak ada.
 */
export function pickReferenceRange<R extends Pick<LabReferenceRange, 'sex' | 'ageMinDays' | 'ageMaxDays'>>(
  ranges: readonly R[],
  sex: 'male' | 'female' | 'unknown',
  ageDays: number,
): R | null {
  const fits = ranges.filter(
    (r) => ageDays >= r.ageMinDays && (r.ageMaxDays === null || ageDays < r.ageMaxDays),
  );
  return fits.find((r) => r.sex === sex) ?? fits.find((r) => r.sex === 'any') ?? null;
}

export type CriticalStage = 'terbuka' | 'menunggu-read-back' | 'selesai';

/** Laporan baru sah setelah read-back: tanpa read-back, nilai kritis tetap terbuka (menunggu read-back). */
export function criticalStage(c: { reportedAt: string | null; readBackAt: string | null }): CriticalStage {
  if (c.readBackAt) return 'selesai';
  return c.reportedAt ? 'menunggu-read-back' : 'terbuka';
}

/**
 * Laporan nilai kritis (S09, keputusan fase 4 no. 8): penerima wajib (staf terpilih, atau nama ≥ 5 karakter +
 * peran) dan read-back wajib dikonfirmasi. Mengembalikan kode galat atau null bila sah. Juga ditegakkan CHECK DB.
 */
export function criticalReportBlock(input: {
  recipient: CriticalRecipient | null;
  readBackConfirmed: boolean;
}): Extract<SupportErrorCode, 'CRITICAL_RECIPIENT_REQUIRED' | 'CRITICAL_READBACK_REQUIRED'> | null {
  const r = input.recipient;
  const ok =
    r !== null &&
    ('userId' in r || (r.name.trim().length >= CRITICAL_RECIPIENT_NAME_MIN && r.role.trim().length >= 3));
  if (!ok) return 'CRITICAL_RECIPIENT_REQUIRED';
  if (!input.readBackConfirmed) return 'CRITICAL_READBACK_REQUIRED';
  return null;
}

/** Menit utuh dari nilai kritis muncul sampai dilaporkan (jam server), minimal 0. */
export function minutesToReport(raisedAt: string | Date, reportedAt: string | Date): number {
  return Math.max(0, Math.floor((new Date(reportedAt).getTime() - new Date(raisedAt).getTime()) / 60_000));
}

/** Tingkat eskalasi yang sudah jatuh tempo: 0 sebelum batas, 1 pada batas, 2 pada batas + langkah, dst. (maks 3). */
export function criticalEscalationLevel(
  minutesOpen: number,
  limitMinutes: number,
  stepMinutes: number,
): number {
  if (minutesOpen < limitMinutes) return 0;
  return Math.min(3, 1 + Math.floor((minutesOpen - limitMinutes) / Math.max(1, stepMinutes)));
}

/**
 * Gerbang validasi teknis (keputusan fase 4 no. 7): hasil lengkap, tidak ada nilai kritis terbuka (tanpa override),
 * QC hari itu tidak ditolak kecuali override beralasan. Validasi klinis hanya setelah teknis.
 */
export function technicalValidationBlock(s: {
  resultsComplete: boolean;
  criticalOpen: boolean;
  qcRejected: boolean;
  qcOverrideReason: string | null;
}): Extract<SupportErrorCode, 'RESULT_INCOMPLETE' | 'CRITICAL_OPEN' | 'QC_REJECTED'> | null {
  if (!s.resultsComplete) return 'RESULT_INCOMPLETE';
  if (s.criticalOpen) return 'CRITICAL_OPEN';
  if (s.qcRejected && (s.qcOverrideReason ?? '').trim().length < 10) return 'QC_REJECTED';
  return null;
}

export function clinicalValidationBlock(s: {
  technicalDone: boolean;
  criticalOpen: boolean;
}): Extract<SupportErrorCode, 'VALIDATION_ORDER' | 'CRITICAL_OPEN'> | null {
  if (!s.technicalDone) return 'VALIDATION_ORDER';
  if (s.criticalOpen) return 'CRITICAL_OPEN';
  return null;
}

/**
 * Westgard sederhana atas satu run + riwayat run sebelumnya (lama → baru) untuk tes × level kontrol yang sama:
 * 1-2s = peringatan; 1-3s, 2-2s, R-4s = tolak (keputusan fase 4 §4.2). Nilai = z-score (nilai − mean) / SD.
 */
export function westgardEvaluate(
  current: number,
  previous: readonly number[],
): { outcome: QcOutcome; violations: WestgardRule[] } {
  const v: WestgardRule[] = [];
  const last = previous.at(-1);
  if (Math.abs(current) > 3) v.push('1-3s');
  if (
    last !== undefined &&
    Math.abs(current) > 2 &&
    Math.abs(last) > 2 &&
    Math.sign(current) === Math.sign(last)
  ) {
    v.push('2-2s');
  }
  if (last !== undefined && Math.abs(current - last) > 4 && Math.sign(current) !== Math.sign(last))
    v.push('R-4s');
  if (v.length > 0) return { outcome: 'reject', violations: v };
  if (Math.abs(current) > 2) return { outcome: 'warn', violations: ['1-2s'] };
  return { outcome: 'ok', violations: [] };
}

/** z-score kontrol: (nilai − mean) / SD. */
export function qcZScore(value: number, mean: number, sd: number): number {
  return (value - mean) / sd;
}

/** eGFR CKD-EPI 2021 (tanpa ras) dari kreatinin serum mg/dL, umur tahun, jenis kelamin; dibulatkan. */
export function egfrCkdEpi2021(creatinineMgDl: number, ageYears: number, sex: 'male' | 'female'): number {
  const k = sex === 'female' ? 0.7 : 0.9;
  const a = sex === 'female' ? -0.241 : -0.302;
  const r = creatinineMgDl / k;
  const v =
    142 * Math.min(r, 1) ** a * Math.max(r, 1) ** -1.2 * 0.9938 ** ageYears * (sex === 'female' ? 1.012 : 1);
  return Math.round(v);
}
