'use server';
import { supportEventSchema } from '@/lib/penunjang-demo';
import {
  DENIED,
  invalid,
  penunjangSession,
  saveSupport,
  type PenunjangActionResult,
} from '@/lib/penunjang-aksi';

export async function reviewRxAction(
  input: {
    rxId: string;
    decision: 'setujui' | 'tahan' | 'lepas' | 'sebagian';
  },
  rev: number,
): Promise<PenunjangActionResult> {
  const s = await penunjangSession('farmasi');
  if (!s) return DENIED;
  const p = supportEventSchema.safeParse({ type: 'rx.telaah', ...input });
  if (!p.success) return invalid('Isian tindakan tidak sah.');
  return saveSupport(s, p.data, rev);
}

export async function cdsFollowUpAction(
  input: {
    rxId: string;
    alertId: string;
    action: 'usul' | 'setuju' | 'konfirmasi' | 'override';
    reason?: string;
  },
  rev: number,
): Promise<PenunjangActionResult> {
  const s = await penunjangSession('farmasi');
  if (!s) return DENIED;
  const p = supportEventSchema.safeParse({ type: 'rx.cds', ...input });
  if (!p.success) return invalid('Isian tindakan tidak sah.');
  return saveSupport(s, p.data, rev);
}

export async function doubleCheckAction(
  input: {
    rxId: string;
    second: string;
  },
  rev: number,
): Promise<PenunjangActionResult> {
  const s = await penunjangSession('farmasi');
  if (!s) return DENIED;
  const { second: _ignored, ...data } = input as typeof input & { second?: string };
  const p = supportEventSchema.safeParse({ type: 'rx.cek-ganda', ...data });
  if (!p.success) return invalid('Isian tindakan tidak sah.');
  return saveSupport(s, p.data, rev);
}

export async function prepareRxAction(input: { rxId: string }, rev: number): Promise<PenunjangActionResult> {
  const s = await penunjangSession('farmasi');
  if (!s) return DENIED;
  const p = supportEventSchema.safeParse({ type: 'rx.siap', ...input });
  if (!p.success) return invalid('Isian tindakan tidak sah.');
  return saveSupport(s, p.data, rev);
}

export async function dispenseRxAction(
  input: {
    rxId: string;
    receiver: 'pasien' | 'keluarga' | 'perawat';
  },
  rev: number,
): Promise<PenunjangActionResult> {
  const s = await penunjangSession('farmasi');
  if (!s) return DENIED;
  const p = supportEventSchema.safeParse({ type: 'rx.serah', ...input });
  if (!p.success) return invalid('Isian tindakan tidak sah.');
  return saveSupport(s, p.data, rev);
}

export async function checkRxItemAction(
  input: { rxId: string; kind: 'prep' | 'handover'; index: number; checked: boolean },
  rev: number,
) {
  const s = await penunjangSession('farmasi');
  if (!s) return DENIED;
  const p = supportEventSchema.safeParse({ type: 'rx.centang', ...input });
  if (!p.success) return invalid('Butir checklist tidak sah.');
  return saveSupport(s, p.data, rev);
}
