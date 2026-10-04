import type { IdentifierSystem } from './patient';

/**
 * P05 · Deteksi kemungkinan rekam medis ganda (layar MPI). Fungsi murni: dipanggil dengan profil yang sudah
 * didekripsi dan dinormalisasi oleh pemanggil (API, seed). Skor 0–99 (tidak pernah 100: selalu butuh
 * keputusan petugas); alasan berupa kode tanpa PHI sehingga aman disimpan dan diaudit.
 */

/** Skor minimum agar pasangan masuk antrean tinjauan. */
export const MATCH_THRESHOLD = 40;

export interface MatchProfile {
  id: string;
  mrn: string;
  /** `normalizePersonName`. */
  nameSearch: string;
  sex: string;
  /** `YYYY-MM-DD` atau null. */
  birthDate: string | null;
  birthDateEstimated: boolean;
  /** Nama ibu kandung ternormalisasi, atau null. */
  motherName: string | null;
  phoneHash: string | null;
  /** Alamat ternormalisasi (didekripsi), atau null. */
  address: string | null;
  /** Identifier aktif: hash + nilai baku (didekripsi). */
  identifiers: Partial<Record<IdentifierSystem, { hash: string; value: string }>>;
}

export const MATCH_REASONS = {
  nik_sama: 'NIK sama',
  bpjs_sama: 'No. BPJS sama',
  ihs_sama: 'IHS sama',
  paspor_sama: 'Paspor sama',
  nik_mirip: 'NIK mirip (kemungkinan salah ketik)',
  nik_beda: 'NIK berbeda',
  tgl_lahir_sama: 'Tanggal lahir sama',
  nama_sama: 'Nama sama',
  nama_mirip: 'Nama mirip',
  ibu_sama: 'Nama ibu kandung sama',
  ibu_mirip: 'Nama ibu kandung mirip',
  hp_sama: 'No. HP sama',
  alamat_sama: 'Alamat sama',
  alamat_mirip: 'Alamat mirip',
  kelamin_beda: 'Jenis kelamin berbeda',
} as const;
export type MatchReason = keyof typeof MATCH_REASONS;

export type MatchSeverity = 'tinggi' | 'sedang' | 'rendah';

/** Warna antrean di mockup: ≥ 85 merah, ≥ 70 kuning, selebihnya abu. */
export function matchSeverity(score: number): MatchSeverity {
  if (score >= 85) return 'tinggi';
  if (score >= 70) return 'sedang';
  return 'rendah';
}

/** Trigram per kata seperti pg_trgm (`"  kata "`), untuk kemiripan di luar database. */
function trigrams(text: string): Set<string> {
  const out = new Set<string>();
  for (const word of text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)) {
    const padded = `  ${word} `;
    for (let i = 0; i + 3 <= padded.length; i++) out.add(padded.slice(i, i + 3));
  }
  return out;
}

/** Kemiripan trigram 0–1 (setara `similarity()` pg_trgm untuk teks ternormalisasi). */
export function trigramSimilarity(a: string, b: string): number {
  const ta = trigrams(a);
  const tb = trigrams(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared += 1;
  return shared / (ta.size + tb.size - shared);
}

/**
 * Kemiripan nama: yang terbesar dari trigram utuh dan rata-rata kecocokan per kata. Kata satu huruf cocok
 * dengan kata berawalan huruf itu (`M. Rizky` ~ `Muhammad Rizki`), karena singkatan nama depan umum di RS.
 */
export function nameSimilarity(a: string, b: string): number {
  const whole = trigramSimilarity(a, b);
  const ta = a.split(' ').filter(Boolean);
  const tb = b.split(' ').filter(Boolean);
  if (ta.length === 0 || tb.length === 0) return whole;
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  const used = new Set<number>();
  let total = 0;
  for (const word of short) {
    let best = 0;
    let bestIndex = -1;
    long.forEach((other, i) => {
      if (used.has(i)) return;
      const sim =
        word.length === 1 || other.length === 1
          ? word[0] === other[0]
            ? 0.8
            : 0
          : trigramSimilarity(word, other);
      if (sim > best) {
        best = sim;
        bestIndex = i;
      }
    });
    if (bestIndex >= 0) used.add(bestIndex);
    total += best;
  }
  return Math.max(whole, total / long.length);
}

/** Jarak Damerau-Levenshtein terbatas (sisip, hapus, ganti, tukar dua digit bersebelahan). */
export function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const row = d[i] as number[];
      const prev = d[i - 1] as number[];
      row[j] = Math.min((prev[j] as number) + 1, (row[j - 1] as number) + 1, (prev[j - 1] as number) + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        row[j] = Math.min(row[j] as number, ((d[i - 2] as number[])[j - 2] as number) + 1);
      }
    }
  }
  return (d[a.length] as number[])[b.length] as number;
}

/** Alamat untuk pencocokan: huruf kecil, singkatan umum diseragamkan, tanpa tanda baca. */
export function normalizeAddress(address: string): string {
  return address
    .toLowerCase()
    .replace(/\bjaktim\b/g, 'jakarta timur')
    .replace(/\bjaksel\b/g, 'jakarta selatan')
    .replace(/\bjakut\b/g, 'jakarta utara')
    .replace(/\bjakpus\b/g, 'jakarta pusat')
    .replace(/\bjakbar\b/g, 'jakarta barat')
    .replace(/\b(jl|jln|jalan)\b\.?/g, ' ')
    .replace(/\b(no|nomor)\b\.?/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const IDENTIFIER_SAME: Record<IdentifierSystem, MatchReason> = {
  nik: 'nik_sama',
  bpjs: 'bpjs_sama',
  ihs: 'ihs_sama',
  paspor: 'paspor_sama',
};

/**
 * Skor kecocokan dua profil. Bobot: identifier sama +40 (+5 tiap identifier sama berikutnya), NIK mirip +15,
 * NIK berbeda −25, tanggal lahir sama +20, nama sama +25 / mirip hingga +25 (`nameSimilarity` ≥ 0,3), ibu kandung sama +10 / mirip +6,
 * no. HP sama +10, alamat sama +10 / mirip +5, jenis kelamin berbeda −20.
 */
export function scorePatientMatch(
  a: MatchProfile,
  b: MatchProfile,
): { score: number; reasons: MatchReason[] } {
  const reasons: MatchReason[] = [];
  let score = 0;

  let sameIds = 0;
  for (const system of Object.keys(IDENTIFIER_SAME) as IdentifierSystem[]) {
    const x = a.identifiers[system];
    const y = b.identifiers[system];
    if (x && y && x.hash === y.hash) {
      score += sameIds === 0 ? 40 : 5;
      sameIds += 1;
      reasons.push(IDENTIFIER_SAME[system]);
    }
  }
  const nikA = a.identifiers.nik;
  const nikB = b.identifiers.nik;
  if (nikA && nikB && nikA.hash !== nikB.hash) {
    if (editDistance(nikA.value, nikB.value) <= 2) {
      score += 15;
      reasons.push('nik_mirip');
    } else {
      score -= 25;
      reasons.push('nik_beda');
    }
  }

  if (
    a.birthDate &&
    b.birthDate &&
    !a.birthDateEstimated &&
    !b.birthDateEstimated &&
    a.birthDate === b.birthDate
  ) {
    score += 20;
    reasons.push('tgl_lahir_sama');
  }

  const name = nameSimilarity(a.nameSearch, b.nameSearch);
  if (a.nameSearch === b.nameSearch) {
    score += 25;
    reasons.push('nama_sama');
  } else if (name >= 0.3) {
    score += Math.round(25 * name);
    reasons.push('nama_mirip');
  }

  if (a.motherName && b.motherName) {
    if (a.motherName === b.motherName) {
      score += 10;
      reasons.push('ibu_sama');
    } else if (trigramSimilarity(a.motherName, b.motherName) >= 0.5) {
      score += 6;
      reasons.push('ibu_mirip');
    }
  }

  if (a.phoneHash && b.phoneHash && a.phoneHash === b.phoneHash) {
    score += 10;
    reasons.push('hp_sama');
  }

  if (a.address && b.address) {
    if (a.address === b.address) {
      score += 10;
      reasons.push('alamat_sama');
    } else if (trigramSimilarity(a.address, b.address) >= 0.5) {
      score += 5;
      reasons.push('alamat_mirip');
    }
  }

  if (a.sex !== 'unknown' && b.sex !== 'unknown' && a.sex !== b.sex) {
    score -= 20;
    reasons.push('kelamin_beda');
  }

  return { score: Math.max(0, Math.min(99, score)), reasons };
}

const SUMMARY_SAME: ReadonlyArray<[MatchReason, string]> = [
  ['nik_sama', 'NIK'],
  ['bpjs_sama', 'no. BPJS'],
  ['ihs_sama', 'IHS'],
  ['paspor_sama', 'paspor'],
  ['tgl_lahir_sama', 'tanggal lahir'],
  ['nama_sama', 'nama'],
  ['ibu_sama', 'ibu kandung'],
  ['hp_sama', 'no. HP'],
  ['alamat_sama', 'alamat'],
];
const SUMMARY_SIMILAR: ReadonlyArray<[MatchReason, string]> = [
  ['nama_mirip', 'nama'],
  ['nik_mirip', 'NIK'],
  ['ibu_mirip', 'ibu kandung'],
  ['alamat_mirip', 'alamat'],
];

/** Ringkasan alasan untuk antrean, mis. "NIK, tanggal lahir, dan ibu kandung sama; nama mirip". */
export function matchSummary(reasons: readonly string[]): string {
  const pick = (table: ReadonlyArray<[MatchReason, string]>) =>
    table.filter(([r]) => reasons.includes(r)).map(([, label]) => label);
  const same = pick(SUMMARY_SAME);
  const similar = pick(SUMMARY_SIMILAR);
  const parts: string[] = [];
  if (same.length) parts.push(`${joinWords(same)} sama`);
  if (similar.length) parts.push(`${joinWords(similar)} mirip`);
  if (reasons.includes('nik_beda')) parts.push('NIK berbeda');
  if (reasons.includes('kelamin_beda')) parts.push('jenis kelamin berbeda');
  const text = parts.join('; ');
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : 'Diusulkan untuk ditinjau';
}

/** "a dan b", "a, b, dan c" (koma sebelum "dan" pada perincian, PUEBI). */
function joinWords(items: string[]): string {
  if (items.length <= 2) return items.join(' dan ');
  return `${items.slice(0, -1).join(', ')}, dan ${items.at(-1)}`;
}
