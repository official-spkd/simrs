'use server';
import { bloodInput } from '@/lib/penunjang-event-schemas';
import { DENIED, invalid, penunjangSession, saveSupport } from '@/lib/penunjang-aksi';

export async function recordBloodAction(raw: unknown, rev: number) {
  const s = await penunjangSession('bank-darah');
  if (!s) return DENIED;
  const p = bloodInput.safeParse(raw);
  if (!p.success) return invalid('Isian tindakan tidak sah.');
  return saveSupport(s, { type: 'darah.aksi', input: p.data }, rev);
}

export async function checkBloodAction(
  input: {
    requestId: string;
    unitId: string;
    stage: 'issue' | 'bedside';
    items: Record<string, boolean>;
    reason?: string;
  },
  rev: number,
) {
  const s = await penunjangSession('bank-darah');
  if (!s) return DENIED;
  return saveSupport(s, { type: 'darah.periksa', ...input }, rev);
}
