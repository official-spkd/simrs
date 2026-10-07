import type { SupportErrorCode } from '../errors';
import type { AboGroup, RhFactor } from '../schemas/penunjang-api';

/**
 * S08 · Kompatibilitas darah (rencana fase 4 §4.9, keputusan no. 22). Untuk sel darah merah: donor kompatibel bila
 * antigen ABO donor ⊆ antigen pasien; Rh-negatif pasien hanya menerima Rh-negatif. Sama dengan trigger database
 * `blood_issues` (4.0b).
 */

const ANTIGENS: Record<AboGroup, readonly string[]> = { A: ['A'], B: ['B'], AB: ['A', 'B'], O: [] };

export function aboCompatible(patient: AboGroup, donor: AboGroup): boolean {
  return ANTIGENS[donor].every((a) => ANTIGENS[patient].includes(a));
}

export function rhCompatible(patient: RhFactor, donor: RhFactor): boolean {
  return patient === 'pos' || donor === 'neg';
}

/**
 * Pengeluaran kantong: belum kedaluwarsa, ABO/Rh kompatibel, crossmatch cocok. Darurat tanpa crossmatch hanya
 * golongan O dengan alasan dokter (Rh-negatif bila golongan pasien belum diketahui). Kantong ABO-inkompatibel
 * tidak pernah keluar.
 */
export function bloodIssueBlock(s: {
  patientAbo: AboGroup | null;
  patientRh: RhFactor | null;
  unitAbo: AboGroup;
  unitRh: RhFactor;
  unitExpired: boolean;
  crossmatchCompatible: boolean;
  emergencyReason: string | null;
}): Extract<SupportErrorCode, 'BATCH_EXPIRED' | 'BLOOD_INCOMPATIBLE' | 'CROSSMATCH_REQUIRED'> | null {
  if (s.unitExpired) return 'BATCH_EXPIRED';
  if (s.patientAbo !== null && !aboCompatible(s.patientAbo, s.unitAbo)) return 'BLOOD_INCOMPATIBLE';
  if (s.patientRh !== null && !rhCompatible(s.patientRh, s.unitRh)) return 'BLOOD_INCOMPATIBLE';
  if (s.crossmatchCompatible) return null;
  const emergency = (s.emergencyReason ?? '').trim().length >= 10;
  if (!emergency || s.unitAbo !== 'O') return 'CROSSMATCH_REQUIRED';
  if (s.patientRh === null && s.unitRh !== 'neg') return 'BLOOD_INCOMPATIBLE';
  return null;
}
