/**
 * B13 · Pengalaman pasien (rencana fase 8 §8.7): pengaduan dengan grading merah/kuning/hijau → SLA tanggap
 * (INM-12), tindakan append-only sampai dijawab ke pelapor, dan survei kepuasan pasca-pulang (indeks 0–100 dari
 * skala 1–4, INM-13). Fungsi murni untuk layar mode presentasi (ADR-0023).
 */

export type Grade = 'merah' | 'kuning' | 'hijau';

export const SLA_HOURS: Record<Grade, number> = { merah: 24, kuning: 72, hijau: 168 };

export const GRADE_LABEL: Record<Grade, string> = {
  merah: 'Merah · risiko tinggi, tanggap ≤ 24 jam',
  kuning: 'Kuning · risiko sedang, tanggap ≤ 3 hari',
  hijau: 'Hijau · risiko rendah, tanggap ≤ 7 hari',
};

export const COMPLAINT_STAGES = [
  'Diterima',
  'Digrading',
  'Tindak lanjut unit',
  'Dijawab ke pelapor',
  'Selesai',
] as const;

const HOUR = 3_600_000;

export function complaintDeadline(receivedAt: string, grade: Grade): string {
  return new Date(Date.parse(receivedAt) + SLA_HOURS[grade] * HOUR).toISOString();
}

/** Status SLA: dijawab (`answeredAt`) dibandingkan tenggat; belum dijawab dibandingkan `now`. */
export function slaState(
  receivedAt: string,
  grade: Grade,
  now: string,
  answeredAt: string | null,
): { state: 'dalam' | 'mendekati' | 'lewat'; hoursLeft: number } {
  const deadline = Date.parse(complaintDeadline(receivedAt, grade));
  const ref = Date.parse(answeredAt ?? now);
  const hoursLeft = Math.floor((deadline - ref) / HOUR);
  if (ref > deadline) return { state: 'lewat', hoursLeft };
  if (!answeredAt && hoursLeft <= Math.max(4, SLA_HOURS[grade] / 4)) return { state: 'mendekati', hoursLeft };
  return { state: 'dalam', hoursLeft };
}

/** INM-12: pengaduan yang dijawab dalam SLA ÷ semua pengaduan yang sudah jatuh tempo atau dijawab. */
export function responseRate(
  list: ReadonlyArray<{ receivedAt: string; grade: Grade; answeredAt: string | null }>,
  now: string,
): { within: number; total: number; pct: number | null } {
  const counted = list.filter(
    (c) => c.answeredAt || slaState(c.receivedAt, c.grade, now, null).state === 'lewat',
  );
  const within = counted.filter(
    (c) => slaState(c.receivedAt, c.grade, now, c.answeredAt).state !== 'lewat',
  ).length;
  return {
    within,
    total: counted.length,
    pct: counted.length ? Math.round((within / counted.length) * 100) : null,
  };
}

export function answerBlock(text: string): string | null {
  return text.trim().length < 20 ? 'Tulis jawaban ke pelapor minimal 20 huruf.' : null;
}

// ---------------------------------------------------------------------------------------------------------------
// Survei

export const SURVEY_ASPECTS = [
  'Kemudahan pendaftaran',
  'Waktu tunggu',
  'Keramahan petugas',
  'Penjelasan dokter',
  'Kebersihan ruangan',
] as const;

export interface SurveyResponse {
  id: string;
  unit: string;
  /** Skor 1–4 per aspek (urutan `SURVEY_ASPECTS`). */
  scores: readonly number[];
  comment: string | null;
  submittedAt: string;
}

/** Indeks kepuasan 0–100 = rata-rata skor 1–4 × 25, dibulatkan. */
export function satisfactionIndex(responses: readonly Pick<SurveyResponse, 'scores'>[]): number | null {
  const all = responses.flatMap((r) => r.scores);
  if (all.length === 0) return null;
  return Math.round((all.reduce((n, s) => n + s, 0) / all.length) * 25);
}

/** Respons dengan skor ≤ 2 pada aspek mana pun → perlu ditindaklanjuti. */
export function needsFollowUp(r: Pick<SurveyResponse, 'scores'>): boolean {
  return r.scores.some((s) => s <= 2);
}

export function indexByUnit(
  responses: readonly SurveyResponse[],
): Array<{ unit: string; n: number; index: number }> {
  const units = [...new Set(responses.map((r) => r.unit))];
  return units.map((unit) => {
    const list = responses.filter((r) => r.unit === unit);
    return { unit, n: list.length, index: satisfactionIndex(list) ?? 0 };
  });
}
