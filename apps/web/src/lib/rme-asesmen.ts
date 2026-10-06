import {
  type FormAnswers,
  type FormSchema,
  formatJam,
  formatTanggal,
  type FormScore,
  scoreForm,
  SYSTEM_ROLES,
  type SystemRoleCode,
} from '@simrs/shared';
import { hasReason, shortWhen } from './rme';

/**
 * K06 · Asesmen dan skrining per kunjungan: paket formulir per setting (asesmen awal medis/keperawatan ≤ 24 jam,
 * risiko jatuh Morse, nyeri NRS, skrining gizi MST), hak tulis per profesi (ADR-0019), skor otomatis + tindak lanjut,
 * isian final immutable (koreksi = versi baru beralasan; reasesmen = isian baru).
 */

export type AssessmentSetting = 'rawat-inap' | 'rawat-jalan' | 'kamar-bersalin';

export interface AssessmentForm {
  code: string;
  title: string;
  category: 'medis' | 'keperawatan' | 'kebidanan';
  /** Profesi yang boleh mengisi (kode peran). */
  writeRoles: readonly SystemRoleCode[];
  /** Asesmen awal (sekali per kunjungan, ≤ 24 jam) atau skrining berulang. */
  kind: 'awal' | 'skrining';
  /** Interval reasesmen (jam) untuk skrining berulang. */
  reassessHours: number | null;
  schema: FormSchema;
}

export interface AssessmentResponse {
  id: string;
  formCode: string;
  encounterId: string;
  version: number;
  answers: FormAnswers;
  by: string;
  at: string;
  /** Koreksi: versi yang digantikan + alasan. */
  supersedesId: string | null;
  reason: string | null;
}

/** Batas asesmen awal sejak kunjungan dimulai (EP rekam medis: asesmen awal rawat inap ≤ 24 jam). */
export const INITIAL_WITHIN_HOURS = 24;

export type AssessmentStatus =
  | { kind: 'belum'; dueAt: string; overdue: boolean }
  | { kind: 'final'; last: AssessmentResponse; nextDueAt: string | null }
  | { kind: 'reasesmen'; last: AssessmentResponse; dueAt: string };

const addHours = (iso: string, h: number) => new Date(Date.parse(iso) + h * 3_600_000).toISOString();

/** Isian berlaku per formulir: versi terbaru yang tidak digantikan, paling akhir diisi. */
export function currentResponses(
  responses: readonly AssessmentResponse[],
  formCode: string,
): AssessmentResponse[] {
  const superseded = new Set(responses.map((r) => r.supersedesId).filter((x): x is string => !!x));
  return responses
    .filter((r) => r.formCode === formCode && !superseded.has(r.id))
    .sort((a, b) => a.at.localeCompare(b.at));
}

export function latestResponse(
  responses: readonly AssessmentResponse[],
  formCode: string,
): AssessmentResponse | null {
  return currentResponses(responses, formCode).at(-1) ?? null;
}

/** Rantai versi satu isian (versi 1 → terbaru). */
export function responseVersions(responses: readonly AssessmentResponse[], id: string): AssessmentResponse[] {
  const byId = new Map(responses.map((r) => [r.id, r]));
  let root = byId.get(id);
  while (root?.supersedesId && byId.has(root.supersedesId)) root = byId.get(root.supersedesId);
  const chain: AssessmentResponse[] = [];
  for (let cur = root; cur; cur = responses.find((r) => r.supersedesId === cur?.id)) chain.push(cur);
  return chain;
}

export function assessmentStatus(
  form: AssessmentForm,
  responses: readonly AssessmentResponse[],
  startedAt: string,
  nowIso: string,
): AssessmentStatus {
  const last = latestResponse(responses, form.code);
  if (!last) {
    const dueAt = addHours(startedAt, INITIAL_WITHIN_HOURS);
    return { kind: 'belum', dueAt, overdue: Date.parse(dueAt) < Date.parse(nowIso) };
  }
  if (form.reassessHours === null) return { kind: 'final', last, nextDueAt: null };
  const due = addHours(last.at, form.reassessHours);
  return Date.parse(due) < Date.parse(nowIso)
    ? { kind: 'reasesmen', last, dueAt: due }
    : { kind: 'final', last, nextDueAt: due };
}

/** Label status bertulisan untuk daftar paket. */
export function statusLabel(
  s: AssessmentStatus,
  nowIso: string,
): { text: string; tone: 'success' | 'warning' | 'danger' } {
  switch (s.kind) {
    case 'belum':
      return s.overdue
        ? {
            text: `Belum diisi · lewat batas ${formatTanggal(s.dueAt)} · ${formatJam(s.dueAt)}`,
            tone: 'danger',
          }
        : { text: `Belum diisi · batas ${shortWhen(s.dueAt, nowIso)}`, tone: 'warning' };
    case 'reasesmen':
      return {
        text: `Reasesmen jatuh tempo sejak ${formatTanggal(s.dueAt)} · ${formatJam(s.dueAt)}`,
        tone: 'danger',
      };
    case 'final':
      return {
        text: `Final · ${formatTanggal(s.last.at)} · ${formatJam(s.last.at)}${s.nextDueAt ? ` · reasesmen ${shortWhen(s.nextDueAt, nowIso)}` : ''}`,
        tone: 'success',
      };
  }
}

export function canWriteForm(form: Pick<AssessmentForm, 'writeRoles'>, role: string | null): boolean {
  return !!role && form.writeRoles.some((r) => r === role);
}

export function writeRoleLabel(form: Pick<AssessmentForm, 'writeRoles'>): string {
  return form.writeRoles.map((r) => SYSTEM_ROLES[r]).join(', ');
}

export interface FollowUp {
  tone: 'success' | 'warning' | 'danger';
  text: string;
}

/** Tindak lanjut dari skor (aturan contoh komite; tampil sebagai saran, bukan keputusan otomatis). */
export function scoreFollowUp(formCode: string, score: FormScore): FollowUp | null {
  if (score.answered === 0) return null;
  const t = score.total;
  switch (formCode) {
    case 'morse_dewasa':
      return t >= 45
        ? {
            tone: 'danger',
            text: 'Risiko jatuh tinggi: gelang kuning, bundle pencegahan jatuh, reasesmen setiap shift, masukkan ke asuhan keperawatan.',
          }
        : t >= 25
          ? {
              tone: 'warning',
              text: 'Risiko jatuh sedang: intervensi pencegahan standar dan edukasi pasien/keluarga.',
            }
          : { tone: 'success', text: 'Risiko jatuh rendah: perawatan standar.' };
    case 'nyeri_nrs':
      return t >= 7
        ? {
            tone: 'danger',
            text: 'Nyeri berat: lapor DPJP, intervensi segera, reasesmen 30 menit setelah intervensi.',
          }
        : t >= 4
          ? {
              tone: 'warning',
              text: 'Nyeri sedang: intervensi sesuai rencana, reasesmen 1 jam setelah intervensi.',
            }
          : { tone: 'success', text: 'Nyeri ringan/tidak nyeri: reasesmen sesuai jadwal shift.' };
    case 'skrining_gizi_mst':
      return t >= 2
        ? { tone: 'warning', text: 'Berisiko malnutrisi: rujuk dietisien untuk asesmen gizi lanjut.' }
        : { tone: 'success', text: 'Tidak berisiko malnutrisi: skrining ulang 7 hari.' };
    default:
      return null;
  }
}

export function formScore(form: AssessmentForm, answers: FormAnswers): FormScore | null {
  const s = scoreForm(form.schema, answers);
  return s.scored > 0 ? s : null;
}

/** Isian baru (versi 1) atau koreksi (versi + 1, alasan wajib ≥ 10). Isian lama tidak diubah. */
export function newResponse(a: {
  id: string;
  form: AssessmentForm;
  encounterId: string;
  answers: FormAnswers;
  by: string;
  at: string;
  correct?: { prev: AssessmentResponse; reason: string };
}): AssessmentResponse {
  if (a.correct && !hasReason(a.correct.reason)) throw new Error('Alasan koreksi minimal 10 karakter.');
  return {
    id: a.id,
    formCode: a.form.code,
    encounterId: a.encounterId,
    version: a.correct ? a.correct.prev.version + 1 : 1,
    answers: a.answers,
    by: a.by,
    at: a.at,
    supersedesId: a.correct?.prev.id ?? null,
    reason: a.correct?.reason.trim() ?? null,
  };
}

/** Kelengkapan paket (asesmen yang final, termasuk yang sudah direasesmen tepat waktu). */
export function packageProgress(statuses: readonly AssessmentStatus[]): { done: number; total: number } {
  return { done: statuses.filter((s) => s.kind === 'final').length, total: statuses.length };
}
