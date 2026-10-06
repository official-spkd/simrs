'use server';
import { bpjsInput } from '@/lib/integrasi-event-schemas';
import { saveIntegration } from '@/lib/integrasi-aksi';
import { assertDemo } from '@/lib/server/demo-guard';
export async function bpjsAction(raw: unknown, rev: number) {
  assertDemo();
  const p = bpjsInput.safeParse(raw);
  if (!p.success) return { ok: false, message: 'Isian tidak sah atau konfirmasi belum lengkap.' };
  return saveIntegration('bpjs', { type: 'bpjs.aksi', input: p.data }, rev);
}

export async function deferBpjsAction(kind: 'SEP' | 'Task ID' | 'Aplicare', label: string, rev: number) {
  return saveIntegration('bpjs', { type: 'bpjs.tunda', kind, label }, rev);
}
