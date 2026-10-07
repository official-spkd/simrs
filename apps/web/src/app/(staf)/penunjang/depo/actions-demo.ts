'use server';
import { supportEventSchema } from '@/lib/penunjang-demo';
import { DENIED, invalid, penunjangSession, saveSupport } from '@/lib/penunjang-aksi';

export async function recordDepoAction(raw: unknown, rev: number) {
  const s = await penunjangSession('depo');
  if (!s) return DENIED;
  const p = supportEventSchema.safeParse({ type: 'depo.aksi', input: raw });
  if (!p.success) return invalid('Isian transaksi stok tidak sah.');
  return saveSupport(s, p.data, rev);
}
export async function checkDepoAction(raw: unknown, rev: number) {
  const s = await penunjangSession('depo');
  if (!s) return DENIED;
  const p = supportEventSchema.safeParse({ type: 'depo.periksa', input: raw });
  if (!p.success) return invalid('Isian pemeriksaan stok tidak sah.');
  return saveSupport(s, p.data, rev);
}
