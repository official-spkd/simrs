import type { SupportErrorCode } from '../errors';
import type { AboGroup, RhFactor } from '../schemas/penunjang-api';

/**
 * S08 · Kompatibilitas darah (rencana fase 4 §4.9, keputusan no. 22; ADR-0105). Sama dengan trigger database
 * `blood_issues` (4.0b, diperbarui migrasi `20261008500000_blood_bank_safety`). Aturan ABO mengikuti komponen
 * (`blood_components.abo_rule`):
 * - `sel_darah_merah` (PRC): antigen ABO donor ⊆ antigen pasien (O = donor universal);
 * - `plasma` (FFP, trombosit): antibodi donor tidak boleh menyerang sel pasien (AB = donor universal; plasma O hanya
 *   untuk pasien O);
 * - `identik` (darah lengkap): golongan sama.
 * Rh-negatif pasien hanya menerima Rh-negatif untuk semua komponen (konservatif).
 */

export const BLOOD_ABO_RULES = ['sel_darah_merah', 'plasma', 'identik'] as const;
export type BloodAboRule = (typeof BLOOD_ABO_RULES)[number];

const ANTIGENS: Record<AboGroup, readonly string[]> = { A: ['A'], B: ['B'], AB: ['A', 'B'], O: [] };

export function aboCompatible(
  patient: AboGroup,
  donor: AboGroup,
  rule: BloodAboRule = 'sel_darah_merah',
): boolean {
  if (rule === 'identik') return patient === donor;
  if (rule === 'plasma') return ANTIGENS[patient].every((a) => ANTIGENS[donor].includes(a));
  return ANTIGENS[donor].every((a) => ANTIGENS[patient].includes(a));
}

export function rhCompatible(patient: RhFactor, donor: RhFactor): boolean {
  return patient === 'pos' || donor === 'neg';
}

/**
 * Pengeluaran kantong: belum kedaluwarsa, ABO/Rh kompatibel, crossmatch cocok. Darurat tanpa crossmatch hanya sel
 * darah merah golongan O dengan alasan dokter (Rh-negatif bila Rh pasien belum diketahui). Komponen plasma/darah
 * lengkap wajib golongan pasien diketahui. Kantong ABO-inkompatibel tidak pernah keluar.
 */
export function bloodIssueBlock(s: {
  patientAbo: AboGroup | null;
  patientRh: RhFactor | null;
  unitAbo: AboGroup;
  unitRh: RhFactor;
  unitExpired: boolean;
  crossmatchCompatible: boolean;
  emergencyReason: string | null;
  rule?: BloodAboRule;
}): Extract<SupportErrorCode, 'BATCH_EXPIRED' | 'BLOOD_INCOMPATIBLE' | 'CROSSMATCH_REQUIRED'> | null {
  const rule = s.rule ?? 'sel_darah_merah';
  if (s.unitExpired) return 'BATCH_EXPIRED';
  if (s.patientAbo === null && rule !== 'sel_darah_merah') return 'BLOOD_INCOMPATIBLE';
  if (s.patientAbo !== null && !aboCompatible(s.patientAbo, s.unitAbo, rule)) return 'BLOOD_INCOMPATIBLE';
  if (s.patientRh !== null && !rhCompatible(s.patientRh, s.unitRh)) return 'BLOOD_INCOMPATIBLE';
  if (s.crossmatchCompatible) return null;
  const emergency = (s.emergencyReason ?? '').trim().length >= 10;
  if (!emergency || s.unitAbo !== 'O' || rule !== 'sel_darah_merah') return 'CROSSMATCH_REQUIRED';
  if (s.patientRh === null && s.unitRh !== 'neg') return 'BLOOD_INCOMPATIBLE';
  return null;
}

/** Lima butir cek ganda pertama sebelum kantong keluar (CHECK `blood_issue_checks`: semuanya `true`). */
export const BLOOD_ISSUE_CHECK_ITEMS = [
  {
    id: 'identitas',
    label: 'Nama, No. RM, dan tanggal lahir pasien sama di formulir permintaan dan label kantong',
  },
  { id: 'nomor', label: 'Nomor kantong sama dengan hasil crossmatch' },
  { id: 'golongan', label: 'Golongan ABO/Rh kantong kompatibel dengan pasien' },
  { id: 'kedaluwarsa', label: 'Tanggal kedaluwarsa belum lewat' },
  { id: 'kantong_utuh', label: 'Kantong utuh, tidak bocor, tidak hemolisis atau ada bekuan' },
] as const;
export type BloodIssueCheckItem = (typeof BLOOD_ISSUE_CHECK_ITEMS)[number]['id'];

/** Cek ganda pertama berlaku sejak dicatat (trigger `app_blood_issue_double_check`). */
export const BLOOD_ISSUE_CHECK_VALID_MINUTES = 30;

/** Normalisasi kode pindai (gelang/kantong): tanpa spasi, huruf besar. Sama dengan trigger transfusi. */
export const normalizeScanCode = (s: string): string => s.replace(/\s+/g, '').toUpperCase();

export const TRANSFUSION_REACTION_SIGNS = [
  'Menggigil',
  'Gatal / urtikaria',
  'Sesak napas',
  'Nyeri dada / pinggang',
  'Urine gelap',
] as const;

/**
 * Deteksi dugaan reaksi transfusi: gejala apa pun, suhu naik ≥ 1 °C dari TTV awal, atau sistolik turun ≥ 30 mmHg.
 * Bila ya, transfusi dihentikan (jalur infus dipertahankan NaCl 0,9%), DPJP dan bank darah dilapori.
 */
export function transfusionReactionCheck(
  baseline: { tempC: number; systolic: number } | null,
  current: { tempC: number; systolic: number },
  signs: readonly string[],
): { reaction: boolean; reasons: string[] } {
  const reasons: string[] = [...signs];
  if (baseline && current.tempC - baseline.tempC >= 1) {
    reasons.push(`Suhu naik ${(current.tempC - baseline.tempC).toFixed(1).replace('.', ',')} °C`);
  }
  if (baseline && baseline.systolic - current.systolic >= 30) {
    reasons.push(`Sistolik turun ${baseline.systolic - current.systolic} mmHg`);
  }
  return { reaction: reasons.length > 0, reasons };
}
