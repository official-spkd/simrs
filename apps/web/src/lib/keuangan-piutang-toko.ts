import { isoDateJakarta } from '@simrs/shared';
import { z } from 'zod';
import { type DemoActor, defineDomain, on } from './demo/store/define';
import { BATCH_TAGIHAN, NEXT_BATCH_SEQ, PENYESUAIAN, PIUTANG_ITEMS } from './demo/fixtures/piutang';
import { autoJurnalSchema } from './keuangan-jurnal';
import {
  adjustmentApprovalProblem,
  adjustmentProblems,
  allocatePayment,
  approveAdjustment,
  type BatchTagihan,
  batchProblem,
  batchRemaining,
  batchStatusOf,
  paymentProblem,
  type Penyesuaian,
  type PiutangItem,
} from './keuangan-piutang';
import { tagihanDomain, type TagihanEvent } from './keuangan-tagihan-toko';

/**
 * U04 · Domain toko demo `piutang` (ADR-0085): Penjaminan & piutang (mode presentasi). Keadaan = daftar piutang,
 * batch penagihan, dan penyesuaian (awal = fixture) setelah aksi tersimpan.
 *
 * - Langganan `tagihan` (`tagihan.tutup`/`tagihan.bayar` asuransi): bagian penjamin tagihan yang ditutup di Kasir
 *   menjadi piutang asuransi baru (belum ditagih).
 * - Pelunasan batch dan penyesuaian yang disetujui membawa jurnal otomatis seimbang (dibaca domain `akuntansi`).
 * - Persetujuan penyesuaian: posisi manajemen, pembuat ≠ penyetuju dari id pengguna sesi; penolakan wajib beralasan.
 */

export const PIUTANG_DOMAIN = 'piutang';

const stamp = z.iso.datetime({ offset: true });
const id = z.string().regex(/^[a-z0-9-]{1,60}$/);
const batchNo = z.string().regex(/^TG-\d{4}-\d{3}$/);
const rupiah = z.string().regex(/^[1-9]\d{0,14}$/);

export const piutangEventSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('batch.buat'), itemIds: z.array(id).min(1).max(40), at: stamp }),
  z.strictObject({ type: z.literal('batch.kirim'), number: batchNo, at: stamp }),
  z.strictObject({
    type: z.literal('batch.bayar'),
    number: batchNo,
    amount: rupiah,
    reference: z.string().trim().min(6).max(60),
    at: stamp,
    jurnal: z.array(autoJurnalSchema).length(1),
  }),
  z.strictObject({
    type: z.literal('penyesuaian.ajukan'),
    itemId: id,
    kind: z.enum(['potongan', 'hapus-buku']),
    amount: rupiah,
    reason: z.string().trim().min(20).max(500),
    at: stamp,
  }),
  z.strictObject({
    type: z.literal('penyesuaian.putuskan'),
    adjId: id,
    approve: z.boolean(),
    /** Wajib saat menolak. */
    reason: z.string().trim().min(10).max(300).nullable(),
    at: stamp,
    jurnal: z.array(autoJurnalSchema).max(1),
  }),
]);
export type PiutangEvent = z.infer<typeof piutangEventSchema>;

export interface StoredAdjustment extends Penyesuaian {
  makerId?: string;
  decidedById?: string;
  rejectReason?: string;
}

export interface PiutangState {
  items: readonly PiutangItem[];
  batches: readonly BatchTagihan[];
  adjustments: readonly StoredAdjustment[];
  nextBatchSeq: number;
  nextAdjSeq: number;
}

/** Nomor batch penagihan berikutnya. */
export const nextBatchNumber = (s: Pick<PiutangState, 'nextBatchSeq'>) =>
  `TG-2610-${String(s.nextBatchSeq).padStart(3, '0')}`;

function gate(s: PiutangState, ev: PiutangEvent, actor: DemoActor): string | null {
  switch (ev.type) {
    case 'batch.buat':
      return (
        batchProblem(s.items.filter((i) => ev.itemIds.includes(i.id))) ??
        (ev.itemIds.every((x) => s.items.some((i) => i.id === x)) ? null : 'Piutang tidak ditemukan.')
      );
    case 'batch.kirim': {
      const b = s.batches.find((x) => x.number === ev.number);
      if (!b) return 'Batch tidak ditemukan.';
      return b.status === 'draf' ? null : 'Batch sudah dikirim ke penjamin.';
    }
    case 'batch.bayar': {
      const b = s.batches.find((x) => x.number === ev.number);
      if (!b) return 'Batch tidak ditemukan.';
      if (b.status === 'draf') return 'Kirim tagihan ke penjamin lebih dulu.';
      return paymentProblem(batchRemaining(b, s.items), BigInt(ev.amount), ev.reference);
    }
    case 'penyesuaian.ajukan': {
      const it = s.items.find((i) => i.id === ev.itemId);
      const p = adjustmentProblems(it, BigInt(ev.amount), ev.reason);
      if (p.length) return `Belum bisa diajukan: ${p.join(', ')}.`;
      return s.adjustments.some((a) => a.itemId === ev.itemId && a.status === 'menunggu')
        ? 'Piutang ini masih punya penyesuaian yang menunggu persetujuan.'
        : null;
    }
    case 'penyesuaian.putuskan': {
      const a = s.adjustments.find((x) => x.id === ev.adjId);
      if (!a) return 'Penyesuaian tidak ditemukan.';
      const it = s.items.find((i) => i.id === a.itemId);
      const p = adjustmentApprovalProblem(a, { id: actor.userId, name: actor.name, role: actor.role }, it);
      if (p) return p;
      if (!ev.approve && !ev.reason) return 'Tulis alasan penolakan (min. 10 karakter).';
      return null;
    }
  }
}

function applyClosedInsurer(
  s: PiutangState,
  d: Extract<TagihanEvent, { type: 'tagihan.tutup' | 'tagihan.bayar' }>,
): PiutangState {
  const st = d.settlement;
  if (st.scheme !== 'asuransi' || BigInt(st.payerPays) <= 0n) return s;
  const itemId = `pi-${d.invoiceId}`.slice(0, 60);
  if (s.items.some((i) => i.id === itemId)) return s;
  const item: PiutangItem = {
    id: itemId,
    payerGroup: 'asuransi',
    payerName: st.payerLabel.split('·')[0]?.trim() || 'Asuransi swasta',
    patient: d.patient.name,
    invoiceNo: d.invoiceNo,
    invoiceDate: isoDateJakarta(d.at),
    amount: BigInt(st.payerPays),
    paid: 0n,
    batch: null,
  };
  return { ...s, items: [item, ...s.items] };
}

export const piutangDomain = defineDomain<PiutangState, PiutangEvent>(PIUTANG_DOMAIN, {
  initial: () => ({
    items: PIUTANG_ITEMS.map((i) => ({ ...i })),
    batches: BATCH_TAGIHAN.map((b) => ({ ...b, itemIds: [...b.itemIds], payments: [...b.payments] })),
    adjustments: PENYESUAIAN.map((a) => ({ ...a })),
    nextBatchSeq: NEXT_BATCH_SEQ,
    nextAdjSeq: 4,
  }),
  eventSchema: piutangEventSchema,
  screens: ['piutang'],
  validate: gate,
  reduce: (s, ev) => {
    const d = ev.data;
    const err = gate(s, d, ev.actor);
    if (err) throw new Error(err);
    switch (d.type) {
      case 'batch.buat': {
        const number = nextBatchNumber(s);
        const first = s.items.find((i) => i.id === d.itemIds[0]);
        if (!first) return s;
        return {
          ...s,
          nextBatchSeq: s.nextBatchSeq + 1,
          items: s.items.map((i) => (d.itemIds.includes(i.id) ? { ...i, batch: number } : i)),
          batches: [
            {
              number,
              payerName: first.payerName,
              payerGroup: first.payerGroup,
              itemIds: [...d.itemIds],
              status: 'draf',
              sentAt: null,
              payments: [],
            },
            ...s.batches,
          ],
        };
      }
      case 'batch.kirim':
        return {
          ...s,
          batches: s.batches.map((b) =>
            b.number === d.number ? { ...b, status: 'ditagih', sentAt: d.at } : b,
          ),
        };
      case 'batch.bayar': {
        const b = s.batches.find((x) => x.number === d.number);
        if (!b) return s;
        const amount = BigInt(d.amount);
        const items = allocatePayment(s.items, b, amount);
        const payments = [...b.payments, { id: `py-${ev.seq}`, at: d.at, amount, reference: d.reference }];
        const status = batchStatusOf({ ...b, payments }, items);
        return {
          ...s,
          items,
          batches: s.batches.map((x) => (x.number === d.number ? { ...x, payments, status } : x)),
        };
      }
      case 'penyesuaian.ajukan': {
        const n = s.nextAdjSeq;
        const adj: StoredAdjustment = {
          id: `aj-${n}`,
          number: `AJ-2610-${String(n).padStart(3, '0')}`,
          itemId: d.itemId,
          kind: d.kind,
          amount: BigInt(d.amount),
          reason: d.reason,
          maker: ev.actor.name,
          makerId: ev.actor.userId,
          createdAt: d.at,
          status: 'menunggu',
        };
        return { ...s, nextAdjSeq: n + 1, adjustments: [adj, ...s.adjustments] };
      }
      case 'penyesuaian.putuskan': {
        const a = s.adjustments.find((x) => x.id === d.adjId);
        if (!a) return s;
        const decided: StoredAdjustment = {
          ...a,
          status: d.approve ? 'disetujui' : 'ditolak',
          decidedBy: ev.actor.name,
          decidedById: ev.actor.userId,
          decidedAt: d.at,
          ...(d.reason ? { rejectReason: d.reason } : {}),
        };
        const items = d.approve ? approveAdjustment(s.items, a) : s.items;
        return {
          ...s,
          items,
          adjustments: s.adjustments.map((x) => (x.id === a.id ? decided : x)),
          batches: d.approve
            ? s.batches.map((b) =>
                b.itemIds.includes(a.itemId) ? { ...b, status: batchStatusOf(b, items) } : b,
              )
            : s.batches,
        };
      }
    }
  },
  subscriptions: [
    on(tagihanDomain, (s, ev) =>
      ev.data.type === 'tagihan.tutup' || ev.data.type === 'tagihan.bayar'
        ? applyClosedInsurer(s, ev.data)
        : s,
    ),
  ],
});
