import {
  type CareTeamMember,
  CONSULT_QUESTION_MIN,
  type ConsultKind,
  type ConsultRequestRecord,
  type ConsultUrgency,
  SAFETY_REASON_MIN,
} from '@simrs/shared';

/**
 * K10 · Aturan tampilan layar konsultasi mode api (fase 3 · 3.8, ADR-0059): label, gerbang tombol, dan status batas
 * jawab. Murni (komponen klien, Server Action, tes). API tetap penegak akhir: hanya konsultan tujuan yang menjawab
 * (`CONSULT_NOT_RECIPIENT`), pengirim dokter/residen, DPJP utama diserahkan oleh DPJP utama aktif.
 */

export const API_CONSULT_KIND_LABEL: Record<ConsultKind, string> = {
  konsultasi: 'Konsul sekali',
  rawat_bersama: 'Rawat bersama',
  alih_rawat: 'Alih rawat',
};

export const API_URGENCY_LABEL: Record<ConsultUrgency, string> = {
  segera: 'Cito (≤ 1 jam)',
  biasa: 'Biasa (≤ 24 jam)',
};

export const API_FOLLOW_UP_LABEL = {
  selesai: 'Konsul selesai, kembali ke DPJP',
  rawat_bersama: 'Rawat bersama (konsultan ikut merawat)',
  alih_rawat: 'Alih rawat (konsultan menjadi DPJP utama)',
} as const;

export const API_CARE_ROLE_LABEL: Record<CareTeamMember['role'], string> = {
  dpjp_utama: 'DPJP utama',
  rawat_bersama: 'DPJP rawat bersama',
  konsultan: 'Konsultan',
  perawat_pj: 'Perawat penanggung jawab',
};

export interface ApiConsultDraft {
  toUserId: string;
  kind: ConsultKind;
  urgency: ConsultUrgency;
  question: string;
}

/** Gerbang kirim konsul; null = boleh. */
export function apiSendBlocker(d: ApiConsultDraft, role: string | null, me: string): string | null {
  if (role !== 'dokter' && role !== 'dokter_residen') return 'Konsul dikirim oleh dokter (DPJP/residen).';
  if (!d.toUserId) return 'Pilih dokter konsultan.';
  if (d.toUserId === me) return 'Tidak bisa mengirim konsul ke diri sendiri.';
  if (d.question.trim().length < CONSULT_QUESTION_MIN) {
    return `Tulis pertanyaan klinis yang jelas (minimal ${CONSULT_QUESTION_MIN} karakter).`;
  }
  return null;
}

/**
 * Siapa yang boleh menjawab (sama dengan API): dokter tujuan, atau bila tujuan hanya unit, dokter yang bertugas di unit
 * itu; bukan pengirim; posisi `dokter` (residen tidak). Null = boleh; teks = alasan tombol nonaktif.
 */
export function apiAnswerBlocker(
  c: Pick<ConsultRequestRecord, 'state' | 'toUser' | 'toUnit' | 'author'>,
  me: { id: string; role: string | null; unitId: string | null },
): string | null {
  if (c.state === 'dijawab') return 'Konsul sudah dijawab.';
  if (me.role !== 'dokter') return 'Jawaban konsul ditandatangani dokter konsultan (posisi dokter).';
  if (c.author.userId === me.id) return 'Pengirim konsul tidak menjawab konsulnya sendiri.';
  if (c.toUser) {
    return c.toUser.userId === me.id ? null : `Konsul ini dijawab dokter yang dituju (${c.toUser.nama}).`;
  }
  return c.toUnit && c.toUnit.id === me.unitId
    ? null
    : `Konsul ini dijawab dokter unit ${c.toUnit?.name ?? 'tujuan'}.`;
}

/** Status jawaban + batas waktu (`now` ISO). */
export function apiConsultStatus(
  c: Pick<ConsultRequestRecord, 'state' | 'dueAt' | 'responses'>,
  now: string,
): { text: string; tone: 'success' | 'warning' | 'danger' } {
  const last = c.responses.at(-1);
  if (c.state === 'dijawab' && last) return { text: `Dijawab ${last.author.nama}`, tone: 'success' };
  return Date.parse(c.dueAt) < Date.parse(now)
    ? { text: 'Belum dijawab · lewat batas jawab', tone: 'danger' }
    : { text: 'Menunggu jawaban konsultan', tone: 'warning' };
}

/** DPJP utama aktif tim (null bila belum ada). */
export function activePrimary(team: readonly CareTeamMember[]): CareTeamMember | null {
  return team.find((m) => m.role === 'dpjp_utama' && !m.endedAt) ?? null;
}

/** Gerbang serah DPJP utama (sama dengan API): hanya DPJP utama aktif berposisi dokter. */
export function handoverBlocker(
  team: readonly CareTeamMember[],
  me: { id: string; role: string | null },
  target: string,
  reason: string,
): string | null {
  if (me.role !== 'dokter') return 'DPJP utama hanya diserahkan oleh dokter.';
  const primary = activePrimary(team);
  if (primary && primary.user.userId !== me.id)
    return 'Hanya DPJP utama aktif yang bisa menyerahkan DPJP utama.';
  if (!target) return 'Pilih dokter penerima.';
  if (primary?.user.userId === target) return 'Dokter ini sudah DPJP utama.';
  if (reason.trim().length < SAFETY_REASON_MIN)
    return `Alasan wajib (minimal ${SAFETY_REASON_MIN} karakter).`;
  return null;
}
