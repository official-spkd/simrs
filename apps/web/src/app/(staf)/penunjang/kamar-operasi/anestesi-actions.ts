'use server';
import { anesthesiaInput } from '@/lib/penunjang-event-schemas';
import { DENIED, invalid, penunjangSession, saveSupport } from '@/lib/penunjang-aksi';
export async function recordAnesthesiaAction(raw: unknown, rev: number) {
  const s = await penunjangSession('ok');
  if (!s) return DENIED;
  const p = anesthesiaInput.safeParse(raw);
  if (!p.success) return invalid('Catatan anestesi tidak sah.');
  return saveSupport(s, { type: 'anestesi.aksi', input: p.data }, rev);
}
