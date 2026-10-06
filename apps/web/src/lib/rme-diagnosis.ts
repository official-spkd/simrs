import { hasReason } from './rme';

/**
 * K08 · Diagnosis dan problem list: diagnosis kunjungan berkode ICD-10 (tepat satu utama), prosedur ICD-9-CM, daftar
 * masalah lintas kunjungan (aktif/teratasi), dan alergi (atau NKDA). Semua entri immutable: setiap perubahan
 * (jadikan utama, teratasi, salah entri) adalah versi baru yang menunjuk versi lama, beralasan bila membatalkan.
 */

export type DxRank = 'utama' | 'sekunder' | 'komplikasi';
export type DxCertainty = 'kerja' | 'akhir';

export const DX_RANK_LABEL: Record<DxRank, string> = {
  utama: 'Utama',
  sekunder: 'Sekunder',
  komplikasi: 'Komplikasi',
};

interface Versioned {
  id: string;
  version: number;
  supersedesId: string | null;
  by: string;
  at: string;
}

export interface EncounterDx extends Versioned {
  code: string;
  display: string;
  rank: DxRank;
  certainty: DxCertainty;
  /** `salah-entri` = dibatalkan beralasan (tetap tampil dicoret). */
  status: 'aktif' | 'salah-entri';
  reason: string | null;
}

export interface ProcedureEntry {
  id: string;
  code: string;
  display: string;
  by: string;
  at: string;
}

export interface Problem extends Versioned {
  code: string;
  display: string;
  /** Tanggal mulai `YYYY-MM-DD`. */
  onset: string;
  status: 'aktif' | 'teratasi';
  resolvedOn: string | null;
  note: string | null;
}

export type AllergySeverity = 'ringan' | 'sedang' | 'berat';

export interface AllergyEntry extends Versioned {
  substance: string;
  reaction: string;
  severity: AllergySeverity;
  status: 'aktif' | 'salah-entri';
  reason: string | null;
}

/** Versi terbaru tiap rantai (entri yang tidak digantikan). */
export function current<T extends Versioned>(list: readonly T[]): T[] {
  const old = new Set(list.map((x) => x.supersedesId).filter((x): x is string => !!x));
  return list.filter((x) => !old.has(x.id));
}

/** Entri baru yang menggantikan `prev` (versi + 1). */
export function nextVersion<T extends Versioned>(
  prev: T,
  patch: Partial<T>,
  by: string,
  at: string,
  id: string,
): T {
  return { ...prev, ...patch, id, version: prev.version + 1, supersedesId: prev.id, by, at };
}

export function activeDx(list: readonly EncounterDx[]): EncounterDx[] {
  return current(list).filter((d) => d.status === 'aktif');
}

export function primaryDx(list: readonly EncounterDx[]): EncounterDx[] {
  return activeDx(list).filter((d) => d.rank === 'utama');
}

/** Gerbang tambah diagnosis: kode ganda dan diagnosis utama kedua ditolak (null = boleh). */
export function addDxBlocker(list: readonly EncounterDx[], code: string, rank: DxRank): string | null {
  if (!code) return 'Pilih kode ICD-10.';
  if (activeDx(list).some((d) => d.code === code)) return `Kode ${code} sudah tercatat pada kunjungan ini.`;
  const primary = primaryDx(list)[0];
  if (rank === 'utama' && primary) {
    return `Diagnosis utama sudah ada (${primary.code}). Tambahkan sebagai sekunder, lalu pakai "Jadikan utama" untuk menggantinya.`;
  }
  return null;
}

/**
 * Jadikan `id` diagnosis utama: utama lama turun menjadi sekunder dan yang dipilih naik menjadi utama, masing-masing
 * sebagai versi baru. Mengembalikan entri baru yang ditambahkan.
 */
export function setPrimary(
  list: readonly EncounterDx[],
  id: string,
  by: string,
  at: string,
  newId: (n: number) => string,
): EncounterDx[] {
  const target = activeDx(list).find((d) => d.id === id);
  if (!target) throw new Error('Diagnosis tidak ditemukan.');
  if (target.rank === 'utama') return [];
  const out: EncounterDx[] = [];
  for (const old of primaryDx(list))
    out.push(nextVersion(old, { rank: 'sekunder' }, by, at, newId(out.length)));
  out.push(nextVersion(target, { rank: 'utama' }, by, at, newId(out.length)));
  return out;
}

/** Salah entri = versi baru berstatus `salah-entri` dengan alasan ≥ 10 karakter. */
export function markDxError(
  prev: EncounterDx,
  reason: string,
  by: string,
  at: string,
  id: string,
): EncounterDx {
  if (!hasReason(reason)) throw new Error('Alasan salah entri minimal 10 karakter.');
  return nextVersion(prev, { status: 'salah-entri', reason: reason.trim() }, by, at, id);
}

/** Diagnosis akhir butuh tepat satu diagnosis utama aktif. */
export function finalizeBlocker(list: readonly EncounterDx[]): string | null {
  const n = primaryDx(list).length;
  if (n === 0) return 'Belum ada diagnosis utama. Tetapkan tepat satu diagnosis utama.';
  if (n > 1) return 'Diagnosis utama lebih dari satu. Pertahankan tepat satu.';
  if (activeDx(list).every((d) => d.certainty === 'akhir')) return 'Diagnosis akhir sudah ditetapkan.';
  return null;
}

/** Tetapkan diagnosis akhir: setiap diagnosis kerja aktif menjadi versi baru berstatus `akhir`. */
export function finalizeDx(
  list: readonly EncounterDx[],
  by: string,
  at: string,
  newId: (n: number) => string,
): EncounterDx[] {
  return activeDx(list)
    .filter((d) => d.certainty === 'kerja')
    .map((d, i) => nextVersion(d, { certainty: 'akhir' }, by, at, newId(i)));
}

/** Diagnosis kunjungan yang belum ada di problem list aktif (bisa dimasukkan). */
export function canAddToProblems(problems: readonly Problem[], code: string): boolean {
  return !current(problems).some((p) => p.code === code && p.status === 'aktif');
}

export function resolveProblem(
  prev: Problem,
  o: { resolvedOn: string; note: string; by: string; at: string; id: string },
): Problem {
  if (prev.status === 'teratasi') throw new Error('Masalah sudah teratasi.');
  if (!o.resolvedOn) throw new Error('Tanggal teratasi wajib.');
  return nextVersion(
    prev,
    { status: 'teratasi', resolvedOn: o.resolvedOn, note: o.note.trim() || null },
    o.by,
    o.at,
    o.id,
  );
}

export function activeAllergies(list: readonly AllergyEntry[]): AllergyEntry[] {
  return current(list).filter((a) => a.status === 'aktif');
}

/** Gerbang tambah alergi: zat dan reaksi wajib, zat ganda ditolak. */
export function addAllergyBlocker(
  list: readonly AllergyEntry[],
  substance: string,
  reaction: string,
): string | null {
  if (!substance.trim()) return 'Isi nama zat/obat penyebab alergi.';
  if (!reaction.trim()) return 'Isi reaksi yang dialami pasien.';
  const s = substance.trim().toLowerCase();
  if (activeAllergies(list).some((a) => a.substance.toLowerCase() === s))
    return `${substance.trim()} sudah tercatat.`;
  return null;
}

/** NKDA (tidak ada alergi yang diketahui) hanya bila tidak ada alergi aktif. */
export function nkdaBlocker(list: readonly AllergyEntry[]): string | null {
  const n = activeAllergies(list).length;
  return n > 0 ? `Masih ada ${n} alergi aktif; batalkan sebagai salah entri dulu bila memang keliru.` : null;
}

export function markAllergyError(
  prev: AllergyEntry,
  reason: string,
  by: string,
  at: string,
  id: string,
): AllergyEntry {
  if (!hasReason(reason)) throw new Error('Alasan salah entri minimal 10 karakter.');
  return nextVersion(prev, { status: 'salah-entri', reason: reason.trim() }, by, at, id);
}

/** Posisi yang mengubah diagnosis/problem list (dokter); alergi juga boleh dicatat perawat dan bidan. */
export function canEditDiagnosis(role: string | null): boolean {
  return role === 'dokter' || role === 'dokter_residen';
}

export function canEditAllergy(role: string | null): boolean {
  return canEditDiagnosis(role) || role === 'perawat' || role === 'bidan';
}
