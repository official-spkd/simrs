import { MERGE_ATTRIBUTE_LABEL, type MergeAttribute } from '@simrs/shared';

/** Logika murni layar MPI (/rekam-medis/mpi), terpisah dari komponen agar bisa diuji. */

export type AttributeMatch = 'sama' | 'mirip' | 'beda' | 'kosong';
export type PickSide = 'a' | 'b';

export interface RowLike {
  attribute: MergeAttribute;
  label: string;
  a: string | null;
  b: string | null;
  match: AttributeMatch;
}

/**
 * Sumber bawaan per atribut (mockup MPI): A, kecuali A kosong dan B berisi → B. Atribut yang sama persis
 * tidak perlu diambil dari B.
 */
export function defaultPicks(rows: readonly RowLike[]): Record<string, PickSide> {
  return Object.fromEntries(rows.map((r) => [r.attribute, r.a === null && r.b !== null ? 'b' : 'a']));
}

/** Atribut yang diambil dari B: dipilih B, B berisi, dan nilainya memang berbeda dari A. */
export function takenFromB(rows: readonly RowLike[], picks: Record<string, PickSide>): MergeAttribute[] {
  return rows
    .filter((r) => picks[r.attribute] === 'b' && r.b !== null && r.match !== 'sama')
    .map((r) => r.attribute);
}

export function attributeList(attrs: readonly MergeAttribute[]): string {
  return attrs.map((a) => MERGE_ATTRIBUTE_LABEL[a]).join(', ');
}

/** Kalimat penjelasan di atas tabel, dari hasil banding per atribut. */
export function comparisonBanner(rows: readonly RowLike[]): string {
  const of = (m: AttributeMatch) => rows.filter((r) => r.match === m).map((r) => inSentence(r.label));
  const sentences: string[] = [];
  const same = of('sama');
  const similar = of('mirip');
  const different = of('beda');
  if (same.length) sentences.push(`${capitalize(join(same))} sama.`);
  if (similar.length) sentences.push(`${capitalize(join(similar))} mirip.`);
  if (different.length)
    sentences.push(`${capitalize(join(different))} berbeda: pastikan bukan dua orang berbeda.`);
  const nik = rows.find((r) => r.attribute === 'nik');
  if (nik && (nik.a === null) !== (nik.b === null)) {
    sentences.push(
      `NIK kosong di rekam medis ${nik.a === null ? 'A' : 'B'}; verifikasi KTP sebelum digabung.`,
    );
  }
  return sentences.join(' ');
}

function join(items: string[]): string {
  if (items.length <= 2) return items.join(' dan ');
  return `${items.slice(0, -1).join(', ')}, dan ${items.at(-1)}`;
}

/** Label di tengah kalimat: huruf awal kecil, kecuali singkatan (NIK, IHS SATUSEHAT). */
function inSentence(label: string): string {
  return /^[A-Z]{2,}/.test(label) ? label : label.charAt(0).toLowerCase() + label.slice(1);
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Warna teks kolom "Cocok". */
export const MATCH_TONE: Record<AttributeMatch, string> = {
  sama: 'text-success',
  mirip: 'text-warning',
  beda: 'text-danger',
  kosong: 'text-ink-500',
};

/** Latar baris tabel banding (mockup: mirip kuning pudar, beda merah pudar). */
export const MATCH_ROW_BG: Record<AttributeMatch, string> = {
  sama: 'bg-white',
  mirip: 'bg-[#FFFCF5]',
  beda: 'bg-[#FFFBFA]',
  kosong: 'bg-white',
};

/** Warna skor di antrean: ≥ 85 merah, ≥ 70 kuning, selebihnya abu (mockup). */
export const SEVERITY_TONE: Record<'tinggi' | 'sedang' | 'rendah', string> = {
  tinggi: 'text-danger',
  sedang: 'text-warning',
  rendah: 'text-ink-500',
};

export function mpiHref(pasangan?: string): string {
  return pasangan ? `/rekam-medis/mpi?pasangan=${pasangan}` : '/rekam-medis/mpi';
}
