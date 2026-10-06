import { sumRupiah } from '@simrs/shared';
import { z } from 'zod';
import { type DemoActor, defineDomain, on } from './demo/store/define';
import { logisticsDomain } from './logistik-toko';
import { FAKTUR_PEMASOK, HUTANG_SUMMARY } from './demo/fixtures/hutang';
import {
  applyApproval,
  approveProblem,
  type FakturPemasok,
  requiredLevels,
  scheduleProblem,
  threeWay,
  verifyProblem,
} from './keuangan-hutang';
import { autoJurnalSchema } from './keuangan-jurnal';

/**
 * U10 · Domain toko demo `hutang` (ADR-0085): Hutang usaha (mode presentasi). Keadaan = faktur pemasok (awal =
 * fixture), batch pembayaran, dan saldo bank mitra setelah aksi tersimpan.
 *
 * - Aliran masuk Logistik (CX-3): kejadian `logistik` · `penerimaan.dicatat` {grn, po, supplier, title, items, total,
 *   poTotal, tanggal, jatuhTempo} menjadi faktur draf (nilai faktur = nilai penerimaan) lewat `applyReceipt`. Langganan
 *   `on(logisticsDomain, …)` di bawah.
 * - Verifikasi akuntan (pencocokan 3 arah), persetujuan berjenjang manajemen (pemverifikasi ≠ penyetuju, tingkat 2 ≠
 *   tingkat 1 dari id pengguna sesi), nota kredit/selisih beralasan, jadwal bayar, dan posting pembayaran (akuntan).
 *   Persetujuan akhir dan pembayaran membawa jurnal otomatis seimbang ke Akuntansi.
 */

export const HUTANG_DOMAIN = 'hutang';

const stamp = z.iso.datetime({ offset: true });
const id = z.string().regex(/^[a-z0-9-]{1,60}$/);
const batchNo = z.string().regex(/^BYR-\d{4}-\d{3}$/);

export const hutangEventSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('faktur.nota-kredit'), invoiceId: id, at: stamp }),
  z.strictObject({
    type: z.literal('faktur.selisih'),
    invoiceId: id,
    reason: z.string().trim().min(15).max(300),
    at: stamp,
  }),
  z.strictObject({ type: z.literal('faktur.verifikasi'), invoiceId: id, at: stamp }),
  z.strictObject({
    type: z.literal('faktur.setujui'),
    invoiceId: id,
    at: stamp,
    jurnal: z.array(autoJurnalSchema).max(1),
  }),
  z.strictObject({ type: z.literal('batch.buat'), invoiceIds: z.array(id).min(1).max(30), at: stamp }),
  z.strictObject({
    type: z.literal('batch.bayar'),
    number: batchNo,
    at: stamp,
    jurnal: z.array(autoJurnalSchema).length(1),
  }),
]);
export type HutangEvent = z.infer<typeof hutangEventSchema>;

/** Kontrak penerimaan Logistik yang dibaca Hutang (bagian dari `logistik` · `penerimaan.dicatat`). */
export const receiptContractSchema = z.object({
  type: z.literal('penerimaan.dicatat'),
  grn: z.string().regex(/^GRN-\d{4}-\d{4}$/),
  po: z.string().regex(/^PO-\d{4}-\d{3}$/),
  supplier: z.string().min(1).max(200),
  title: z.string().min(1).max(200),
  total: z.string().regex(/^\d{1,15}$/),
  poTotal: z.string().regex(/^\d{1,15}$/),
  tanggal: z.iso.date(),
  jatuhTempo: z.iso.date(),
});
export type ReceiptContract = z.infer<typeof receiptContractSchema>;

export interface HutangState {
  invoices: readonly FakturPemasok[];
  batch: { number: string; ids: string[]; total: bigint; by: string } | null;
  balance: bigint;
  nextBatchSeq: number;
}

export const nextBatchNo = (s: Pick<HutangState, 'nextBatchSeq'>) =>
  `BYR-2610-${String(s.nextBatchSeq).padStart(3, '0')}`;

/** Faktur draf dari penerimaan barang Logistik (kontrak CX-3). Idempoten per nomor GRN. */
export function applyReceipt(s: HutangState, r: ReceiptContract): HutangState {
  const fid = `fp-${r.grn.toLowerCase()}`;
  if (s.invoices.some((f) => f.id === fid || f.grnNumber === r.grn)) return s;
  const faktur: FakturPemasok = {
    id: fid,
    invoiceNo: `INV/${r.grn.slice(4)}`,
    supplier: r.supplier,
    poNumber: r.po,
    grnNumber: r.grn,
    title: r.title,
    receivedAt: `${r.tanggal}T00:00:00+07:00`,
    invoiceDate: r.tanggal,
    dueDate: r.jatuhTempo,
    poAmount: BigInt(r.poTotal),
    grnAmount: BigInt(r.total),
    invoiceAmount: BigInt(r.total),
    status: 'draf',
    verifiedBy: null,
    approvals: [],
    varianceNote: null,
    paidAt: null,
    paymentBatch: null,
  };
  return { ...s, invoices: [faktur, ...s.invoices] };
}

function gate(s: HutangState, ev: HutangEvent, actor: DemoActor): string | null {
  const viewer = { id: actor.userId, name: actor.name, role: actor.role };
  if (ev.type === 'batch.buat') {
    if (s.batch) return 'Selesaikan batch yang terbuka dulu.';
    const sel = s.invoices.filter((f) => ev.invoiceIds.includes(f.id));
    if (sel.length !== ev.invoiceIds.length) return 'Faktur tidak ditemukan.';
    return scheduleProblem(sel, s.balance);
  }
  if (ev.type === 'batch.bayar') {
    if (!s.batch || s.batch.number !== ev.number) return 'Batch pembayaran tidak ditemukan.';
    return actor.role === 'akuntan' ? null : 'Pembayaran diposting posisi akuntan (transfer H2H bank mitra).';
  }
  const f = s.invoices.find((x) => x.id === ev.invoiceId);
  if (!f) return 'Faktur tidak ditemukan.';
  switch (ev.type) {
    case 'faktur.nota-kredit':
    case 'faktur.selisih': {
      const m = threeWay(f);
      if (f.status !== 'draf' || m.ok || m.overPo || f.varianceNote)
        return 'Tidak ada selisih faktur yang perlu diselesaikan.';
      return null;
    }
    case 'faktur.verifikasi':
      return verifyProblem(f, viewer);
    case 'faktur.setujui':
      return approveProblem(f, viewer);
  }
}

export const hutangDomain = defineDomain<HutangState, HutangEvent>(HUTANG_DOMAIN, {
  initial: () => ({
    invoices: FAKTUR_PEMASOK.map((f) => ({ ...f, approvals: [...f.approvals] })),
    batch: null,
    balance: HUTANG_SUMMARY.bankMitraBalance,
    nextBatchSeq: HUTANG_SUMMARY.nextBatchSeq,
  }),
  eventSchema: hutangEventSchema,
  screens: ['hutang'],
  // Kontrak CX-3: penerimaan barang Logistik → faktur draf (dipasang saat CX-3 bergabung, permintaan handoff CX-2).
  subscriptions: [
    on(logisticsDomain, (s, ev) => (ev.data.type === 'penerimaan.dicatat' ? applyReceipt(s, ev.data) : s)),
  ],
  validate: gate,
  reduce: (s, ev) => {
    const d = ev.data;
    const err = gate(s, d, ev.actor);
    if (err) throw new Error(err);
    const by = ev.actor.name;
    const patch = (fid: string, fn: (f: FakturPemasok) => FakturPemasok): HutangState => ({
      ...s,
      invoices: s.invoices.map((f) => (f.id === fid ? fn(f) : f)),
    });
    switch (d.type) {
      case 'faktur.nota-kredit':
        return patch(d.invoiceId, (f) => ({ ...f, invoiceAmount: f.grnAmount }));
      case 'faktur.selisih':
        return patch(d.invoiceId, (f) => ({ ...f, varianceNote: d.reason }));
      case 'faktur.verifikasi':
        return patch(d.invoiceId, (f) => ({
          ...f,
          status: 'diverifikasi',
          verifiedBy: by,
          verifiedById: ev.actor.userId,
        }));
      case 'faktur.setujui':
        return patch(d.invoiceId, (f) => applyApproval(f, by, d.at, ev.actor.userId));
      case 'batch.buat': {
        const number = nextBatchNo(s);
        const sel = s.invoices.filter((f) => d.invoiceIds.includes(f.id));
        return {
          ...s,
          nextBatchSeq: s.nextBatchSeq + 1,
          batch: { number, ids: [...d.invoiceIds], total: sumRupiah(sel.map((f) => f.invoiceAmount)), by },
          invoices: s.invoices.map((f) =>
            d.invoiceIds.includes(f.id) ? { ...f, status: 'terjadwal', paymentBatch: number } : f,
          ),
        };
      }
      case 'batch.bayar': {
        const b = s.batch;
        if (!b) return s;
        return {
          ...s,
          batch: null,
          balance: s.balance - b.total,
          invoices: s.invoices.map((f) =>
            b.ids.includes(f.id) ? { ...f, status: 'dibayar', paidAt: d.at } : f,
          ),
        };
      }
    }
  },
});

/** Faktur akan disetujui penuh oleh persetujuan berikutnya (jurnal faktur diposting). */
export const finalApproval = (f: FakturPemasok) => f.approvals.length + 1 >= requiredLevels(f);
