'use server';
import { dlqResendInputSchema } from '@simrs/shared';
import { saveIntegration } from '@/lib/integrasi-aksi';
import { assertDemo } from '@/lib/server/demo-guard';
export async function resendDeadLettersAction(input: unknown, rev: number) {
  assertDemo();
  const p = dlqResendInputSchema.safeParse(input);
  if (!p.success) return { ok: false, message: 'Pilihan pesan tidak sah.', ids: [] };
  const r = await saveIntegration('integrasi', { type: 'hub.kirim-ulang', input: p.data }, rev);
  return { ...r, ids: r.ok ? p.data.ids : [] };
}
export async function hubStateAction(type: 'hub.mulai' | 'hub.detak' | 'hub.pulih', rev: number) {
  assertDemo();
  return saveIntegration('integrasi', { type }, rev);
}
