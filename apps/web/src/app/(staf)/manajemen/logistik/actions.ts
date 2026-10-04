'use server';

import { formatJam, formatRupiah, poSubmitInputSchema, sumRupiah } from '@simrs/shared';
import { redirect } from 'next/navigation';
import { INVENTORY } from '@/lib/demo/fixtures/manajemen';
import { assertDemo } from '@/lib/server/demo-guard';
import { getSession } from '@/lib/server/session';
import { nextLoginStep } from '@/lib/session-view';

/**
 * Server Action logistik (B01, mode presentasi ADR-0023): gerbang demo, sesi lengkap, input zod; total dihitung
 * ulang di server dari harga katalog (bigint). Tidak ada yang disimpan.
 */

export interface PoSubmitResult {
  ok: boolean;
  message: string;
  total?: string;
}

async function demoSession() {
  assertDemo();
  const s = await getSession();
  if (!s || nextLoginStep(s, false) !== 'selesai') redirect('/masuk');
  return s;
}

export async function submitPoAction(input: unknown): Promise<PoSubmitResult> {
  await demoSession();
  const parsed = poSubmitInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: 'Draf PO tidak sah. Pilih ulang item.' };
  const byId = new Map(INVENTORY.map((i) => [i.id, i]));
  const lines = parsed.data.lines.map((l) => ({ ...l, item: byId.get(l.itemId) }));
  if (lines.some((l) => !l.item)) return { ok: false, message: 'Ada item yang tidak dikenal di draf PO.' };
  if (new Set(lines.map((l) => l.itemId)).size !== lines.length) {
    return { ok: false, message: 'Item ganda di draf PO.' };
  }
  const total = sumRupiah(lines.map((l) => BigInt(l.item?.unitPrice ?? '0') * BigInt(l.qty)));
  return {
    ok: true,
    total: total.toString(),
    message: `Usulan ${parsed.data.number} diajukan ke direktur pukul ${formatJam(new Date())} · ${lines.length} item · total ${formatRupiah(total)} (simulasi, tidak disimpan).`,
  };
}
