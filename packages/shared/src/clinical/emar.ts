import { jakartaWallTime } from '../datetime';

/**
 * K12 · eMAR: jam jadwal dari frekuensi order obat dan status slot (aturan murni). Jam selalu WIB (`Asia/Jakarta`) dan
 * dibentuk menjadi instan UTC di server (ADR-0014), sehingga batas hari tidak bergeser.
 */

/** Jam tampilan WIB `HH.MM`. */
export const EMAR_TIME_PATTERN = /^([01]\d|2[0-3])\.[0-5]\d$/;

/**
 * Frekuensi baku order obat → jam pemberian bawaan (WIB). `prn` (bila perlu) dan `stat` (segera, sekali) tanpa jam
 * tetap. RS bisa menyimpan jam lain per order (`customTimes`), mis. "1×/hari 22.00".
 */
export const MEDICATION_FREQUENCIES = {
  '1x1_pagi': { label: '1×1 pagi', times: ['08.00'] },
  '1x1_siang': { label: '1×1 siang', times: ['12.00'] },
  '1x1_sore': { label: '1×1 sore', times: ['18.00'] },
  '1x1_malam': { label: '1×1 malam', times: ['22.00'] },
  '2x1': { label: '2×1 (tiap 12 jam)', times: ['06.00', '18.00'] },
  '3x1': { label: '3×1 (tiap 8 jam)', times: ['06.00', '14.00', '22.00'] },
  '3x1_makan': { label: '3×1 bersama makan', times: ['08.00', '12.00', '18.00'] },
  '4x1': { label: '4×1 (tiap 6 jam)', times: ['00.00', '06.00', '12.00', '18.00'] },
  prn: { label: 'Bila perlu', times: [] },
  stat: { label: 'Segera, sekali', times: [] },
} as const satisfies Record<string, { label: string; times: readonly string[] }>;
export type MedicationFrequency = keyof typeof MEDICATION_FREQUENCIES;
export const MEDICATION_FREQUENCY_CODES = Object.keys(MEDICATION_FREQUENCIES) as [
  MedicationFrequency,
  ...MedicationFrequency[],
];

/** Jam pemberian satu order: jam khusus order bila ada, selain itu bawaan frekuensinya. Terurut, tanpa ganda. */
export function emarScheduleTimes(
  frequency: MedicationFrequency,
  customTimes?: readonly string[] | null,
): string[] {
  const times = customTimes && customTimes.length > 0 ? customTimes : MEDICATION_FREQUENCIES[frequency].times;
  for (const t of times) {
    if (!EMAR_TIME_PATTERN.test(t)) throw new RangeError(`Jam eMAR tidak valid: ${t}`);
  }
  return [...new Set(times)].sort();
}

/**
 * Instan jadwal untuk satu hari kalender WIB (`YYYY-MM-DD`). Hanya jam ≥ `notBefore` (mis. waktu order aktif) yang
 * dibentuk, sehingga dosis sebelum order dibuat tidak pernah tampil "terlambat".
 */
export function emarScheduleForDay(
  date: string,
  times: readonly string[],
  notBefore?: Date | string,
): Date[] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new RangeError('Tanggal tidak valid');
  const from = notBefore ? new Date(notBefore).getTime() : -Infinity;
  return times
    .map((t) => {
      const [hh, mm] = t.split('.').map(Number);
      return jakartaWallTime(Number(m[1]), Number(m[2]), Number(m[3]), hh, mm);
    })
    .filter((d) => d.getTime() >= from);
}

/** Status pemberian yang dicatat perawat (append-only, `medication_administrations.status`). */
export const MEDICATION_ADMINISTRATION_STATUSES = ['given', 'held', 'refused'] as const;
export type MedicationAdministrationStatus = (typeof MEDICATION_ADMINISTRATION_STATUSES)[number];

/** Status slot di grid eMAR (selalu tampil sebagai teks). */
export const EMAR_SLOT_STATES = [
  'diberikan',
  'jadwal',
  'terlambat',
  'ditunda',
  'ditolak',
  'rencana',
  'kosong',
] as const;
export type EmarSlotState = (typeof EMAR_SLOT_STATES)[number];

/** Jendela sebelum jam jadwal saat dosis sudah boleh diberikan (menit). */
export const EMAR_EARLY_WINDOW_MINUTES = 60;

/**
 * Status satu slot: pemberian tercatat menentukan status (diberikan/ditunda/ditolak); tanpa catatan → rencana sebelum
 * jendela, jadwal di jendela [jam − 60 menit, jam + `lateMinutes`], terlambat sesudahnya.
 */
export function emarSlotState(o: {
  scheduledAt: Date | string;
  now: Date | string;
  administration: { status: MedicationAdministrationStatus } | null;
  /** Pengaturan RS `emar.late_minutes` (bawaan 60). */
  lateMinutes: number;
}): Exclude<EmarSlotState, 'kosong'> {
  if (o.administration) {
    return o.administration.status === 'given'
      ? 'diberikan'
      : o.administration.status === 'held'
        ? 'ditunda'
        : 'ditolak';
  }
  const at = new Date(o.scheduledAt).getTime();
  const now = new Date(o.now).getTime();
  if (now < at - EMAR_EARLY_WINDOW_MINUTES * 60_000) return 'rencana';
  if (now <= at + o.lateMinutes * 60_000) return 'jadwal';
  return 'terlambat';
}

/** Slot yang bisa dicatat pemberiannya (setelah gelang cocok). */
export function emarActionable(state: EmarSlotState): boolean {
  return state === 'jadwal' || state === 'terlambat';
}

/** Pemberian dosis terlambat (lewat `lateMinutes` dari jam jadwal) wajib alasan. */
export function emarIsLate(scheduledAt: Date | string, givenAt: Date | string, lateMinutes: number): boolean {
  return new Date(givenAt).getTime() > new Date(scheduledAt).getTime() + lateMinutes * 60_000;
}

/**
 * Pindaian gelang masih berlaku untuk pemberian ini (aturan sama dengan trigger database, potongan 3.0c): cocok, kunjungan
 * sama, perawat sama, dan tidak lebih lama dari `validMinutes` (`emar.scan_valid_minutes`).
 */
export function wristbandScanValid(
  scan: { matched: boolean; encounterId: string; userId: string; scannedAt: Date | string },
  use: { encounterId: string; userId: string; at: Date | string },
  validMinutes: number,
): boolean {
  const age = new Date(use.at).getTime() - new Date(scan.scannedAt).getTime();
  return (
    scan.matched &&
    scan.encounterId === use.encounterId &&
    scan.userId === use.userId &&
    age >= 0 &&
    age <= validMinutes * 60_000
  );
}
