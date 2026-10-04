'use server';

import { RAD_MODALITIES } from '@simrs/shared';
import { z } from 'zod';
import { RADIOLOG } from '@/lib/demo/fixtures/penunjang';
import {
  DENIED,
  invalid,
  type PenunjangActionResult,
  penunjangSession,
  simulated,
} from '@/lib/penunjang-aksi';
import { doseError, reportError, startError } from '@/lib/penunjang-radiologi';

/**
 * S03 · Server Action layar Radiologi (mode presentasi, ADR-0023). Tidak menyimpan apa pun; gerbang yang sama
 * dengan layar ditegakkan di sini: identitas/skrining kontras sebelum mulai, dosis CT wajib, ekspertise lengkap
 * sebelum TTE radiolog.
 */

const examId = z.string().regex(/^rad-[a-z]{2,20}$/);
const modality = z.enum(RAD_MODALITIES);

export async function startExamAction(input: {
  examId: string;
  contrast: boolean;
  identityChecked: boolean;
  contrastChecked: boolean;
}): Promise<PenunjangActionResult> {
  if (!(await penunjangSession('rad'))) return DENIED;
  const p = z
    .strictObject({
      examId,
      contrast: z.boolean(),
      identityChecked: z.boolean(),
      contrastChecked: z.boolean(),
    })
    .safeParse(input);
  if (!p.success) return invalid('Permintaan tidak dikenal.');
  const err = startError({ contrast: p.data.contrast }, p.data.identityChecked, p.data.contrastChecked);
  if (err) return invalid(err);
  return simulated('Pemeriksaan dimulai, identitas terverifikasi');
}

export async function finishExamAction(input: {
  examId: string;
  modality: string;
  ctdiVol: number | null;
  dlp: number | null;
}): Promise<PenunjangActionResult> {
  if (!(await penunjangSession('rad'))) return DENIED;
  const p = z
    .strictObject({
      examId,
      modality,
      ctdiVol: z.number().nullable(),
      dlp: z.number().nullable(),
    })
    .safeParse(input);
  if (!p.success) return invalid('Permintaan tidak dikenal.');
  const err = doseError(p.data.modality, p.data.ctdiVol, p.data.dlp);
  if (err) return invalid(err, 'dose');
  return simulated('Citra terkirim ke PACS, masuk antrean ekspertise');
}

export async function signReportAction(input: {
  examId: string;
  findings: string;
  impression: string;
}): Promise<PenunjangActionResult> {
  if (!(await penunjangSession('rad'))) return DENIED;
  const p = z
    .strictObject({ examId, findings: z.string().max(4000), impression: z.string().max(1000) })
    .safeParse(input);
  if (!p.success) return invalid('Ekspertise tidak dikenal.');
  const err = reportError(p.data.findings, p.data.impression);
  if (err) return invalid(err, 'report');
  return simulated(`Ekspertise ditandatangani (TTE ${RADIOLOG}), hasil terkirim ke DPJP dan SATUSEHAT`);
}
