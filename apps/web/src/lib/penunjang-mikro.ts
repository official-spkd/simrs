import type { SupportPatient } from '@simrs/shared';

/**
 * S02 · Mikrobiologi dan patologi anatomi (mode presentasi, ADR-0023). Kultur bertahap: inkubasi → pewarnaan Gram
 * (laporan awal; kultur darah positif = nilai kritis S09) → identifikasi organisme (daftar lokal, keputusan fase 4
 * #20) → uji kepekaan antibiotik S/I/R → laporan akhir ber-TTE. Patologi anatomi: makroskopik → mikroskopik →
 * diagnosis → TTE Sp.PA; setelah ditandatangani terkunci, koreksi lewat addendum (rekam medis immutable).
 */

export type CultureStage = 'inkubasi' | 'pewarnaan' | 'identifikasi' | 'kepekaan' | 'validasi' | 'final';

export const CULTURE_STEPS: ReadonlyArray<{ id: CultureStage; label: string }> = [
  { id: 'inkubasi', label: 'Inkubasi' },
  { id: 'pewarnaan', label: 'Pewarnaan Gram' },
  { id: 'identifikasi', label: 'Identifikasi' },
  { id: 'kepekaan', label: 'Uji kepekaan' },
  { id: 'validasi', label: 'Validasi & TTE' },
  { id: 'final', label: 'Laporan akhir' },
];

export const GRAM_RESULTS = [
  'Batang Gram negatif',
  'Kokus Gram positif bergerombol',
  'Diplokokus Gram positif',
  'Sel ragi',
] as const;
export type GramResult = (typeof GRAM_RESULTS)[number];

/** Daftar organisme lokal per hasil Gram (pemetaan SNOMED menyusul P06). */
export const ORGANISMS: Readonly<Record<GramResult, readonly string[]>> = {
  'Batang Gram negatif': [
    'Escherichia coli',
    'Klebsiella pneumoniae',
    'Pseudomonas aeruginosa',
    'Acinetobacter baumannii',
  ],
  'Kokus Gram positif bergerombol': ['Staphylococcus aureus', 'Staphylococcus koagulase negatif'],
  'Diplokokus Gram positif': ['Streptococcus pneumoniae'],
  'Sel ragi': ['Candida albicans'],
};

/** Panel antibiotik uji kepekaan per kelompok organisme. */
export const AST_PANELS: Readonly<Record<GramResult, readonly string[]>> = {
  'Batang Gram negatif': [
    'Ampisilin',
    'Seftriakson',
    'Sefepim',
    'Meropenem',
    'Siprofloksasin',
    'Gentamisin',
    'Kotrimoksazol',
  ],
  'Kokus Gram positif bergerombol': [
    'Oksasilin',
    'Vankomisin',
    'Eritromisin',
    'Klindamisin',
    'Kotrimoksazol',
  ],
  'Diplokokus Gram positif': ['Penisilin', 'Seftriakson', 'Eritromisin', 'Levofloksasin'],
  'Sel ragi': ['Flukonazol', 'Vorikonazol'],
};

export type Sir = 'S' | 'I' | 'R';
export const SIR_LABEL: Record<Sir, string> = { S: 'Sensitif', I: 'Intermediet', R: 'Resisten' };

export interface CultureCase {
  id: string;
  labNo: string;
  patient: SupportPatient;
  location: string;
  dpjp: string;
  specimen: string;
  /** Darah: pertumbuhan apa pun = nilai kritis. */
  blood: boolean;
  takenAt: string;
  receivedAt: string;
  growth: { grew: boolean; at: string } | null;
  gram: { result: GramResult; at: string; by: string } | null;
  organism: { name: string; at: string; by: string } | null;
  ast: Readonly<Record<string, Sir>>;
  astAt: string | null;
  final: { at: string; by: string } | null;
  /** Catatan laporan awal (preliminary) yang sudah dikirim. */
  preliminary: string | null;
}

export function cultureStage(c: CultureCase): CultureStage {
  if (c.final) return 'final';
  if (!c.growth) return 'inkubasi';
  if (!c.growth.grew) return 'validasi';
  if (!c.gram) return 'pewarnaan';
  if (!c.organism) return 'identifikasi';
  if (!c.astAt) return 'kepekaan';
  return 'validasi';
}

export type MicroGateCode =
  | 'STAGE'
  | 'GRAM_UNKNOWN'
  | 'ORGANISM_MISMATCH'
  | 'AST_INCOMPLETE'
  | 'TEXT_REQUIRED'
  | 'SIGNED_LOCKED'
  | 'NOT_SIGNED';

export const MICRO_GATE_TEXT: Record<MicroGateCode, string> = {
  STAGE: 'Langkah ini belum bisa dilakukan; selesaikan tahap sebelumnya dulu.',
  GRAM_UNKNOWN: 'Hasil pewarnaan Gram tidak dikenal.',
  ORGANISM_MISMATCH: 'Organisme tidak sesuai dengan hasil pewarnaan Gram.',
  AST_INCOMPLETE: 'Semua antibiotik di panel wajib diisi S/I/R sebelum disimpan.',
  TEXT_REQUIRED: 'Isian wajib minimal 10 karakter.',
  SIGNED_LOCKED: 'Laporan sudah ditandatangani dan terkunci. Koreksi lewat addendum.',
  NOT_SIGNED: 'Addendum hanya untuk laporan yang sudah ditandatangani.',
};

export type MicroAction =
  | { type: 'pertumbuhan'; grew: boolean }
  | { type: 'gram'; result: string }
  | { type: 'identifikasi'; organism: string }
  | { type: 'kepekaan'; results: Readonly<Record<string, Sir>> }
  | { type: 'final' };

type Ctx = { at: string; by: string };

/** Terapkan satu langkah kultur; urutan tahap dijaga (tidak bisa melompat). */
export function applyCulture(
  c: CultureCase,
  a: MicroAction,
  ctx: Ctx,
): { ok: true; next: CultureCase; message: string; critical: boolean } | { ok: false; code: MicroGateCode } {
  const stage = cultureStage(c);
  switch (a.type) {
    case 'pertumbuhan': {
      if (stage !== 'inkubasi') return { ok: false, code: 'STAGE' };
      return {
        ok: true,
        next: { ...c, growth: { grew: a.grew, at: ctx.at } },
        message: a.grew ? `${c.specimen}: tumbuh, lanjut pewarnaan Gram` : `${c.specimen}: tidak tumbuh`,
        critical: false,
      };
    }
    case 'gram': {
      if (stage !== 'pewarnaan') return { ok: false, code: 'STAGE' };
      if (!(GRAM_RESULTS as readonly string[]).includes(a.result)) return { ok: false, code: 'GRAM_UNKNOWN' };
      const result = a.result as GramResult;
      return {
        ok: true,
        next: {
          ...c,
          gram: { result, at: ctx.at, by: ctx.by },
          preliminary: `Laporan awal: ${result}`,
        },
        message: `Pewarnaan Gram: ${result} · laporan awal dikirim ke DPJP`,
        critical: c.blood,
      };
    }
    case 'identifikasi': {
      if (stage !== 'identifikasi' || !c.gram) return { ok: false, code: 'STAGE' };
      if (!ORGANISMS[c.gram.result].includes(a.organism)) return { ok: false, code: 'ORGANISM_MISMATCH' };
      return {
        ok: true,
        next: { ...c, organism: { name: a.organism, at: ctx.at, by: ctx.by } },
        message: `Organisme teridentifikasi: ${a.organism}`,
        critical: false,
      };
    }
    case 'kepekaan': {
      if (stage !== 'kepekaan' || !c.gram) return { ok: false, code: 'STAGE' };
      const panel = AST_PANELS[c.gram.result];
      if (!panel.every((ab) => a.results[ab])) return { ok: false, code: 'AST_INCOMPLETE' };
      const resistant = panel.filter((ab) => a.results[ab] === 'R');
      return {
        ok: true,
        next: { ...c, ast: { ...a.results }, astAt: ctx.at },
        message: `Uji kepekaan ${c.organism?.name ?? ''} tersimpan${resistant.length ? ` · resisten: ${resistant.join(', ')}` : ''}`,
        critical: false,
      };
    }
    case 'final': {
      if (stage !== 'validasi') return { ok: false, code: 'STAGE' };
      return {
        ok: true,
        next: { ...c, final: { at: ctx.at, by: ctx.by } },
        message: `Laporan akhir ${c.labNo} divalidasi dan ditandatangani (TTE ${ctx.by})`,
        critical: false,
      };
    }
  }
}

/** Antibiotik di panel yang termasuk alergi obat pasien (ditandai di laporan). */
export function allergyFlags(c: Pick<CultureCase, 'patient' | 'gram'>): string[] {
  if (!c.gram) return [];
  const allergies = c.patient.allergies.map((a) => a.toLowerCase());
  return AST_PANELS[c.gram.result].filter((ab) => allergies.some((a) => a.includes(ab.toLowerCase())));
}

// ─── Patologi anatomi ──────────────────────────────────────────────────────────────────────────────────────

export interface PaCase {
  id: string;
  paNo: string;
  patient: SupportPatient;
  location: string;
  dpjp: string;
  specimen: string;
  clinical: string;
  receivedAt: string;
  macro: string;
  micro: string;
  diagnosis: string;
  signed: { at: string; by: string } | null;
  addenda: ReadonlyArray<{ at: string; by: string; text: string }>;
}

export type PaStage = 'makroskopik' | 'mikroskopik' | 'diagnosis' | 'ditandatangani';

export const PA_STEPS: ReadonlyArray<{ id: PaStage; label: string }> = [
  { id: 'makroskopik', label: 'Makroskopik' },
  { id: 'mikroskopik', label: 'Mikroskopik' },
  { id: 'diagnosis', label: 'Diagnosis' },
  { id: 'ditandatangani', label: 'TTE Sp.PA' },
];

export function paStage(p: Pick<PaCase, 'macro' | 'micro' | 'diagnosis' | 'signed'>): PaStage {
  if (p.signed) return 'ditandatangani';
  if (p.macro.trim().length < 10) return 'makroskopik';
  if (p.micro.trim().length < 10) return 'mikroskopik';
  return 'diagnosis';
}

/** Gerbang TTE PA: ketiga isian lengkap (≥ 10 karakter) dan belum ditandatangani. */
export function paSignGate(
  p: Pick<PaCase, 'macro' | 'micro' | 'diagnosis' | 'signed'>,
): MicroGateCode | null {
  if (p.signed) return 'SIGNED_LOCKED';
  if ([p.macro, p.micro, p.diagnosis].some((t) => t.trim().length < 10)) return 'TEXT_REQUIRED';
  return null;
}

/** Addendum hanya untuk laporan ber-TTE; isi lama tidak pernah diubah. */
export function paAddendumGate(p: Pick<PaCase, 'signed'>, text: string): MicroGateCode | null {
  if (!p.signed) return 'NOT_SIGNED';
  if (text.trim().length < 10) return 'TEXT_REQUIRED';
  return null;
}
