/**
 * K12 · Early warning score dewasa pola NEWS2 (Royal College of Physicians 2017, skala SpO2 1). Aturan murni: API
 * menghitung skor saat observasi disimpan (keputusan fase 3 no. 11); web memakai fungsi yang sama untuk pratinjau dan
 * mode presentasi. PEWS/MEOWS tidak di sini: formulir berskor P07.
 */

/** Tingkat kesadaran ACVPU (C = bingung baru). */
export const NEWS2_CONSCIOUSNESS = ['A', 'C', 'V', 'P', 'U'] as const;
export type News2Consciousness = (typeof NEWS2_CONSCIOUSNESS)[number];

export interface News2Input {
  /** Frekuensi napas (×/mnt). */
  rr: number;
  /** Saturasi oksigen (%), skala 1. */
  spo2: number;
  /** Mendapat oksigen tambahan. */
  onOxygen: boolean;
  /** TD sistolik (mmHg). */
  sbp: number;
  /** Nadi (×/mnt). */
  hr: number;
  consciousness: News2Consciousness;
  /** Suhu (°C). */
  temp: number;
}

/** Ambang atas inklusif → skor; nilai di atas ambang terakhir memakai skor baris terakhir (Infinity). */
type Band = ReadonlyArray<readonly [max: number, score: number]>;
const band = (v: number, rules: Band): number => rules.find(([max]) => v <= max)?.[1] ?? 0;

const RR: Band = [
  [8, 3],
  [11, 1],
  [20, 0],
  [24, 2],
  [Infinity, 3],
];
const SPO2: Band = [
  [91, 3],
  [93, 2],
  [95, 1],
  [Infinity, 0],
];
const SBP: Band = [
  [90, 3],
  [100, 2],
  [110, 1],
  [219, 0],
  [Infinity, 3],
];
const HR: Band = [
  [40, 3],
  [50, 1],
  [90, 0],
  [110, 1],
  [130, 2],
  [Infinity, 3],
];
const TEMP: Band = [
  [35, 3],
  [36, 1],
  [38, 0],
  [39, 1],
  [Infinity, 2],
];

/** Skor per parameter, urutan tetap: napas, SpO2, oksigen, TD sistolik, nadi, kesadaran, suhu. */
export function ewsParamScores(o: News2Input): number[] {
  return [
    band(o.rr, RR),
    band(o.spo2, SPO2),
    o.onOxygen ? 2 : 0,
    band(o.sbp, SBP),
    band(o.hr, HR),
    o.consciousness === 'A' ? 0 : 3,
    band(o.temp, TEMP),
  ];
}

/** Skor NEWS2 = jumlah skor parameter (0–20). */
export function ewsScore(o: News2Input): number {
  return ewsParamScores(o).reduce((a, b) => a + b, 0);
}

/** Skor parameter tunggal tertinggi (satu parameter bernilai 3 memicu respons urgen). */
export function ewsMaxParam(o: News2Input): number {
  return Math.max(...ewsParamScores(o));
}

export const EWS_RISK_LEVELS = ['rendah', 'sedang', 'tinggi'] as const;
export type EwsRiskLevel = (typeof EWS_RISK_LEVELS)[number];

export interface EwsRisk {
  level: EwsRiskLevel;
  /** Tindak lanjut sesuai tingkat. */
  action: string;
}

/**
 * Tingkat risiko: ≥ 7 tinggi, 5–6 sedang, 0–4 rendah, kecuali satu parameter bernilai 3 yang menaikkan ke minimal
 * sedang (observasi tiap 1 jam, lapor DPJP).
 */
export function ewsRisk(score: number, maxParam = 0): EwsRisk {
  if (score >= 7) return { level: 'tinggi', action: 'Pantau kontinu, aktifkan tim reaksi cepat.' };
  if (score >= 5) return { level: 'sedang', action: 'Observasi tiap 1 jam, lapor DPJP.' };
  if (maxParam >= 3) {
    return { level: 'sedang', action: 'Satu parameter bernilai 3: observasi tiap 1 jam, lapor DPJP.' };
  }
  return { level: 'rendah', action: 'Lanjutkan observasi tiap 4 jam.' };
}

/**
 * Eskalasi (notifikasi tanpa PHI + SSE, potongan 3.2a): skor ≥ ambang RS (`ews.escalation_score`, bawaan 5) atau satu
 * parameter bernilai 3.
 */
export function ewsNeedsEscalation(score: number, maxParam: number, threshold: number): boolean {
  return score >= threshold || maxParam >= 3;
}
