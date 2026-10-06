'use server';
import { apiInput } from '@/lib/integrasi-event-schemas';
import { saveIntegration } from '@/lib/integrasi-aksi';
import { assertDemo } from '@/lib/server/demo-guard';
export async function apiClientAction(raw: unknown, rev: number) {
  assertDemo();
  const p = apiInput.safeParse(raw);
  if (!p.success) return { ok: false, message: 'Isian tidak sah atau konfirmasi belum lengkap.' };
  return saveIntegration('api-publik', { type: 'api.aksi', input: p.data }, rev);
}
