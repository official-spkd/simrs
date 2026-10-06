/**
 * I12 · API publik dan FHIR server baca-saja (mode presentasi ADR-0023; flag modul `I12`, bawaan mati): klien mitra
 * terdaftar dengan cakupan (scope) resource FHIR, kunci API berbatas umur dengan rotasi, penangguhan beralasan, dan
 * log akses. Rencana fase 7 §7.8: identifier hanya RM + IHS (NIK tidak pernah disertakan); akses per pasien diaudit.
 */

export const FHIR_SCOPES = [
  'Patient.read',
  'Encounter.read',
  'Condition.read',
  'Observation.read',
  'AllergyIntolerance.read',
] as const;
export type FhirScope = (typeof FHIR_SCOPES)[number];

/** Cakupan yang membuka data klinis pasien: wajib dasar persetujuan pasien/kerja sama. */
export const CLINICAL_SCOPES: ReadonlySet<FhirScope> = new Set([
  'Condition.read',
  'Observation.read',
  'AllergyIntolerance.read',
]);

export interface ApiClient {
  id: string;
  name: string;
  purpose: string;
  scopes: readonly FhirScope[];
  status: 'aktif' | 'ditangguhkan';
  keySuffix: string;
  keyCreated: string;
  keyExpires: string;
  lastUsed: string | null;
  basis: string | null;
  suspendedReason: string | null;
}

export interface AccessLog {
  at: string;
  clientId: string;
  request: string;
  status: number;
  note: string;
}

const dayNum = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / 86_400_000;

/** Status kunci: kedaluwarsa, perlu rotasi (≤ 30 hari), atau aman. */
export function keyState(
  c: Pick<ApiClient, 'keyExpires'>,
  today: string,
): { state: 'kedaluwarsa' | 'rotasi' | 'aman'; days: number } {
  const days = Math.round(dayNum(c.keyExpires) - dayNum(today));
  return { state: days < 0 ? 'kedaluwarsa' : days <= 30 ? 'rotasi' : 'aman', days };
}

export interface NewClientInput {
  name: string;
  purpose: string;
  scopes: readonly FhirScope[];
  basis: string;
}

/** Gerbang pendaftaran klien: nama, tujuan, minimal satu cakupan; cakupan klinis wajib dasar persetujuan. */
export function registerGate(input: NewClientInput): string[] {
  const errors: string[] = [];
  if (input.name.trim().length < 3) errors.push('Nama klien wajib diisi.');
  if (input.purpose.trim().length < 10) errors.push('Tujuan pemakaian wajib diisi (minimal 10 karakter).');
  if (input.scopes.length === 0) errors.push('Pilih minimal satu cakupan.');
  if (input.scopes.some((s) => CLINICAL_SCOPES.has(s)) && input.basis.trim().length < 10)
    errors.push(
      'Cakupan data klinis wajib dasar persetujuan pasien atau perjanjian kerja sama (minimal 10 karakter).',
    );
  return errors;
}

export function suspendGate(reason: string): string | null {
  return reason.trim().length >= 10 ? null : 'Alasan penangguhan wajib diisi (minimal 10 karakter).';
}

/** Akhiran kunci baru deterministik (bukan rahasia; kunci asli hanya ditampilkan sekali di produksi). */
export function nextKeySuffix(seed: string, n: number): string {
  let h = 0;
  for (const ch of `${seed}:${n}`) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h.toString(16).slice(-4).padStart(4, '0');
}

/** Tambah hari ke tanggal ISO (YYYY-MM-DD). */
export function addDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}
