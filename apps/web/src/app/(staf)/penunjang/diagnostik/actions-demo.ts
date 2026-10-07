'use server';
import { diagnosticInput } from '@/lib/penunjang-event-schemas';
import { DENIED, invalid, penunjangSession, saveSupport } from '@/lib/penunjang-aksi';

export async function recordDiagAction(raw: unknown, rev: number) {
  const s = await penunjangSession('diagnostik');
  if (!s) return DENIED;
  const p = diagnosticInput.safeParse(raw);
  if (!p.success) return invalid('Isian tindakan tidak sah.');
  return saveSupport(s, { type: 'diagnostik.aksi', input: p.data }, rev);
}
