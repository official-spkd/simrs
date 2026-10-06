'use server';
import { microInput } from '@/lib/penunjang-event-schemas';
import { DENIED, invalid, penunjangSession, saveSupport } from '@/lib/penunjang-aksi';

export async function recordMicroAction(raw: unknown, rev: number) {
  const s = await penunjangSession('mikro');
  if (!s) return DENIED;
  const p = microInput.safeParse(raw);
  if (!p.success) return invalid('Isian tindakan tidak sah.');
  return saveSupport(s, { type: 'mikro.aksi', input: p.data }, rev);
}
