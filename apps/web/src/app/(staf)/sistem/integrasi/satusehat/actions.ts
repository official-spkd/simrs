'use server';
import { satusehatInput } from '@/lib/integrasi-event-schemas';
import { saveIntegration } from '@/lib/integrasi-aksi';
import { assertDemo } from '@/lib/server/demo-guard';
export async function satusehatAction(raw: unknown, rev: number) {
  assertDemo();
  const p = satusehatInput.safeParse(raw);
  if (!p.success) return { ok: false, message: 'Isian tidak sah atau konfirmasi belum lengkap.' };
  return saveIntegration('satusehat', { type: 'satusehat.aksi', input: p.data }, rev);
}
