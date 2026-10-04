'use server';

import { z } from 'zod';
import { RADIOLOG } from '@/lib/demo/fixtures/penunjang';
import {
  DENIED,
  invalid,
  type PenunjangActionResult,
  penunjangSession,
  simulated,
} from '@/lib/penunjang-aksi';
import { radFinishGate, radSignGate, radStartGate } from '@/lib/penunjang-radiologi';
import { findRadiologyExam } from '@/lib/server/data/penunjang';

/**
 * S03 · Server Action layar Radiologi (mode presentasi, ADR-0023). Tidak menyimpan apa pun; gerbang yang sama
 * dengan layar ditegakkan di sini atas pemeriksaan yang dicari server di worklist sesi (klien hanya mengirim id):
 * identitas/skrining kontras sebelum mulai, dosis CT wajib, ekspertise lengkap sebelum TTE radiolog. Kebutuhan
 * kontras dan modalitas dibaca dari order di server, bukan dari klien.
 */

const examId = z.string().regex(/^rad-[a-z]{2,20}$/);

export async function startExamAction(input: {
  examId: string;
  identityChecked: boolean;
  contrastChecked: boolean;
}): Promise<PenunjangActionResult> {
  const s = await penunjangSession('rad');
  if (!s) return DENIED;
  const p = z
    .strictObject({ examId, identityChecked: z.boolean(), contrastChecked: z.boolean() })
    .safeParse(input);
  if (!p.success) return invalid('Permintaan tidak dikenal.');
  const exam = await findRadiologyExam(s, p.data.examId);
  const gate = radStartGate(exam, p.data.identityChecked, p.data.contrastChecked);
  if (gate) return invalid(gate.message, gate.field);
  return simulated('Pemeriksaan dimulai, identitas terverifikasi');
}

export async function finishExamAction(input: {
  examId: string;
  ctdiVol: number | null;
  dlp: number | null;
}): Promise<PenunjangActionResult> {
  const s = await penunjangSession('rad');
  if (!s) return DENIED;
  const p = z
    .strictObject({ examId, ctdiVol: z.number().nullable(), dlp: z.number().nullable() })
    .safeParse(input);
  if (!p.success) return invalid('Permintaan tidak dikenal.');
  const exam = await findRadiologyExam(s, p.data.examId);
  const gate = radFinishGate(exam, p.data.ctdiVol, p.data.dlp);
  if (gate) return invalid(gate.message, gate.field);
  return simulated('Citra terkirim ke PACS, masuk antrean ekspertise');
}

export async function signReportAction(input: {
  examId: string;
  findings: string;
  impression: string;
}): Promise<PenunjangActionResult> {
  const s = await penunjangSession('rad');
  if (!s) return DENIED;
  const p = z
    .strictObject({ examId, findings: z.string().max(4000), impression: z.string().max(1000) })
    .safeParse(input);
  if (!p.success) return invalid('Ekspertise tidak dikenal.');
  const exam = await findRadiologyExam(s, p.data.examId);
  const gate = radSignGate(exam, p.data.findings, p.data.impression);
  if (gate) return invalid(gate.message, gate.field);
  return simulated(`Ekspertise ditandatangani (TTE ${RADIOLOG}), hasil terkirim ke DPJP dan SATUSEHAT`);
}
