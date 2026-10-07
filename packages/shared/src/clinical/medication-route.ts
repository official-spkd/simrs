/**
 * K09 · Rute pemberian obat terhadap bentuk sediaan (keselamatan resep). CPOE hanya mengisi rute bawaan untuk sediaan
 * oral; sediaan injeksi/infus dan bentuk lain mulai tanpa rute sehingga dokter wajib memilih. Server menolak kombinasi
 * yang jelas bertentangan (injeksi + oral, tablet + intravena) dengan `MEDICATION_ROUTE_INVALID`.
 * Bentuk sediaan = `drugs.dosage_form` (teks bebas master obat RS, mis. "tablet", "kapsul", "injeksi", "infus").
 */

/** Pilihan rute di layar CPOE. */
export const MEDICATION_ROUTE_OPTIONS = [
  'oral',
  'intravena',
  'intramuskular',
  'subkutan',
  'sublingual',
  'inhalasi',
  'topikal',
] as const;

export type DosageFormGroup = 'oral' | 'parenteral' | 'lainnya';

const PARENTERAL_FORM = /\b(injeksi|injeksian|infus|vial|ampul|pen|prefilled)\b/;
const ORAL_FORM = /\b(tablet|kaplet|kapsul|sirup|suspensi|eliksir|puyer|serbuk oral|granul|drops? oral|larutan oral)\b/;

/** Kelompok bentuk sediaan; tidak dikenal/null = `lainnya` (tanpa rute bawaan, tanpa penolakan). */
export function dosageFormGroup(dosageForm: string | null | undefined): DosageFormGroup {
  const f = (dosageForm ?? '').trim().toLowerCase();
  if (!f) return 'lainnya';
  if (PARENTERAL_FORM.test(f)) return 'parenteral';
  if (ORAL_FORM.test(f)) return 'oral';
  return 'lainnya';
}

/** Rute bawaan baris CPOE: hanya `oral` untuk sediaan oral; selain itu kosong (dokter memilih). */
export function defaultMedicationRoute(dosageForm: string | null | undefined): '' | 'oral' {
  return dosageFormGroup(dosageForm) === 'oral' ? 'oral' : '';
}

/** Rute parenteral, termasuk singkatan yang lazim di catatan (IV, IM, SC). */
const PARENTERAL_ROUTE = /^(intravena|intramuskular|subkutan|iv|im|sc|s\.?c\.?|i\.?v\.?|i\.?m\.?)\b/;

function isParenteralRoute(route: string): boolean {
  return PARENTERAL_ROUTE.test(route.trim().toLowerCase());
}

/**
 * Rute bertentangan dengan bentuk sediaan: sediaan parenteral hanya lewat rute parenteral; sediaan oral tidak lewat
 * rute parenteral. Bentuk `lainnya` (salep, inhaler, tetes mata, racikan tanpa bentuk) tidak dinilai.
 */
export function medicationRouteConflict(dosageForm: string | null | undefined, route: string): boolean {
  const group = dosageFormGroup(dosageForm);
  if (group === 'parenteral') return !isParenteralRoute(route);
  if (group === 'oral') return isParenteralRoute(route);
  return false;
}
