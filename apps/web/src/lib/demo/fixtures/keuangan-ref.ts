import { PATIENT_ID } from './ids';
import { patientById } from './pasien';

/**
 * Rujukan pasien untuk fixture keuangan lanjutan (U01–U10, I10): nama dan RM diambil dari daftar pasien fiktif
 * bersama (`pasien.ts`), sehingga layar keuangan konsisten dengan layar klinis dan kasir.
 */
export interface PasienRef {
  name: string;
  rm: string;
  place: string;
  payer: string;
}

export function pasienRef(key: keyof typeof PATIENT_ID, place: string, payer: string): PasienRef {
  const p = patientById(PATIENT_ID[key]);
  if (!p) throw new Error(`Pasien ${key} tidak ada di fixture`);
  return { name: p.nama, rm: p.rm, place, payer };
}
