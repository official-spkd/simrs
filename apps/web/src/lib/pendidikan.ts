/**
 * B10 · Pendidikan klinik (rencana fase 8 §8.5): peserta didik + supervisor + stase, tingkat supervisi yang
 * menentukan aturan co-sign (K07/K09), logbook kompetensi yang diverifikasi supervisor, dan kenaikan tingkat bila
 * syarat jumlah tindakan terverifikasi terpenuhi. Fungsi murni untuk layar mode presentasi (ADR-0023).
 */

export type SupervisionLevel = 1 | 2 | 3 | 4;

export const LEVEL_LABEL: Record<SupervisionLevel, string> = {
  1: 'Observasi',
  2: 'Dibimbing langsung',
  3: 'Dibimbing tidak langsung',
  4: 'Mandiri terbatas',
};

/** Aturan co-sign CPPT/order menurut tingkat supervisi. */
export function cosignRule(level: SupervisionLevel): string {
  if (level <= 2) return 'Co-sign supervisor sebelum order/CPPT berlaku';
  if (level === 3) return 'Co-sign retrospektif ≤ 24 jam';
  return 'Tanpa co-sign; dilaporkan ke supervisor harian';
}

/** Jumlah tindakan terverifikasi per kompetensi untuk naik satu tingkat. */
export const LEVEL_UP_THRESHOLD = 5;

export interface LogbookEntry {
  id: string;
  traineeId: string;
  competency: string;
  date: string;
  rm: string;
  role: 'observasi' | 'asistensi' | 'mandiri dibimbing';
  status: 'menunggu' | 'terverifikasi' | 'dikembalikan';
  feedback?: string;
}

export function verifiedCount(
  entries: readonly LogbookEntry[],
  traineeId: string,
  competency: string,
): number {
  return entries.filter(
    (e) =>
      e.traineeId === traineeId &&
      e.competency === competency &&
      e.status === 'terverifikasi' &&
      e.role !== 'observasi',
  ).length;
}

/** Alasan belum bisa naik tingkat, atau null. */
export function levelUpBlock(
  level: SupervisionLevel,
  verified: number,
  threshold = LEVEL_UP_THRESHOLD,
): string | null {
  if (level >= 4) return 'Sudah di tingkat tertinggi untuk peserta didik.';
  if (verified < threshold) return `Butuh ${threshold} tindakan terverifikasi (baru ${verified}).`;
  return null;
}

export function returnBlock(feedback: string): string | null {
  return feedback.trim().length < 10 ? 'Tulis umpan balik minimal 10 huruf.' : null;
}
