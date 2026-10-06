/**
 * I11 · Dataset riset ter-de-identifikasi (docs/02 I11): permintaan → persetujuan komite etik → aturan
 * de-identifikasi per kolom (pengenal langsung wajib dihapus/disamarkan) → uji k-anonimitas pada kuasi-pengenal →
 * persetujuan petugas privasi (≠ pemohon) → ekstrak dengan tautan berbatas waktu dan jejak akses. Fungsi murni
 * untuk layar mode presentasi (ADR-0023).
 */

export type FieldKind = 'pengenal' | 'kuasi' | 'klinis';
export type FieldRule = 'pertahankan' | 'hapus' | 'pseudonim' | 'generalisasi';

export const RULE_LABEL: Record<FieldRule, string> = {
  pertahankan: 'Pertahankan',
  hapus: 'Hapus',
  pseudonim: 'Pseudonim (kode acak per dataset)',
  generalisasi: 'Generalisasi',
};

export interface DatasetField {
  key: string;
  label: string;
  kind: FieldKind;
}

export const K_MIN = 5;
export const ACCESS_DAYS = 30;

export const STAGES = ['Diajukan', 'Etik', 'De-identifikasi', 'Disetujui privasi', 'Diekstrak'] as const;

/** Aturan yang boleh per jenis kolom. */
export function allowedRules(kind: FieldKind): FieldRule[] {
  if (kind === 'pengenal') return ['hapus', 'pseudonim'];
  if (kind === 'kuasi') return ['generalisasi', 'pertahankan', 'hapus'];
  return ['pertahankan', 'hapus'];
}

export function ethicsBlock(number: string, validUntil: string, today: string): string | null {
  if (!/^\S{6,}$/.test(number.trim())) return 'Isi nomor persetujuan etik (minimal 6 karakter, tanpa spasi).';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(validUntil)) return 'Isi masa berlaku dengan format TTTT-BB-HH.';
  if (validUntil <= today) return 'Persetujuan etik sudah tidak berlaku.';
  return null;
}

export interface CohortRow {
  age: number;
  sex: 'L' | 'P';
  district: string;
  city: string;
}

/** Nilai kuasi-pengenal setelah aturan (generalisasi umur = kelompok 10 tahun, wilayah = kota). */
export function quasiKey(row: CohortRow, rules: Readonly<Record<string, FieldRule>>): string {
  const age =
    rules.age === 'hapus'
      ? '*'
      : rules.age === 'generalisasi'
        ? `${Math.floor(row.age / 10) * 10}-an`
        : String(row.age);
  const sex = rules.sex === 'hapus' ? '*' : row.sex;
  const area = rules.district === 'hapus' ? '*' : rules.district === 'generalisasi' ? row.city : row.district;
  return `${age}|${sex}|${area}`;
}

/** k-anonimitas = ukuran kelompok terkecil dengan kombinasi kuasi-pengenal yang sama. */
export function kAnonymity(rows: readonly CohortRow[], rules: Readonly<Record<string, FieldRule>>): number {
  if (rows.length === 0) return 0;
  const groups = new Map<string, number>();
  for (const r of rows) {
    const k = quasiKey(r, rules);
    groups.set(k, (groups.get(k) ?? 0) + 1);
  }
  return Math.min(...groups.values());
}

export function deidBlock(
  fields: readonly DatasetField[],
  rules: Readonly<Record<string, FieldRule | undefined>>,
  k: number,
): string | null {
  const unset = fields.filter((f) => !rules[f.key]);
  if (unset.length) return `Tetapkan aturan untuk ${unset.length} kolom.`;
  const leak = fields.filter(
    (f) => f.kind === 'pengenal' && !['hapus', 'pseudonim'].includes(rules[f.key] ?? ''),
  );
  if (leak.length)
    return `Pengenal langsung wajib dihapus atau disamarkan: ${leak.map((f) => f.label).join(', ')}.`;
  if (k < K_MIN) return `k-anonimitas ${k} < ${K_MIN}: generalisasi atau hapus kuasi-pengenal.`;
  return null;
}

export function privacyApproveBlock(requester: string, approver: string | null): string | null {
  if (!approver) return 'Pilih penyetuju.';
  return approver === requester ? 'Penyetuju harus berbeda dari pemohon dataset.' : null;
}
