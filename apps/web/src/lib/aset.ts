/**
 * B02 · Aset dan pemeliharaan (rencana fase 8 §8.3): register aset dengan nilai buku (garis lurus, rupiah bigint),
 * kalibrasi alat medis (laik / segera / lewat → tidak laik pakai), dan tiket perbaikan dengan SLA respons per
 * dampak. Fungsi murni untuk layar mode presentasi (ADR-0023).
 */

export const CALIBRATION_WARN_DAYS = 30;

const DAY_MS = 86_400_000;
function dayNumber(iso: string): number {
  const [y = 1970, m = 1, d = 1] = iso.slice(0, 10).split('-').map(Number);
  return Date.UTC(y, m - 1, d) / DAY_MS;
}

export type CalibrationStatus = 'laik' | 'segera' | 'lewat' | 'tidak-perlu';

export function calibrationStatus(
  nextDue: string | null,
  today: string,
  warnDays = CALIBRATION_WARN_DAYS,
): { status: CalibrationStatus; days: number | null } {
  if (nextDue === null) return { status: 'tidak-perlu', days: null };
  const days = dayNumber(nextDue) - dayNumber(today);
  if (days < 0) return { status: 'lewat', days };
  return { status: days <= warnDays ? 'segera' : 'laik', days };
}

/** Kalibrasi berikutnya: tanggal yang sama `months` bulan kemudian (bawaan 12). */
export function nextCalibration(date: string, months = 12): string {
  const [y = 2026, m = 1, d = 1] = date.split('-').map(Number);
  const total = m - 1 + months;
  const ny = y + Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Nilai buku garis lurus per bulan penuh: biaya − biaya × bulan terpakai ÷ (umur × 12), minimal 0. Bigint rupiah,
 * pembulatan ke bawah pada penyusutan.
 */
export function bookValue(cost: bigint, acquired: string, lifeYears: number, today: string): bigint {
  const [ay = 0, am = 1] = acquired.split('-').map(Number);
  const [ty = 0, tm = 1] = today.split('-').map(Number);
  const months = BigInt(Math.max(0, (ty - ay) * 12 + (tm - am)));
  const life = BigInt(lifeYears * 12);
  if (months >= life) return 0n;
  return cost - (cost * months) / life;
}

export type Impact = 'kritis' | 'sedang' | 'ringan';

export const IMPACT_LABEL: Record<Impact, string> = {
  kritis: 'Kritis · layanan berhenti',
  sedang: 'Sedang · ada alat pengganti',
  ringan: 'Ringan · tidak mengganggu layanan',
};

/** SLA respons (jam) per dampak. */
export const RESPONSE_SLA_HOURS: Record<Impact, number> = { kritis: 2, sedang: 24, ringan: 72 };

export const TICKET_STAGES = [
  'Dilaporkan',
  'Diterima IPSRS',
  'Dikerjakan',
  'Selesai diuji',
  'Ditutup unit',
] as const;

/** Menit sejak `from` sampai `to` (ISO). */
export function minutesBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 60_000);
}

/** Respons dalam SLA? `respondedAt` null = dihitung terhadap `now`. */
export function responseWithinSla(
  reportedAt: string,
  respondedAt: string | null,
  now: string,
  impact: Impact,
): boolean {
  return minutesBetween(reportedAt, respondedAt ?? now) <= RESPONSE_SLA_HOURS[impact] * 60;
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} menit`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} jam ${m} menit` : `${h} jam`;
}

/** Uji fungsi dan keselamatan listrik wajib lulus sebelum alat medis kembali dipakai. */
export function completionBlock(checks: {
  functionTest: boolean;
  electricalSafety: boolean;
  note: string;
}): string | null {
  if (!checks.functionTest || !checks.electricalSafety)
    return 'Centang uji fungsi dan uji keselamatan listrik dulu.';
  if (checks.note.trim().length < 10) return 'Tulis tindakan perbaikan minimal 10 huruf.';
  return null;
}
