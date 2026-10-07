'use server';
import { supportEventSchema, type SupportEvent } from '@/lib/penunjang-demo';
import { operatingInput } from '@/lib/penunjang-event-schemas';
import { DENIED, invalid, penunjangSession, saveSupport } from '@/lib/penunjang-aksi';
import type { z } from 'zod';
export type OkEventInput = z.infer<typeof operatingInput>;
export async function recordOkEventAction(input: OkEventInput, rev: number) {
  const s = await penunjangSession('ok');
  if (!s) return DENIED;
  const p = operatingInput.safeParse(input);
  if (!p.success) return invalid(p.error.issues[0]?.message ?? 'Isian tidak sah.');
  return saveSupport(s, { type: 'ok.aksi', input: p.data }, rev);
}
export async function recordOkChecklistAction(
  input: Extract<SupportEvent, { type: 'ok.centang' | 'ok.hitung' }>,
  rev: number,
) {
  const s = await penunjangSession('ok');
  if (!s) return DENIED;
  const p = supportEventSchema.safeParse(input);
  if (!p.success || !['ok.centang', 'ok.hitung'].includes(p.data.type)) return invalid('Butir tidak sah.');
  return saveSupport(s, p.data, rev);
}
