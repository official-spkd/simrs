'use server';
import { supportEventSchema } from '@/lib/penunjang-demo';
import {
  DENIED,
  invalid,
  penunjangSession,
  saveSupport,
  type PenunjangActionResult,
} from '@/lib/penunjang-aksi';

export async function startExamAction(
  input: {
    examId: string;
    identityChecked: boolean;
    contrastChecked: boolean;
  },
  rev: number,
): Promise<PenunjangActionResult> {
  const s = await penunjangSession('rad');
  if (!s) return DENIED;
  const p = supportEventSchema.safeParse({ type: 'rad.mulai', ...input });
  if (!p.success) return invalid('Isian tindakan tidak sah.');
  return saveSupport(s, p.data, rev);
}

export async function finishExamAction(
  input: {
    examId: string;
    ctdiVol: number | null;
    dlp: number | null;
  },
  rev: number,
): Promise<PenunjangActionResult> {
  const s = await penunjangSession('rad');
  if (!s) return DENIED;
  const p = supportEventSchema.safeParse({ type: 'rad.akuisisi', ...input });
  if (!p.success) return invalid('Isian tindakan tidak sah.');
  return saveSupport(s, p.data, rev);
}

export async function signReportAction(
  input: {
    examId: string;
    findings: string;
    impression: string;
  },
  rev: number,
): Promise<PenunjangActionResult> {
  const s = await penunjangSession('rad');
  if (!s) return DENIED;
  const p = supportEventSchema.safeParse({ type: 'rad.tte', ...input });
  if (!p.success) return invalid('Isian tindakan tidak sah.');
  return saveSupport(s, p.data, rev);
}
