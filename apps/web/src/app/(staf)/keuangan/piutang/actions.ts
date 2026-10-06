'use server';

import { formatJam, formatRupiah } from '@simrs/shared';
import { z } from 'zod';
import type { EventOf } from '@/lib/demo/store/registry';
import { adjustmentJournal, paymentJournal } from '@/lib/keuangan-piutang';
import { ringkasJurnal, toAutoJurnal } from '@/lib/keuangan-jurnal';
import { nextBatchNumber } from '@/lib/keuangan-piutang-toko';
import {
  BAD_INPUT,
  demoStamp,
  keuanganSession,
  type KeuanganActionResult,
  NOT_YOUR_SCREEN,
  periodLock,
} from '@/lib/server/data/keuangan-toko';
import { commitEvent, readDomain } from '@/lib/server/demo/state';

/**
 * U04 · Server Action Penjaminan & piutang (mode presentasi, ADR-0085): batch penagihan, kirim, pelunasan bereferensi
 * (jurnal otomatis), dan penyesuaian berjenjang (pembuat ≠ penyetuju dari id pengguna sesi, posisi manajemen,
 * penolakan beralasan). Nominal dan jurnal dihitung server dari keadaan toko, bukan dari klien.
 */

const id = z.string().regex(/^[a-z0-9-]{1,60}$/);
const batchNo = z.string().regex(/^TG-\d{4}-\d{3}$/);
const rev = z.number().int().min(0);
const inputSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('batch'), itemIds: z.array(id).min(1).max(40), rev }),
  z.strictObject({ type: z.literal('kirim'), number: batchNo, rev }),
  z.strictObject({
    type: z.literal('bayar'),
    number: batchNo,
    amount: z.string().regex(/^[1-9]\d{0,14}$/),
    reference: z.string().trim().min(6).max(60),
    rev,
  }),
  z.strictObject({
    type: z.literal('ajukan'),
    itemId: id,
    kind: z.enum(['potongan', 'hapus-buku']),
    amount: z.string().regex(/^[1-9]\d{0,14}$/),
    reason: z.string().trim().min(20).max(500),
    rev,
  }),
  z.strictObject({
    type: z.literal('putuskan'),
    adjId: id,
    approve: z.boolean(),
    reason: z.string().trim().min(10).max(300).nullable(),
    rev,
  }),
]);
export type PiutangActionInput = z.infer<typeof inputSchema>;

export async function piutangAction(input: PiutangActionInput): Promise<KeuanganActionResult> {
  const s = await keuanganSession('piutang');
  if (!s) return { ok: false, message: NOT_YOUR_SCREEN };
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: BAD_INPUT };
  const c = parsed.data;
  const at = demoStamp();
  const jam = formatJam(at);
  const commit = async (event: EventOf<'piutang'>, message: string): Promise<KeuanganActionResult> => {
    const r = await commitEvent('piutang', event, { rev: c.rev, session: s });
    return r.ok ? { ok: true, message } : { ok: false, message: r.error, stale: r.stale };
  };
  const { state } = await readDomain('piutang');
  switch (c.type) {
    case 'batch': {
      const first = state.items.find((i) => i.id === c.itemIds[0]);
      return commit(
        { type: 'batch.buat', itemIds: c.itemIds, at },
        `Batch ${nextBatchNumber(state)} dibuat untuk ${first?.payerName ?? 'penjamin'} (${c.itemIds.length} invoice) · ${jam}`,
      );
    }
    case 'kirim':
      return commit(
        { type: 'batch.kirim', number: c.number, at },
        `Tagihan ${c.number} dikirim ke penjamin (surat + rincian invoice) · ${jam}`,
      );
    case 'bayar': {
      const lock = await periodLock(at);
      if (lock) return { ok: false, message: lock };
      const b = state.batches.find((x) => x.number === c.number);
      if (!b) return { ok: false, message: 'Batch tidak ditemukan.' };
      const amount = BigInt(c.amount);
      return commit(
        {
          type: 'batch.bayar',
          number: c.number,
          amount: c.amount,
          reference: c.reference,
          at,
          jurnal: [
            toAutoJurnal(paymentJournal(b, amount), { source: 'klaim', reference: `Piutang · ${b.number}` }),
          ],
        },
        `Pelunasan ${c.number} ${formatRupiah(amount)} diposting · ${jam} · ${ringkasJurnal(paymentJournal(b, amount))}`,
      );
    }
    case 'ajukan':
      return commit(
        {
          type: 'penyesuaian.ajukan',
          itemId: c.itemId,
          kind: c.kind,
          amount: c.amount,
          reason: c.reason,
          at,
        },
        `Penyesuaian AJ-2610-${String(state.nextAdjSeq).padStart(3, '0')} diajukan · ${jam} · menunggu persetujuan manajemen`,
      );
    case 'putuskan': {
      const a = state.adjustments.find((x) => x.id === c.adjId);
      const it = a ? state.items.find((i) => i.id === a.itemId) : undefined;
      if (!a || !it) return { ok: false, message: 'Penyesuaian tidak ditemukan.' };
      if (c.approve) {
        const lock = await periodLock(at);
        if (lock) return { ok: false, message: lock };
      }
      return commit(
        {
          type: 'penyesuaian.putuskan',
          adjId: c.adjId,
          approve: c.approve,
          reason: c.approve ? null : c.reason,
          at,
          jurnal: c.approve
            ? [
                toAutoJurnal(adjustmentJournal(a, it.payerGroup), {
                  source: 'klaim',
                  reference: `Piutang · ${a.number}`,
                }),
              ]
            : [],
        },
        c.approve
          ? `${a.number} disetujui dan diposting · ${jam} · ${ringkasJurnal(adjustmentJournal(a, it.payerGroup))}`
          : `${a.number} ditolak ${s.user.displayName} · alasan tercatat · ${jam}`,
      );
    }
  }
}
