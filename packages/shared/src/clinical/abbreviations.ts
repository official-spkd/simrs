import { z } from 'zod';

/**
 * K07/K09 · Singkatan terlarang ("Do Not Use", EP 9a): daftar baku per RS (tabel `abbreviations`, potongan 3.0c) yang
 * memicu PERINGATAN, tidak memblokir (keputusan fase 3 no. 16). Aturan murni: teks CPPT/instruksi/aturan pakai diperiksa
 * server (dan dipratinjau web) terhadap daftar RS.
 *
 * - `token`: kata utuh, peka huruf besar (`MS` terlarang, `ms` milidetik di EKG tidak); varian huruf kecil didaftar sendiri.
 * - `pattern`: ekspresi reguler (sumber dari daftar RS, mis. angka nol di belakang koma `1,0 mg`).
 */
export const ABBREVIATION_KINDS = ['token', 'pattern'] as const;
export type AbbreviationKind = (typeof ABBREVIATION_KINDS)[number];

export const forbiddenAbbreviationSchema = z
  .strictObject({
    kind: z.enum(ABBREVIATION_KINDS),
    /** Token apa adanya, atau sumber regex untuk `pattern`. */
    term: z.string().trim().min(1).max(60),
    /** Pengganti yang dianjurkan, mis. "tulis 'unit'". */
    suggestion: z.string().trim().min(1).max(120),
  })
  .refine(
    (v) => {
      if (v.kind !== 'pattern') return true;
      try {
        new RegExp(v.term, 'u');
        return true;
      } catch {
        return false;
      }
    },
    { message: 'Pola singkatan bukan ekspresi reguler yang valid', path: ['term'] },
  );
export type ForbiddenAbbreviation = z.infer<typeof forbiddenAbbreviationSchema>;

/**
 * Daftar contoh "Do Not Use" (JCI/ISMP, disesuaikan penulisan desimal koma). Seed RS memakainya sebagai titik awal;
 * komite rekam medis menyesuaikan daftar RS.
 */
export const SAMPLE_FORBIDDEN_ABBREVIATIONS: readonly ForbiddenAbbreviation[] = [
  { kind: 'token', term: 'U', suggestion: "Tulis 'unit' (U terbaca 0 atau 4)." },
  { kind: 'token', term: 'IU', suggestion: "Tulis 'unit internasional' (IU terbaca IV atau 10)." },
  { kind: 'token', term: 'QD', suggestion: "Tulis 'setiap hari' (QD tertukar dengan QID)." },
  { kind: 'token', term: 'qd', suggestion: "Tulis 'setiap hari' (qd tertukar dengan qid)." },
  { kind: 'token', term: 'Q.D.', suggestion: "Tulis 'setiap hari'." },
  { kind: 'token', term: 'q.d.', suggestion: "Tulis 'setiap hari'." },
  { kind: 'token', term: 'QOD', suggestion: "Tulis 'selang sehari'." },
  { kind: 'token', term: 'Q.O.D.', suggestion: "Tulis 'selang sehari'." },
  { kind: 'token', term: 'MS', suggestion: "Tulis 'morfin sulfat' atau 'magnesium sulfat'." },
  { kind: 'token', term: 'MSO4', suggestion: "Tulis 'morfin sulfat'." },
  { kind: 'token', term: 'MgSO4', suggestion: "Tulis 'magnesium sulfat'." },
  {
    kind: 'pattern',
    term: '\\b\\d+[.,]0\\s?(?:mg|mcg|g|mL|unit)\\b',
    suggestion: "Jangan menulis nol di belakang koma (1,0 mg terbaca 10 mg); tulis '1 mg'.",
  },
  {
    kind: 'pattern',
    term: '(?<![\\d\\w])[.,]\\d+\\s?(?:mg|mcg|g|mL|unit)\\b',
    suggestion: "Selalu tulis nol di depan koma (,5 mg terbaca 5 mg); tulis '0,5 mg'.",
  },
];

export interface AbbreviationMatch {
  /** Teks yang cocok persis seperti tertulis. */
  found: string;
  index: number;
  suggestion: string;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Batas kata untuk token: bukan huruf/titik di kiri (angka boleh: `10U` justru kasus berbahaya), bukan huruf/angka di
 * kanan.
 */
function tokenRegExp(term: string): RegExp {
  return new RegExp(`(?<![\\p{L}.])${escapeRegExp(term)}(?![\\p{L}\\p{N}])`, 'gu');
}

/** Semua singkatan terlarang di teks (urut posisi). Teks kosong → []. */
export function findForbiddenAbbreviations(
  text: string,
  list: readonly ForbiddenAbbreviation[],
): AbbreviationMatch[] {
  if (!text.trim()) return [];
  const matches: AbbreviationMatch[] = [];
  for (const a of list) {
    const re = a.kind === 'token' ? tokenRegExp(a.term) : new RegExp(a.term, 'gu');
    for (const m of text.matchAll(re)) {
      matches.push({ found: m[0], index: m.index, suggestion: a.suggestion });
    }
  }
  // Token bertitik (Q.D.) dan tanpa titik (QD) bisa menunjuk posisi sama: satu temuan per posisi.
  const seen = new Set<number>();
  return matches
    .sort((a, b) => a.index - b.index || b.found.length - a.found.length)
    .filter((m) => (seen.has(m.index) ? false : (seen.add(m.index), true)));
}
