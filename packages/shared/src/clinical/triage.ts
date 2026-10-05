import { z } from 'zod';

/**
 * K03 · Saran triase IGD (aturan murni; API = sumber kebenaran, web = pratinjau dan demo). Skala ATS 5 level (keputusan
 * fase 3 no. 6): target ditemui dokter 0/10/30/60/120 menit. Saran dihitung dari tanda vital + pembeda keluhan
 * (diskriminator) yang dipilih petugas triase, bukan dari teks keluhan bebas. Level dipilih petugas; memilih level
 * lebih rendah (angka lebih besar) dari saran = override yang wajib beralasan ≥ `SAFETY_REASON_MIN`, naik bebas.
 *
 * Kebenaran klinis ambang dan diskriminator wajib divalidasi komite medik sebelum pilot (rencana §5).
 */

export const TRIAGE_SCALES = ['ATS'] as const;
export type TriageScale = (typeof TRIAGE_SCALES)[number];

/** Level ATS 1 (paling mendesak) … 5. */
export const ATS_LEVELS = [1, 2, 3, 4, 5] as const;
export type AtsLevel = (typeof ATS_LEVELS)[number];

/** Target waktu ditemui dokter per level (menit). */
export const ATS_TARGET_MINUTES: Readonly<Record<AtsLevel, number>> = { 1: 0, 2: 10, 3: 30, 4: 60, 5: 120 };

export const ATS_LABEL: Readonly<Record<AtsLevel, string>> = {
  1: 'Resusitasi',
  2: 'Emergensi',
  3: 'Urgen',
  4: 'Semi-urgen',
  5: 'Tidak urgen',
};

/**
 * Pembeda keluhan (diskriminator) yang dipilih petugas triase. `level` = level saran bila ada; `floor` = level paling
 * tidak mendesak yang diizinkan protokol (mis. nyeri dada kardiak tidak boleh di bawah level 3).
 */
export const TRIAGE_DISCRIMINATORS = {
  henti_jantung_napas: { label: 'Henti jantung/napas', level: 1 },
  sumbatan_jalan_napas: { label: 'Sumbatan jalan napas', level: 1 },
  kejang_berlangsung: { label: 'Kejang sedang berlangsung', level: 1 },
  nyeri_dada_kardiak: { label: 'Nyeri dada khas jantung', level: 2, floor: 3 },
  defisit_neurologis_akut: { label: 'Defisit neurologis akut (curiga stroke)', level: 2 },
  trauma_mayor: { label: 'Trauma mayor (mekanisme berat)', level: 2 },
  sesak_berat: { label: 'Sesak napas berat', level: 2 },
  nyeri_berat: { label: 'Nyeri berat (skala 8–10)', level: 2 },
  perdarahan_berat: { label: 'Perdarahan berat', level: 2 },
  sesak_sedang: { label: 'Sesak napas sedang', level: 3 },
  nyeri_sedang: { label: 'Nyeri sedang (skala 4–7)', level: 3 },
  muntah_dehidrasi: { label: 'Muntah/diare dengan dehidrasi', level: 3 },
  nyeri_ringan: { label: 'Nyeri ringan (skala 1–3)', level: 4 },
  cedera_ringan: { label: 'Cedera ringan anggota gerak', level: 4 },
  keluhan_ringan: { label: 'Keluhan ringan tanpa tanda bahaya', level: 5 },
} as const satisfies Record<string, { label: string; level: AtsLevel; floor?: AtsLevel }>;
export type TriageDiscriminator = keyof typeof TRIAGE_DISCRIMINATORS;
export const TRIAGE_DISCRIMINATOR_CODES = Object.keys(TRIAGE_DISCRIMINATORS) as [
  TriageDiscriminator,
  ...TriageDiscriminator[],
];

/** Tanda vital triase. Kosong = tidak diukur (tidak dinilai, tidak dianggap normal). */
export const triageVitalsSchema = z.strictObject({
  /** Tekanan darah sistolik (mmHg). */
  sbp: z.int().min(30).max(300).nullable(),
  dbp: z.int().min(10).max(200).nullable(),
  hr: z.int().min(10).max(300).nullable(),
  rr: z.int().min(0).max(80).nullable(),
  spo2: z.int().min(40).max(100).nullable(),
  /** Suhu (°C). */
  temp: z.number().min(25).max(45).nullable(),
  gcs: z.int().min(3).max(15).nullable(),
});
export type TriageVitals = z.infer<typeof triageVitalsSchema>;

export interface TriageInput {
  vitals: TriageVitals;
  discriminators: readonly TriageDiscriminator[];
  /** Umur (tahun); ambang tanda vital dewasa hanya dipakai bila ≥ `TRIAGE_ADULT_AGE`. Null = dianggap dewasa. */
  ageYears: number | null;
}

export interface TriageSuggestion {
  level: AtsLevel;
  /** Level paling tidak mendesak yang diizinkan protokol (5 bila tidak ada batas). */
  maxLevel: AtsLevel;
  /** Alasan saran, urut dari yang paling mendesak (teks untuk petugas, tanpa PHI). */
  reasons: string[];
}

export const TRIAGE_ADULT_AGE = 16;

interface VitalRule {
  level: AtsLevel;
  test: (v: TriageVitals) => boolean;
  reason: (v: TriageVitals) => string;
}

const has = (n: number | null): n is number => n !== null;

/** Ambang dewasa: kegawatan napas, sirkulasi, kesadaran. */
const ADULT_RULES: readonly VitalRule[] = [
  { level: 1, test: (v) => has(v.gcs) && v.gcs <= 8, reason: (v) => `GCS ${v.gcs} (≤ 8)` },
  { level: 1, test: (v) => has(v.rr) && v.rr <= 8, reason: (v) => `Napas ${v.rr}×/mnt (≤ 8)` },
  { level: 1, test: (v) => has(v.sbp) && v.sbp < 80, reason: (v) => `TD sistolik ${v.sbp} (< 80)` },
  { level: 1, test: (v) => has(v.spo2) && v.spo2 < 85, reason: (v) => `SpO2 ${v.spo2}% (< 85)` },
  { level: 2, test: (v) => has(v.gcs) && v.gcs <= 12, reason: (v) => `GCS ${v.gcs} (9–12)` },
  { level: 2, test: (v) => has(v.rr) && v.rr >= 30, reason: (v) => `Napas ${v.rr}×/mnt (≥ 30)` },
  { level: 2, test: (v) => has(v.spo2) && v.spo2 < 92, reason: (v) => `SpO2 ${v.spo2}% (< 92)` },
  { level: 2, test: (v) => has(v.sbp) && v.sbp < 90, reason: (v) => `TD sistolik ${v.sbp} (< 90)` },
  {
    level: 2,
    test: (v) => has(v.hr) && (v.hr >= 130 || v.hr <= 40),
    reason: (v) => `Nadi ${v.hr}×/mnt (≥ 130 atau ≤ 40)`,
  },
  { level: 3, test: (v) => has(v.gcs) && v.gcs <= 14, reason: (v) => `GCS ${v.gcs} (13–14)` },
  { level: 3, test: (v) => has(v.rr) && v.rr >= 25, reason: (v) => `Napas ${v.rr}×/mnt (25–29)` },
  { level: 3, test: (v) => has(v.spo2) && v.spo2 <= 94, reason: (v) => `SpO2 ${v.spo2}% (92–94)` },
  { level: 3, test: (v) => has(v.sbp) && v.sbp < 100, reason: (v) => `TD sistolik ${v.sbp} (90–99)` },
  { level: 3, test: (v) => has(v.hr) && v.hr >= 111, reason: (v) => `Nadi ${v.hr}×/mnt (111–129)` },
];

/**
 * Anak (< 16 tahun): rentang normal nadi/napas berbeda per umur, jadi hanya kriteria yang aman lintas umur yang dinilai
 * (kesadaran, saturasi, nadi/napas ekstrem); sisanya lewat diskriminator. Skala anak (PEWS) menyusul lewat formulir.
 */
const CHILD_RULES: readonly VitalRule[] = [
  { level: 1, test: (v) => has(v.gcs) && v.gcs <= 8, reason: (v) => `GCS ${v.gcs} (≤ 8)` },
  { level: 1, test: (v) => has(v.spo2) && v.spo2 < 85, reason: (v) => `SpO2 ${v.spo2}% (< 85)` },
  { level: 2, test: (v) => has(v.gcs) && v.gcs <= 12, reason: (v) => `GCS ${v.gcs} (9–12)` },
  { level: 2, test: (v) => has(v.spo2) && v.spo2 < 92, reason: (v) => `SpO2 ${v.spo2}% (< 92)` },
  {
    level: 2,
    test: (v) => has(v.hr) && (v.hr >= 180 || v.hr <= 60),
    reason: (v) => `Nadi ${v.hr}×/mnt (≥ 180 atau ≤ 60)`,
  },
  { level: 2, test: (v) => has(v.rr) && v.rr >= 50, reason: (v) => `Napas ${v.rr}×/mnt (≥ 50)` },
  { level: 3, test: (v) => has(v.gcs) && v.gcs <= 14, reason: (v) => `GCS ${v.gcs} (13–14)` },
  { level: 3, test: (v) => has(v.spo2) && v.spo2 <= 94, reason: (v) => `SpO2 ${v.spo2}% (92–94)` },
];

/** Level bila tidak ada kriteria yang cocok: semi-urgen, nilai ulang (bukan "tidak urgen" diam-diam). */
export const TRIAGE_DEFAULT_LEVEL: AtsLevel = 4;

/**
 * Saran level ATS = level paling mendesak dari kriteria tanda vital dan diskriminator yang cocok. Tanpa kriteria apa
 * pun → `TRIAGE_DEFAULT_LEVEL`. `maxLevel` = batas protokol paling ketat dari diskriminator (bawaan 5).
 */
export function suggestTriage(input: TriageInput): TriageSuggestion {
  const adult = input.ageYears === null || input.ageYears >= TRIAGE_ADULT_AGE;
  const matched: Array<{ level: AtsLevel; reason: string }> = [];
  const seen = new Set<string>();
  for (const rule of adult ? ADULT_RULES : CHILD_RULES) {
    if (!rule.test(input.vitals)) continue;
    // Satu parameter cukup dilaporkan sekali, pada level paling mendesak (aturan diurutkan dari level 1).
    const param = rule.reason(input.vitals).split(' ')[0] ?? '';
    if (seen.has(param)) continue;
    seen.add(param);
    matched.push({ level: rule.level, reason: rule.reason(input.vitals) });
  }
  let maxLevel: AtsLevel = 5;
  for (const code of new Set(input.discriminators)) {
    const d: { label: string; level: AtsLevel; floor?: AtsLevel } = TRIAGE_DISCRIMINATORS[code];
    matched.push({ level: d.level, reason: d.label });
    if (d.floor !== undefined && d.floor < maxLevel) maxLevel = d.floor;
  }
  if (matched.length === 0) {
    return {
      level: TRIAGE_DEFAULT_LEVEL,
      maxLevel,
      reasons: ['Belum ada kriteria kegawatan; nilai ulang tanda vital dan keluhan.'],
    };
  }
  matched.sort((a, b) => a.level - b.level);
  const level = Math.min(...matched.map((m) => m.level), maxLevel) as AtsLevel;
  return { level, maxLevel, reasons: matched.map((m) => `Level ${m.level}: ${m.reason}`) };
}

/** Memilih level lebih rendah (angka lebih besar) dari saran = override yang wajib beralasan. */
export function triageNeedsReason(suggested: AtsLevel, chosen: AtsLevel): boolean {
  return chosen > suggested;
}

/**
 * Gerbang triase (server dan pratinjau): level di bawah batas protokol ditolak; level di bawah saran wajib alasan ≥
 * `minReason` karakter. Null = boleh disimpan.
 */
export function triageBlockReason(
  s: Pick<TriageSuggestion, 'level' | 'maxLevel'>,
  chosen: AtsLevel,
  reason: string | null | undefined,
  minReason: number,
): 'TRIAGE_LEVEL_NOT_ALLOWED' | 'TRIAGE_REASON_REQUIRED' | null {
  if (chosen > s.maxLevel) return 'TRIAGE_LEVEL_NOT_ALLOWED';
  if (triageNeedsReason(s.level, chosen) && (reason?.trim().length ?? 0) < minReason) {
    return 'TRIAGE_REASON_REQUIRED';
  }
  return null;
}
