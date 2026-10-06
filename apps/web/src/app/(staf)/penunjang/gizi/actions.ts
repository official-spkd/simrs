'use server';
import { nutritionInput } from '@/lib/penunjang-event-schemas';
import { DENIED, invalid, penunjangSession, saveSupport } from '@/lib/penunjang-aksi';

export async function recordGiziAction(raw: unknown, rev: number) {
  const s = await penunjangSession('gizi');
  if (!s) return DENIED;
  const p = nutritionInput.safeParse(raw);
  if (!p.success) return invalid('Isian tindakan tidak sah.');
  return saveSupport(s, { type: 'gizi.aksi', input: p.data }, rev);
}
