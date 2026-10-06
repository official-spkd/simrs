'use server';

import { z } from 'zod';
import { DEPO_MASTER } from '@/lib/demo/fixtures/penunjang-depo';
import { DEMO_TODAY } from '@/lib/demo/fixtures/waktu';
import {
  DENIED,
  invalid,
  type PenunjangActionResult,
  penunjangSession,
  simulated,
} from '@/lib/penunjang-aksi';
import { DEPO_ERROR_TEXT, expiryStatus } from '@/lib/penunjang-depo';

/**
 * S05 · Server Action depo farmasi (mode presentasi, ADR-0023). Saldo di layar adalah keadaan lokal sesi; server
 * menegakkan aturan yang tidak bergantung pada saldo lokal: batch dan item dikenal master, batch kedaluwarsa tidak
 * pernah keluar, override FEFO dan selisih opname wajib alasan, penerima mutasi ≠ pengirim. Tidak menyimpan apa pun.
 */

const id = z.string().min(1).max(40);
const qty = z.number().int().positive().max(100_000);

const input = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('keluar'),
    depotId: id,
    itemId: id,
    qty,
    batchIds: z.array(id).min(1).max(10),
    overrideFefo: z.boolean(),
    reason: z.string().max(300),
  }),
  z.strictObject({ kind: z.literal('kirim'), from: id, to: id, itemId: id, qty }),
  z.strictObject({
    kind: z.literal('terima'),
    transferId: id,
    sentBy: z.string().max(120),
    receiver: z.string().max(120),
  }),
  z.strictObject({
    kind: z.literal('opname'),
    depotId: id,
    diffCount: z.number().int().min(0).max(500),
    reason: z.string().max(300),
  }),
  z.strictObject({ kind: z.literal('karantina'), depotId: id, batchId: id }),
]);

const depotName = (x: string) => DEPO_MASTER.depots.find((d) => d.id === x)?.name;
const item = (x: string) => DEPO_MASTER.items.find((i) => i.id === x);
const batch = (x: string) => DEPO_MASTER.batches.find((b) => b.id === x);

export async function recordDepoAction(raw: unknown): Promise<PenunjangActionResult> {
  const s = await penunjangSession('depo');
  if (!s) return DENIED;
  const p = input.safeParse(raw);
  if (!p.success) return invalid('Transaksi stok tidak dikenal.');
  const a = p.data;
  switch (a.kind) {
    case 'keluar': {
      const it = item(a.itemId);
      if (!it || !depotName(a.depotId)) return invalid('Item atau depo tidak dikenal.');
      for (const b of a.batchIds) {
        const found = batch(b);
        if (!found || found.itemId !== it.id) return invalid(DEPO_ERROR_TEXT.BATCH_UNKNOWN);
        if (expiryStatus(found.expiry, DEMO_TODAY).status === 'kedaluwarsa')
          return invalid(DEPO_ERROR_TEXT.BATCH_EXPIRED);
      }
      if (a.overrideFefo && a.reason.trim().length < 10)
        return invalid(DEPO_ERROR_TEXT.FEFO_OVERRIDE_REASON, 'reason');
      return simulated(
        `${it.name} ${a.qty} ${it.unit} keluar dari ${depotName(a.depotId)}${a.overrideFefo ? ' · override FEFO tercatat' : ' · FEFO'}`,
      );
    }
    case 'kirim': {
      const it = item(a.itemId);
      if (!it || !depotName(a.from) || !depotName(a.to)) return invalid('Item atau depo tidak dikenal.');
      if (a.from === a.to) return invalid(DEPO_ERROR_TEXT.SAME_DEPOT);
      return simulated(
        `Mutasi ${it.name} ${a.qty} ${it.unit} dikirim ${depotName(a.from)} → ${depotName(a.to)}`,
      );
    }
    case 'terima': {
      if (a.receiver.trim().length < 5) return invalid(DEPO_ERROR_TEXT.RECEIVER_REQUIRED, 'receiver');
      if (a.receiver.trim().toLowerCase() === a.sentBy.trim().toLowerCase())
        return invalid(DEPO_ERROR_TEXT.RECEIVER_SAME_AS_SENDER, 'receiver');
      return simulated(`Mutasi diterima oleh ${a.receiver.trim()}`);
    }
    case 'opname': {
      if (!depotName(a.depotId)) return invalid('Depo tidak dikenal.');
      if (a.diffCount > 0 && a.reason.trim().length < 10)
        return invalid(DEPO_ERROR_TEXT.OPNAME_REASON, 'reason');
      return simulated(`Stok opname ${depotName(a.depotId)} ditutup`);
    }
    case 'karantina': {
      const b = batch(a.batchId);
      if (!b || !depotName(a.depotId)) return invalid(DEPO_ERROR_TEXT.BATCH_UNKNOWN);
      if (expiryStatus(b.expiry, DEMO_TODAY).status !== 'kedaluwarsa')
        return invalid(DEPO_ERROR_TEXT.NOT_EXPIRED);
      return simulated(`Batch ${b.batchNo} dipindahkan ke karantina`);
    }
  }
}
