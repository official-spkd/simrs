'use server';

import { formatJam, formatRupiah, poSubmitInputSchema, sumRupiah } from '@simrs/shared';
import { INVENTORY } from '@/lib/demo/fixtures/manajemen';
import { DENIED_MESSAGE, manajemenSession } from '@/lib/manajemen-aksi';

/**
 * Server Action logistik (B01, mode presentasi ADR-0023): gerbang demo, sesi lengkap, posisi pemakai layar
 * `logistik`, input zod; total dihitung ulang di server dari harga katalog (bigint). Tidak ada yang disimpan.
 */

export interface PoSubmitResult {
  ok: boolean;
  message: string;
  total?: string;
}

export async function submitPoAction(input: unknown): Promise<PoSubmitResult> {
  if (!(await manajemenSession('logistik'))) return { ok: false, message: DENIED_MESSAGE };
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
