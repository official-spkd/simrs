import { applyFollowUp, type CareTeamMember, type ConsultRequest } from './rme-konsul';
import type { RmeExtraState } from './rme-toko-bagan';

/**
 * K10 · Konsul dari toko demo `rekam-medis` (ADR-0085): konsul rekam awal + konsul terkirim, jawaban tersimpan atas
 * nama dokter sesi, dan tim perawatan yang diturunkan dari tindak lanjut jawaban (rawat bersama/alih rawat) secara
 * berurutan. Logika murni.
 */

/** Semua konsul (kotak masuk lintas pasien): rekam awal dengan jawaban tersimpan + konsul baru. */
export function consultsOf(base: readonly ConsultRequest[], s: RmeExtraState): ConsultRequest[] {
  return [
    ...base.map((c) => (c.answer || !s.answers[c.id] ? c : { ...c, answer: s.answers[c.id] ?? null })),
    ...s.consults,
  ];
}

/** Tim perawatan kunjungan: tim awal + tindak lanjut setiap konsul yang dijawab, urut jam jawaban. */
export function teamOf(
  baseTeam: readonly CareTeamMember[],
  consults: readonly ConsultRequest[],
  encounterId: string,
): CareTeamMember[] {
  return consults
    .filter((c) => c.encounterId === encounterId && c.answer)
    .sort((a, b) => (a.answer?.at ?? '').localeCompare(b.answer?.at ?? ''))
    .reduce<CareTeamMember[]>(
      (team, c) => (c.answer ? applyFollowUp(team, c, c.answer, `${encounterId}-tim-${c.id}`) : team),
      [...baseTeam],
    );
}

/** Konsul dijawab per id (untuk Worklist). */
export function consultAnswered(
  consults: readonly ConsultRequest[],
): Record<string, { by: string; at: string }> {
  return Object.fromEntries(
    consults.flatMap((c) => (c.answer ? [[c.id, { by: c.answer.by, at: c.answer.at }]] : [])),
  );
}
