import { type InventoryItem, type PurchaseOrder, sumRupiah } from '@simrs/shared';
import { z } from 'zod';
import { type ActorRef, actorRef, jamSchema, type LogLine, must, pushLog } from './backoffice-toko';
import { defineDomain } from './demo/store/define';
import { PO_RECEIPT_LINES, PO_SUPPLIER } from './demo/fixtures/logistik-terima';
import {
  EXPIRING,
  INVENTORY,
  LOGISTICS_KPI,
  OPEN_PO_ITEMS,
  PURCHASE_ORDERS,
} from './demo/fixtures/manajemen';
import { DEMO_TODAY } from './demo/fixtures/waktu';
import { grNumber, lineBlock, payableDue, type ReceiptLine } from './logistik-terima';
import { CRITICAL_COVER_DAYS, daysOfCover, needsReorder, reorderPoint } from './manajemen';

/**
 * B01 · Domain toko demo `logistik` (ADR-0085, CX-3): ROP → usulan PO → persetujuan direktur → terbit PO →
 * dikirim pemasok → penerimaan barang (stok bertambah) dan tindakan kedaluwarsa FEFO.
 *
 * Kejadian `penerimaan.dicatat` adalah KONTRAK keluar untuk Hutang usaha (CX-2): `{ grn, po, supplier, title, items,
 * total, poTotal, jatuhTempo, tanggal, jam }`, rupiah sebagai string digit (`BigInt(total)`). Isinya dihitung Server
 * Action dari keadaan terkini dan diperiksa ulang `validate` (nomor GRN berurutan, jumlah ≤ pesanan, batch +
 * kedaluwarsa ≥ 6 bulan, total = Σ harga × diterima, jatuh tempo 30 hari), sehingga pelanggan bisa memercayainya.
 * Jurnalnya (Dr 1-1410 Persediaan / Cr 2-1120 Utang penerimaan belum difakturkan) mengikuti `receiptJournal`.
 */

export const LOGISTICS_DOMAIN = 'logistik';
export const EXPIRY_ACTIONS = ['pindah', 'retur'] as const;

const poNo = z.string().regex(/^PO-\d{4}-\d{3}$/);
const grnNo = z.string().regex(/^GRN-\d{4}-\d{4}$/);
const rupiah = z.string().regex(/^\d{1,15}$/);
const isoDate = z.iso.date();

export const receiptItemSchema = z.strictObject({
  itemId: z.string().min(1).max(40),
  name: z.string().min(1).max(120),
  unit: z.string().min(1).max(30),
  ordered: z.number().int().min(1),
  received: z.number().int().min(1).max(1_000_000),
  batch: z.string().trim().min(3).max(40),
  expiry: isoDate,
  unitPrice: rupiah,
  subtotal: rupiah,
});
export type ReceiptItem = z.infer<typeof receiptItemSchema>;

export const logisticsEventSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('po.diajukan'),
    number: poNo,
    lines: z
      .array(z.strictObject({ itemId: z.string().min(1).max(40), qty: z.number().int().min(1).max(100_000) }))
      .min(1)
      .max(50),
    total: rupiah,
    jam: jamSchema,
  }),
  z.strictObject({ type: z.literal('po.disetujui'), po: poNo, jam: jamSchema }),
  z.strictObject({ type: z.literal('po.diterbitkan'), po: poNo, jam: jamSchema }),
  z.strictObject({ type: z.literal('po.dikirim'), po: poNo, jam: jamSchema }),
  z.strictObject({
    /** KONTRAK keluar untuk Hutang usaha (CX-2). */
    type: z.literal('penerimaan.dicatat'),
    grn: grnNo,
    po: poNo,
    supplier: z.string().min(1).max(200),
    title: z.string().min(1).max(200),
    items: z.array(receiptItemSchema).min(1).max(50),
    /** Nilai penerimaan (rupiah utuh, string digit) = Σ harga satuan × diterima. */
    total: rupiah,
    /** Nilai PO (rupiah utuh) untuk pencocokan tiga arah PO-GRN-faktur. */
    poTotal: rupiah,
    coldChainOk: z.boolean(),
    /** Tanggal terima (hari presentasi) dan jatuh tempo utang 30 hari. */
    tanggal: isoDate,
    jatuhTempo: isoDate,
    jam: jamSchema,
  }),
  z.strictObject({
    type: z.literal('kedaluwarsa.ditindak'),
    id: z.string().min(1).max(40),
    action: z.enum(EXPIRY_ACTIONS),
    jam: jamSchema,
  }),
]);
export type LogisticsEvent = z.infer<typeof logisticsEventSchema>;
export type ReceiptEvent = Extract<LogisticsEvent, { type: 'penerimaan.dicatat' }>;

export interface StoredPo {
  id: string;
  title: string;
  lines: ReceiptLine[];
  supplier: string;
  total: string;
  urgent: boolean;
  by: ActorRef;
  jam: string;
}

export interface StoredReceipt extends Omit<ReceiptEvent, 'type'> {
  by: ActorRef;
}

export interface LogisticsStoreState {
  /** Tambahan stok per item dari penerimaan barang. */
  stockAdd: Record<string, number>;
  /** PO baru dari layar (terbaru di atas). */
  orders: StoredPo[];
  approved: Record<string, { by: ActorRef; jam: string }>;
  issued: Record<string, { by: ActorRef; jam: string }>;
  shipped: Record<string, { by: ActorRef; jam: string }>;
  receipts: StoredReceipt[];
  expiry: Record<string, { action: 'pindah' | 'retur'; by: ActorRef; jam: string }>;
  nextPoSeq: number;
  grSeq: number;
  log: LogLine[];
}

export const poNumber = (n: number) => `PO-2610-${String(n).padStart(3, '0')}`;

export function initialLogistics(): LogisticsStoreState {
  return {
    stockAdd: {},
    orders: [],
    approved: {},
    issued: {},
    shipped: {},
    receipts: [],
    expiry: {},
    // PO-2610-032 = draf berikutnya (fixture `nextPoNumber`); GRN-2610-0144 = cairan infus pagi ini (Hutang).
    nextPoSeq: 32,
    grSeq: 145,
    log: [],
  };
}

const INVENTORY_BY_ID = new Map(INVENTORY.map((i) => [i.id, i]));

/** Item stok dengan tambahan penerimaan, ROP, dan hari cukup (sama dengan `demoLogisticsOverview`). */
export function inventoryNow(s: Pick<LogisticsStoreState, 'stockAdd'>): InventoryItem[] {
  return INVENTORY.map((i) => {
    const stock = i.stock + (s.stockAdd[i.id] ?? 0);
    return {
      ...i,
      stock,
      lots: i.lots.map((l) => ({ ...l })),
      reorderPoint: reorderPoint(i),
      daysOfCover: daysOfCover(stock, i.avgDailyUse),
    };
  }).sort((a, b) => a.daysOfCover - b.daysOfCover);
}

/** Baris penerimaan PO (fixture PO yang sedang dikirim, atau PO yang dibuat di layar). */
export function receiptLinesOf(s: LogisticsStoreState, po: string): readonly ReceiptLine[] | null {
  return s.orders.find((o) => o.id === po)?.lines ?? PO_RECEIPT_LINES[po] ?? null;
}

export function supplierOf(s: LogisticsStoreState, po: string): string {
  return s.orders.find((o) => o.id === po)?.supplier ?? PO_SUPPLIER[po] ?? 'Pemasok';
}

/** Item yang sedang di PO terbuka (belum diterima) → nomor PO: terkunci agar tidak dipesan ganda. */
export function openPoItems(s: LogisticsStoreState): Record<string, string> {
  const received = new Set(s.receipts.map((r) => r.po));
  const out: Record<string, string> = {};
  for (const [item, po] of Object.entries(OPEN_PO_ITEMS)) if (!received.has(po)) out[item] = po;
  for (const [po, lines] of Object.entries(PO_RECEIPT_LINES))
    if (!received.has(po)) for (const l of lines) out[l.itemId] = po;
  for (const o of s.orders) if (!received.has(o.id)) for (const l of o.lines) out[l.itemId] = o.id;
  return out;
}

export interface PoView extends PurchaseOrder {
  /** Pengusul (PO dari layar) untuk pemisahan tugas pengusul ≠ penyetuju. */
  by: ActorRef | null;
  /** Ada baris penerimaan (bisa diterima saat tahap kirim). */
  receivable: boolean;
  /** Teks keberhasilan (persetujuan/terbit/kirim/terima) dengan pelaku. */
  doneText: string | null;
}

/** Daftar pengadaan berjalan: PO dari layar (terbaru di atas) lalu fixture, tahap dari kejadian. */
export function procurementRows(s: LogisticsStoreState): PoView[] {
  const fromStore: PurchaseOrder[] = s.orders.map((o) => ({
    id: o.id,
    title: o.title,
    total: o.total,
    stage: 1,
    statusText: `Diajukan ${o.by.name} · ${o.jam} · menunggu persetujuan direktur`,
  }));
  return [...fromStore, ...PURCHASE_ORDERS].map((p) => {
    const rec = s.receipts.find((r) => r.po === p.id);
    const stage = rec ? 5 : s.shipped[p.id] ? 4 : s.issued[p.id] ? 3 : s.approved[p.id] ? 2 : p.stage;
    const doneText = rec
      ? `Diterima ${rec.grn} · ${rec.jam} oleh ${rec.by.name} · stok ${rec.items
          .map((i) => `+${i.received.toLocaleString('id-ID')} ${i.unit}`)
          .join(', ')}`
      : s.shipped[p.id]
        ? `Dikirim pemasok · dikonfirmasi ${s.shipped[p.id]?.by.name} ${s.shipped[p.id]?.jam} · siap diterima`
        : s.issued[p.id]
          ? `PO terbit ke ${supplierOf(s, p.id)} · ${s.issued[p.id]?.jam} oleh ${s.issued[p.id]?.by.name}`
          : s.approved[p.id]
            ? `Disetujui direktur ${s.approved[p.id]?.jam} oleh ${s.approved[p.id]?.by.name} · siap terbit PO / e-katalog`
            : null;
    return {
      ...p,
      stage,
      by: s.orders.find((o) => o.id === p.id)?.by ?? null,
      receivable: receiptLinesOf(s, p.id) !== null,
      doneText,
    };
  });
}

/** Nilai persediaan = KPI awal + penerimaan barang di layar (rupiah bigint). */
export function inventoryValue(s: Pick<LogisticsStoreState, 'receipts'>): bigint {
  return BigInt(LOGISTICS_KPI.inventoryValue) + sumRupiah(s.receipts.map((r) => BigInt(r.total)));
}

/** Baris PO dari item terpilih: harga katalog, jumlah usulan; total bigint. */
export function poLines(lines: ReadonlyArray<{ itemId: string; qty: number }>): ReceiptLine[] | null {
  const out: ReceiptLine[] = [];
  for (const l of lines) {
    const i = INVENTORY_BY_ID.get(l.itemId);
    if (!i) return null;
    out.push({
      itemId: i.id,
      name: i.name,
      unit: i.unit,
      ordered: l.qty,
      unitPrice: i.unitPrice,
      cold: i.note.includes('dingin'),
    });
  }
  return out;
}

const linesTotal = (lines: readonly ReceiptLine[]) =>
  sumRupiah(lines.map((l) => BigInt(l.unitPrice) * BigInt(l.ordered)));

function poStage(s: LogisticsStoreState, po: string): number | null {
  return procurementRows(s).find((p) => p.id === po)?.stage ?? null;
}

/** Isi kejadian penerimaan yang benar untuk PO `po` dari isian layar (dipakai Server Action dan `validate`). */
export function buildReceipt(
  s: LogisticsStoreState,
  po: string,
  inputs: Readonly<Record<string, { received: string; batch: string; expiry: string }>>,
  coldChainOk: boolean,
  jam: string,
): { event: ReceiptEvent } | { error: string } {
  const lines = receiptLinesOf(s, po);
  if (!lines) return { error: `${po} tidak punya baris penerimaan.` };
  if (poStage(s, po) !== 4) return { error: `${po} belum dikirim pemasok atau sudah diterima.` };
  for (const l of lines) {
    const b = lineBlock(l, inputs[l.itemId] ?? { received: '', batch: '', expiry: '' }, DEMO_TODAY);
    if (b) return { error: b };
  }
  if (lines.some((l) => l.cold) && !coldChainOk)
    return { error: 'Centang suhu rantai dingin 2–8 °C sesuai saat diterima.' };
  const items: ReceiptItem[] = lines.map((l) => {
    const v = inputs[l.itemId] ?? { received: '0', batch: '', expiry: '' };
    const received = Number(v.received.trim());
    return {
      itemId: l.itemId,
      name: l.name,
      unit: l.unit,
      ordered: l.ordered,
      received,
      batch: v.batch.trim(),
      expiry: v.expiry,
      unitPrice: l.unitPrice,
      subtotal: (BigInt(l.unitPrice) * BigInt(received)).toString(),
    };
  });
  const row = procurementRows(s).find((p) => p.id === po);
  return {
    event: {
      type: 'penerimaan.dicatat',
      grn: grNumber(s.grSeq),
      po,
      supplier: supplierOf(s, po),
      title: row?.title ?? po,
      items,
      total: sumRupiah(items.map((i) => BigInt(i.subtotal))).toString(),
      poTotal: row?.total ?? linesTotal(lines).toString(),
      coldChainOk,
      tanggal: DEMO_TODAY,
      jatuhTempo: payableDue(DEMO_TODAY),
      jam,
    },
  };
}

/** Draf PO dari item terpilih (nomor + total dihitung dari keadaan terkini). */
export function buildPoEvent(
  s: LogisticsStoreState,
  lines: ReadonlyArray<{ itemId: string; qty: number }>,
  jam: string,
): { event: Extract<LogisticsEvent, { type: 'po.diajukan' }> } | { error: string } {
  const built = poLines(lines);
  if (!built) return { error: 'Ada item yang tidak dikenal di draf PO.' };
  if (new Set(lines.map((l) => l.itemId)).size !== lines.length) return { error: 'Item ganda di draf PO.' };
  const open = openPoItems(s);
  const locked = lines.find((l) => open[l.itemId]);
  if (locked) return { error: `Item sudah ada di ${open[locked.itemId]}; tunggu barang diterima.` };
  const stock = new Map(inventoryNow(s).map((i) => [i.id, i]));
  const notLow = lines.find((l) => {
    const i = stock.get(l.itemId);
    return !i || !needsReorder(i);
  });
  if (notLow) return { error: 'Item sudah di atas titik pesan ulang; tidak perlu diusulkan.' };
  return {
    event: {
      type: 'po.diajukan',
      number: poNumber(s.nextPoSeq),
      lines: lines.map((l) => ({ itemId: l.itemId, qty: l.qty })),
      total: linesTotal(built).toString(),
      jam,
    },
  };
}

function sameReceipt(a: ReceiptEvent, b: ReceiptEvent): boolean {
  return JSON.stringify({ ...a, jam: '' }) === JSON.stringify({ ...b, jam: '' });
}

const DIRECTOR = ['manajemen'];

function gate(s: LogisticsStoreState, ev: LogisticsEvent, actor: { userId: string; role: string | null }) {
  switch (ev.type) {
    case 'po.diajukan': {
      const r = buildPoEvent(s, ev.lines, ev.jam);
      if ('error' in r) return r.error;
      if (r.event.number !== ev.number) return `Nomor PO berikutnya ${r.event.number}; muat ulang layar.`;
      if (r.event.total !== ev.total) return 'Total PO tidak sesuai harga katalog.';
      return null;
    }
    case 'po.disetujui': {
      if (!actor.role || !DIRECTOR.includes(actor.role))
        return 'Hanya posisi Manajemen (direktur) yang menyetujui usulan PO.';
      if (poStage(s, ev.po) !== 1) return `${ev.po} tidak sedang menunggu persetujuan.`;
      const by = s.orders.find((o) => o.id === ev.po)?.by;
      if (by && by.userId === actor.userId)
        return 'Penyetuju harus berbeda dari pengusul PO (pemisahan tugas).';
      return null;
    }
    case 'po.diterbitkan':
      return poStage(s, ev.po) === 2 ? null : `${ev.po} belum disetujui direktur atau sudah terbit.`;
    case 'po.dikirim':
      return poStage(s, ev.po) === 3 ? null : `${ev.po} belum terbit sebagai PO atau sudah dikirim.`;
    case 'penerimaan.dicatat': {
      const inputs = Object.fromEntries(
        ev.items.map((i) => [i.itemId, { received: String(i.received), batch: i.batch, expiry: i.expiry }]),
      );
      const r = buildReceipt(s, ev.po, inputs, ev.coldChainOk, ev.jam);
      if ('error' in r) return r.error;
      return sameReceipt(r.event, ev) ? null : 'Isi penerimaan tidak sesuai PO; muat ulang layar.';
    }
    case 'kedaluwarsa.ditindak':
      if (!EXPIRING.some((e) => e.id === ev.id)) return 'Batch kedaluwarsa tidak dikenal.';
      return s.expiry[ev.id] ? 'Batch ini sudah ditindaklanjuti.' : null;
  }
}

export const logisticsDomain = defineDomain<LogisticsStoreState, LogisticsEvent>(LOGISTICS_DOMAIN, {
  initial: initialLogistics,
  eventSchema: logisticsEventSchema,
  // Dasbor ikut dimuat ulang: kartu stok kritis membaca stok yang sama.
  screens: ['logistik', 'dasbor'],
  validate: (s, ev, actor) => gate(s, ev, actor),
  reduce: (s, ev) => {
    const d = ev.data;
    must(gate(s, d, ev.actor));
    const by = actorRef(ev.actor);
    const log = (text: string) => pushLog(s.log, { jam: d.jam, text, by: by.name });
    switch (d.type) {
      case 'po.diajukan': {
        const lines = poLines(d.lines) as ReceiptLine[];
        const first = lines[0]?.name ?? 'Item';
        const suppliers = [
          ...new Set(d.lines.map((l) => INVENTORY_BY_ID.get(l.itemId)?.supplier ?? 'Pemasok')),
        ];
        const urgent = d.lines.some((l) => {
          const i = inventoryNow(s).find((x) => x.id === l.itemId);
          return i?.channel === 'po-darurat' || (i?.daysOfCover ?? 99) < CRITICAL_COVER_DAYS;
        });
        return {
          ...s,
          orders: [
            {
              id: d.number,
              title: lines.length > 1 ? `${first} +${lines.length - 1} item` : first,
              lines,
              supplier: suppliers.join(' · '),
              total: d.total,
              urgent,
              by,
              jam: d.jam,
            },
            ...s.orders,
          ],
          nextPoSeq: s.nextPoSeq + 1,
          log: log(`Usulan ${d.number} diajukan ke direktur`),
        };
      }
      case 'po.disetujui':
        return {
          ...s,
          approved: { ...s.approved, [d.po]: { by, jam: d.jam } },
          log: log(`${d.po} disetujui direktur`),
        };
      case 'po.diterbitkan':
        return {
          ...s,
          issued: { ...s.issued, [d.po]: { by, jam: d.jam } },
          log: log(`${d.po} terbit ke ${supplierOf(s, d.po)}`),
        };
      case 'po.dikirim':
        return {
          ...s,
          shipped: { ...s.shipped, [d.po]: { by, jam: d.jam } },
          log: log(`${d.po} dikirim pemasok`),
        };
      case 'penerimaan.dicatat': {
        const stockAdd = { ...s.stockAdd };
        for (const i of d.items) stockAdd[i.itemId] = (stockAdd[i.itemId] ?? 0) + i.received;
        const { type: _t, ...rest } = d;
        return {
          ...s,
          stockAdd,
          receipts: [{ ...rest, by }, ...s.receipts],
          grSeq: s.grSeq + 1,
          log: log(`${d.grn} dicatat untuk ${d.po}`),
        };
      }
      case 'kedaluwarsa.ditindak':
        return {
          ...s,
          expiry: { ...s.expiry, [d.id]: { action: d.action, by, jam: d.jam } },
          log: log(`Batch kedaluwarsa ${d.id} ${d.action === 'pindah' ? 'dipindahkan' : 'diretur'}`),
        };
    }
  },
});
