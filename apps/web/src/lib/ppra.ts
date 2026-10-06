/**
 * B08 · Program pengendalian resistansi antimikroba (rencana fase 8 §8.5): antibiotik restriksi bertingkat
 * (kebijakan RS), order `pending_approval` yang kedaluwarsa 24 jam bila tidak diputus, persetujuan/penolakan
 * beralasan oleh tim PPRA, dan audit kualitas penggunaan antibiotik metode Gyssens. Modul dapat dimatikan per RS.
 */

export type Restriction = 'bebas' | 'pengawasan' | 'cadangan';

export const RESTRICTION_LABEL: Record<Restriction, string> = {
  bebas: 'Lini pertama · tanpa persetujuan',
  pengawasan: 'Pengawasan · dipantau tim PPRA',
  cadangan: 'Cadangan · wajib persetujuan tim PPRA',
};

export const APPROVAL_EXPIRY_HOURS = 24;

/** Status order antibiotik di CPOE saat modul aktif/mati. */
export function orderHold(restriction: Restriction, moduleOn: boolean): 'langsung' | 'ditahan' {
  return moduleOn && restriction === 'cadangan' ? 'ditahan' : 'langsung';
}

/** Jam tersisa sebelum permintaan kedaluwarsa (negatif = kedaluwarsa). */
export function approvalHoursLeft(requestedAt: string, now: string, hours = APPROVAL_EXPIRY_HOURS): number {
  return Math.floor((Date.parse(requestedAt) + hours * 3_600_000 - Date.parse(now)) / 3_600_000);
}

/** Persetujuan wajib alasan; penolakan wajib alasan dan saran alternatif. */
export function decisionBlock(kind: 'setuju' | 'tolak', reason: string, alternative: string): string | null {
  if (reason.trim().length < 10) return 'Tulis pertimbangan klinis minimal 10 huruf.';
  if (kind === 'tolak' && alternative.trim().length < 3)
    return 'Sebutkan antibiotik alternatif yang disarankan.';
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Gyssens

export interface GyssensStep {
  /** Kategori bila jawaban "ya" menghentikan alur di langkah ini. */
  category: string;
  question: string;
  /** Jawaban yang menghentikan alur (kategori di atas). */
  stopOn: boolean;
}

/** Alur Gyssens berurutan: berhenti pada jawaban pertama yang menandai masalah; lolos semua = kategori 0. */
export const GYSSENS_STEPS: readonly GyssensStep[] = [
  { category: 'VI', question: 'Data rekam medis tidak lengkap untuk dinilai?', stopOn: true },
  { category: 'V', question: 'Tidak ada indikasi pemberian antibiotik?', stopOn: true },
  { category: 'IVA', question: 'Ada antibiotik lain yang lebih efektif?', stopOn: true },
  { category: 'IVB', question: 'Ada alternatif yang kurang toksik?', stopOn: true },
  { category: 'IVC', question: 'Ada alternatif yang lebih murah?', stopOn: true },
  { category: 'IVD', question: 'Ada alternatif dengan spektrum lebih sempit?', stopOn: true },
  { category: 'IIIA', question: 'Durasi pemberian terlalu lama?', stopOn: true },
  { category: 'IIIB', question: 'Durasi pemberian terlalu singkat?', stopOn: true },
  { category: 'IIA', question: 'Dosis tidak tepat?', stopOn: true },
  { category: 'IIB', question: 'Interval pemberian tidak tepat?', stopOn: true },
  { category: 'IIC', question: 'Rute pemberian tidak tepat?', stopOn: true },
  { category: 'I', question: 'Waktu pemberian tidak tepat?', stopOn: true },
];

export const GYSSENS_LABEL: Record<string, string> = {
  '0': 'Penggunaan tepat',
  I: 'Waktu pemberian tidak tepat',
  IIA: 'Dosis tidak tepat',
  IIB: 'Interval tidak tepat',
  IIC: 'Rute tidak tepat',
  IIIA: 'Durasi terlalu lama',
  IIIB: 'Durasi terlalu singkat',
  IVA: 'Ada alternatif lebih efektif',
  IVB: 'Ada alternatif kurang toksik',
  IVC: 'Ada alternatif lebih murah',
  IVD: 'Ada alternatif spektrum lebih sempit',
  V: 'Tanpa indikasi',
  VI: 'Data tidak lengkap',
};

/**
 * Jalankan alur dengan jawaban berurutan. Mengembalikan kategori bila sudah ditentukan, atau indeks pertanyaan
 * berikutnya bila belum.
 */
export function gyssensResult(
  answers: readonly boolean[],
): { done: true; category: string } | { done: false; next: number } {
  for (let i = 0; i < GYSSENS_STEPS.length; i++) {
    const a = answers[i];
    if (a === undefined) return { done: false, next: i };
    const step = GYSSENS_STEPS[i];
    if (step && a === step.stopOn) return { done: true, category: step.category };
  }
  return { done: true, category: '0' };
}

/** Persentase kategori 0 (tepat) dari hasil audit. */
export function appropriateRate(categories: readonly string[]): number | null {
  if (categories.length === 0) return null;
  return Math.round((categories.filter((c) => c === '0').length / categories.length) * 100);
}
