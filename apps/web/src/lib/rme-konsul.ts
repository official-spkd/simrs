import { formatJam } from '@simrs/shared';
import { hasReason, shortWhen } from './rme';

/**
 * K10 · Konsultasi antar-DPJP dan rawat bersama: permintaan konsul (urgensi cito ≤ 1 jam, biasa ≤ 24 jam) dengan
 * jawaban terstruktur (temuan, kesimpulan, rekomendasi, tindak lanjut), penetapan rawat bersama, dan alih rawat
 * (DPJP utama berganti = versi baru tim perawatan). Konsultan mendapat akses rekam berbatas waktu.
 */

export type ConsultKind = 'sekali' | 'rawat-bersama' | 'alih-rawat';
export type ConsultUrgency = 'cito' | 'biasa';

export const CONSULT_KIND_LABEL: Record<ConsultKind, string> = {
  sekali: 'Konsul sekali',
  'rawat-bersama': 'Rawat bersama',
  'alih-rawat': 'Alih rawat',
};

export const URGENCY_HOURS: Record<ConsultUrgency, number> = { cito: 1, biasa: 24 };
export const URGENCY_LABEL: Record<ConsultUrgency, string> = {
  cito: 'Cito (≤ 1 jam)',
  biasa: 'Biasa (≤ 24 jam)',
};

export type FollowUp = 'selesai' | 'rawat-bersama' | 'alih-rawat';

export const FOLLOW_UP_LABEL: Record<FollowUp, string> = {
  selesai: 'Konsul selesai, kembali ke DPJP',
  'rawat-bersama': 'Rawat bersama (konsultan ikut merawat)',
  'alih-rawat': 'Alih rawat (konsultan menjadi DPJP utama)',
};

export interface ConsultAnswer {
  findings: string;
  conclusion: string;
  recommendation: string;
  followUp: FollowUp;
  by: string;
  at: string;
}

export interface ConsultRequest {
  id: string;
  encounterId: string;
  patientId: string;
  from: string;
  /** SMF tujuan, mis. "Penyakit Dalam". */
  toSpecialty: string;
  /** Dokter konsultan yang dituju. */
  to: string;
  kind: ConsultKind;
  urgency: ConsultUrgency;
  question: string;
  sentAt: string;
  answer: ConsultAnswer | null;
}

export type CareRole = 'dpjp-utama' | 'rawat-bersama' | 'konsultan';

export const CARE_ROLE_LABEL: Record<CareRole, string> = {
  'dpjp-utama': 'DPJP utama',
  'rawat-bersama': 'DPJP rawat bersama',
  konsultan: 'Konsultan (akses berbatas waktu)',
};

export interface CareTeamMember {
  id: string;
  name: string;
  role: CareRole;
  since: string;
  /** Null = masih aktif. Akses konsultan berakhir otomatis. */
  until: string | null;
  /** Alasan perubahan (alih rawat). */
  note: string | null;
}

export function answerDueAt(c: Pick<ConsultRequest, 'sentAt' | 'urgency'>): string {
  return new Date(Date.parse(c.sentAt) + URGENCY_HOURS[c.urgency] * 3_600_000).toISOString();
}

export function consultStatus(
  c: ConsultRequest,
  nowIso: string,
): { text: string; tone: 'success' | 'warning' | 'danger' } {
  if (c.answer)
    return { text: `Dijawab ${c.answer.by} · ${shortWhen(c.answer.at, nowIso)}`, tone: 'success' };
  const due = answerDueAt(c);
  return Date.parse(due) < Date.parse(nowIso)
    ? { text: `Belum dijawab · lewat batas ${shortWhen(due, nowIso)}`, tone: 'danger' }
    : { text: `Menunggu jawaban · batas ${shortWhen(due, nowIso)}`, tone: 'warning' };
}

export interface ConsultDraft {
  to: string;
  kind: ConsultKind;
  urgency: ConsultUrgency;
  question: string;
}

/** Gerbang kirim konsul: konsultan dipilih (bukan diri sendiri), pertanyaan klinis jelas (≥ 20 karakter). */
export function sendBlocker(d: ConsultDraft, role: string | null, user: string): string | null {
  if (role !== 'dokter' && role !== 'dokter_residen') return 'Konsul dikirim oleh dokter (DPJP/residen).';
  if (!d.to) return 'Pilih dokter konsultan.';
  if (d.to === user) return 'Tidak bisa mengirim konsul ke diri sendiri.';
  if (!hasReason(d.question, 20)) return 'Tulis pertanyaan klinis yang jelas (minimal 20 karakter).';
  return null;
}

/**
 * Gerbang jawab konsul: hanya dokter konsultan yang DITUJU (`actor` = dokter posisi aktif), bukan pengirim konsul,
 * konsul belum dijawab, isian terstruktur lengkap.
 */
export function answerBlocker(
  c: ConsultRequest,
  a: Pick<ConsultAnswer, 'conclusion' | 'recommendation'>,
  role: string | null,
  actor: string,
): string | null {
  if (c.answer) return 'Konsul sudah dijawab.';
  if (role !== 'dokter')
    return 'Jawaban konsul ditandatangani dokter konsultan (posisi dokter); residen menyiapkan draf.';
  if (c.from === actor) return 'Pengirim konsul tidak menjawab konsulnya sendiri.';
  if (c.to !== actor) return `Konsul ini dijawab dokter yang dituju (${c.to}).`;
  if (!a.conclusion.trim()) return 'Isi kesimpulan/diagnosis konsultan.';
  if (!a.recommendation.trim()) return 'Isi rekomendasi tata laksana.';
  return null;
}

/** Akses konsultan ke rekam pasien: konsul sekali 24 jam sejak dijawab; rawat bersama/alih rawat selama dirawat. */
export function consultantAccessUntil(c: ConsultRequest): string | null {
  if (!c.answer) return new Date(Date.parse(c.sentAt) + 24 * 3_600_000).toISOString();
  return c.answer.followUp === 'selesai'
    ? new Date(Date.parse(c.answer.at) + 24 * 3_600_000).toISOString()
    : null;
}

export function activeTeam(team: readonly CareTeamMember[]): CareTeamMember[] {
  return team.filter((m) => m.until === null);
}

/**
 * Terapkan tindak lanjut jawaban ke tim perawatan (versi baru, anggota lama ditutup bukan dihapus):
 * rawat bersama menambah DPJP rawat bersama; alih rawat menutup DPJP utama lama dan menetapkan konsultan.
 */
export function applyFollowUp(
  team: readonly CareTeamMember[],
  c: ConsultRequest,
  a: ConsultAnswer,
  newId: string,
): CareTeamMember[] {
  if (a.followUp === 'selesai') return [...team];
  if (a.followUp === 'rawat-bersama') {
    if (activeTeam(team).some((m) => m.name === a.by)) return [...team];
    return [...team, { id: newId, name: a.by, role: 'rawat-bersama', since: a.at, until: null, note: null }];
  }
  const closed = team.map((m) =>
    m.until === null && m.role === 'dpjp-utama'
      ? { ...m, until: a.at, note: `Alih rawat ke ${a.by} (konsul ${formatJam(c.sentAt)})` }
      : m,
  );
  return [
    ...closed,
    { id: newId, name: a.by, role: 'dpjp-utama', since: a.at, until: null, note: 'Alih rawat' },
  ];
}

export function primaryDoctor(team: readonly CareTeamMember[]): string | null {
  return activeTeam(team).find((m) => m.role === 'dpjp-utama')?.name ?? null;
}
