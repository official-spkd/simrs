'use server';
import { kemenkesInput } from '@/lib/integrasi-event-schemas';
import { saveIntegration } from '@/lib/integrasi-aksi';
import { assertDemo } from '@/lib/server/demo-guard';
export async function kemenkesAction(raw: unknown, rev: number) {
  assertDemo();
  const p = kemenkesInput.safeParse(raw);
  if (!p.success) return { ok: false, message: 'Isian tidak sah atau konfirmasi belum lengkap.' };
  return saveIntegration('kemenkes', { type: 'kemenkes.aksi', input: p.data }, rev);
}
