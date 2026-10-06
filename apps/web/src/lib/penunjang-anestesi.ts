/**
 * S06 · Anestesi (melengkapi layar Kamar operasi, mode presentasi ADR-0023): asesmen pra-anestesi dengan kelas ASA,
 * puasa, jalan napas, rencana, dan persetujuan anestesi; induksi baru boleh setelah asesmen ditandatangani DAN
 * sign in daftar tilik WHO dikonfirmasi (urutan sign in → time out → sign out tetap dijaga layar OK); monitoring
 * intraoperasi dengan peringatan nilai di luar batas.
 */

export const ASA_CLASSES = ['I', 'II', 'III', 'IV', 'V'] as const;
export type AsaClass = (typeof ASA_CLASSES)[number];

export const ASA_LABEL: Record<AsaClass, string> = {
  I: 'Pasien sehat',
  II: 'Penyakit sistemik ringan',
  III: 'Penyakit sistemik berat',
  IV: 'Penyakit sistemik berat yang mengancam jiwa',
  V: 'Moribund, tidak diharapkan bertahan tanpa operasi',
};

export const AIRWAY_OPTIONS = ['Mallampati I', 'Mallampati II', 'Mallampati III', 'Mallampati IV'] as const;

export interface PreAnesthesia {
  asa: AsaClass | null;
  /** Kasus darurat (ASA "E"): puasa tidak menahan, tetapi dicatat sebagai risiko aspirasi. */
  emergency: boolean;
  fastingSince: string;
  airway: string;
  plan: string;
  consent: boolean;
  signed: { at: string; by: string } | null;
}

export interface IntraVitals {
  at: string;
  systolic: number;
  diastolic: number;
  pulse: number;
  spo2: number;
  etco2: number;
}

export interface AnesthesiaRecord {
  pre: PreAnesthesia;
  inductionAt: string | null;
  vitals: readonly IntraVitals[];
}

export const EMPTY_PRE: PreAnesthesia = {
  asa: null,
  emergency: false,
  fastingSince: '',
  airway: '',
  plan: '',
  consent: false,
  signed: null,
};

/** Isian pra-anestesi yang belum lengkap (teks Indonesia, urut tampilan). */
export function preAnesthesiaMissing(p: PreAnesthesia): string[] {
  const missing: string[] = [];
  if (!p.asa) missing.push('kelas ASA');
  if (!p.emergency && p.fastingSince.trim().length < 4) missing.push('jam mulai puasa');
  if (!p.airway) missing.push('penilaian jalan napas');
  if (p.plan.trim().length < 5) missing.push('rencana anestesi');
  if (!p.consent) missing.push('persetujuan anestesi');
  return missing;
}

export function asaText(p: Pick<PreAnesthesia, 'asa' | 'emergency'>): string {
  return p.asa ? `ASA ${p.asa}${p.emergency ? 'E' : ''}` : 'ASA belum dinilai';
}

export type InductionBlock = 'PRE_ANESTHESIA' | 'SIGN_IN' | 'ALREADY' | null;

/** Induksi terkunci sampai asesmen pra-anestesi ditandatangani dan sign in WHO dikonfirmasi. */
export function inductionGate(rec: AnesthesiaRecord, signInConfirmed: boolean): InductionBlock {
  if (rec.inductionAt) return 'ALREADY';
  if (!rec.pre.signed) return 'PRE_ANESTHESIA';
  if (!signInConfirmed) return 'SIGN_IN';
  return null;
}

export const INDUCTION_BLOCK_TEXT: Record<Exclude<InductionBlock, null>, string> = {
  PRE_ANESTHESIA: 'Induksi terkunci: asesmen pra-anestesi belum ditandatangani dokter anestesi.',
  SIGN_IN: 'Induksi terkunci: konfirmasi sign in daftar tilik WHO lebih dulu.',
  ALREADY: 'Induksi sudah dicatat.',
};

/** Peringatan monitoring intraoperasi: SpO₂ < 92%, sistolik < 90 atau > 180 mmHg, nadi < 50 atau > 120, EtCO₂ di luar 30–45. */
export function vitalsWarnings(v: Omit<IntraVitals, 'at'>): string[] {
  const w: string[] = [];
  if (v.spo2 < 92) w.push(`SpO₂ ${v.spo2}%`);
  if (v.systolic < 90) w.push(`hipotensi ${v.systolic}/${v.diastolic}`);
  if (v.systolic > 180) w.push(`hipertensi ${v.systolic}/${v.diastolic}`);
  if (v.pulse < 50 || v.pulse > 120) w.push(`nadi ${v.pulse}`);
  if (v.etco2 < 30 || v.etco2 > 45) w.push(`EtCO₂ ${v.etco2}`);
  return w;
}
