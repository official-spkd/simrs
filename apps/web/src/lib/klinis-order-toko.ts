import {
  CPOE_COVERAGES,
  CPOE_ORDER_KINDS,
  CPOE_PRIORITIES,
  type CpoeContext,
  type CpoeOrder,
  formatJam,
} from '@simrs/shared';
import { z } from 'zod';
import { defineDomain } from './demo/store/define';

/**
 * Toko demo bersama (ADR-0085) · domain `klinis-order`: order CPOE yang ditandatangani dokter (TTE) setelah gerbang
 * CDS server lolos. Kejadian `order.ditandatangani` adalah **kontrak aliran keluar** klinis: dilanggan pemilik
 * Penunjang/Farmasi (worklist Lab, Radiologi, Farmasi; CX-1) dan Keuangan (charge capture; CX-2). Isinya cukup untuk
 * worklist dan tagihan tanpa membaca fixture klinis: kode baku (LOINC/KFA/ICD-9-CM), prioritas, penjaminan, tarif RS
 * (string rupiah, bukan float), alasan override CDS, dan unit tujuan.
 */

const rupiah = z.string().regex(/^\d{1,15}$/);

export const orderLineSchema = z.strictObject({
  /** Id baris order (unik per kunjungan): `<kunjungan>-o<seq>-<katalog>`. */
  lineId: z.string().min(1).max(160),
  catalogId: z.string().regex(/^[a-z0-9-]+$/),
  kind: z.enum(CPOE_ORDER_KINDS),
  name: z.string().min(1).max(120),
  detail: z.string().min(1).max(200),
  code: z
    .strictObject({ system: z.enum(['LOINC', 'KFA', 'ICD-9-CM']), code: z.string().min(1).max(20) })
    .nullable(),
  coverage: z.enum(CPOE_COVERAGES),
  priority: z.enum(CPOE_PRIORITIES),
  /** Tarif RS (rupiah utuh, string); null = belum ada tarif. */
  tariff: rupiah.nullable(),
  /** Alasan override CDS yang tercatat (wajib bila CDS memblokir). */
  override: z.string().trim().min(10).max(500).nullable(),
  /** Unit penerima: `lab`, `radiologi`, `farmasi`, `tindakan`, `kontrol`. */
  dest: z.enum(['lab', 'radiologi', 'farmasi', 'tindakan', 'kontrol']),
});
export type OrderLine = z.infer<typeof orderLineSchema>;

export const orderEventSchema = z.discriminatedUnion('type', [
  z.strictObject({
    /** Order CPOE ditandatangani (TTE) dan dikirim ke unit penerima. */
    type: z.literal('order.ditandatangani'),
    encounterId: z.string().min(1).max(60),
    patientId: z.string().min(1).max(60),
    /** RM pasien (penunjang menampilkan identitas tanpa membaca fixture klinis). */
    rm: z.string().regex(/^\d{2}-\d{2}-\d{2}-\d{2}$/),
    patientName: z.string().min(1).max(80),
    setting: z.enum(['rawat-jalan', 'igd']),
    /** Penjamin pasien saat order (BPJS / Umum / Asuransi …). */
    payer: z.string().min(1).max(40),
    /** Jam tanda tangan (ISO, jam kunjungan server). */
    signedAt: z.iso.datetime({ offset: true }),
    lines: z.array(orderLineSchema).min(1).max(40),
  }),
]);
export type OrderEvent = z.infer<typeof orderEventSchema>;

export interface SentOrderBatch {
  seq: number;
  encounterId: string;
  signedAt: string;
  by: string;
  byId: string;
  lines: OrderLine[];
}

export interface OrderState {
  batches: readonly SentOrderBatch[];
}

export const orderDomain = defineDomain<OrderState, OrderEvent>('klinis-order', {
  initial: () => ({ batches: [] }),
  eventSchema: orderEventSchema,
  screens: ['order', 'poli', 'igd'],
  validate: (s, ev) =>
    ev.lines.some((l) => s.batches.some((b) => b.lines.some((x) => x.lineId === l.lineId)))
      ? 'Order ini sudah dikirim.'
      : null,
  reduce: (s, ev) => {
    const d = ev.data;
    return {
      batches: [
        ...s.batches,
        {
          seq: ev.seq,
          encounterId: d.encounterId,
          signedAt: d.signedAt,
          by: ev.actor.name,
          byId: ev.actor.userId,
          lines: d.lines,
        },
      ],
    };
  },
});

/** Unit penerima per jenis order. */
export function orderDest(kind: CpoeOrder['kind']): OrderLine['dest'] {
  return kind === 'obat' ? 'farmasi' : kind;
}

export const sentLineId = (encounterId: string, seq: number, catalogId: string) =>
  `${encounterId}-o${seq}-${catalogId}`;

/** Batch terkirim kunjungan ini (urut waktu). */
export function batchesOf(s: OrderState, encounterId: string): SentOrderBatch[] {
  return s.batches.filter((b) => b.encounterId === encounterId);
}

/**
 * Konteks CPOE + order tersimpan: order yang ditandatangani tampil `terkirim` (terkunci). Begitu kunjungan punya
 * kiriman tersimpan, draf awal fixture tidak dimunculkan lagi (daftar draf sudah dipakai dokter saat mengirim).
 */
export function applySentOrders(ctx: CpoeContext, s: OrderState): CpoeContext {
  const batches = batchesOf(s, ctx.encounterId);
  if (batches.length === 0) return ctx;
  const sent: CpoeOrder[] = batches.flatMap((b) =>
    b.lines.map((l) => {
      const item = ctx.catalog.find((c) => c.id === l.catalogId);
      return {
        id: l.lineId,
        catalogId: l.catalogId,
        kind: l.kind,
        name: l.name,
        detail: l.detail,
        code: l.code,
        coverage: l.coverage,
        priority: l.priority,
        tariff: l.tariff,
        cds: {
          level: 'info' as const,
          rule: 'aman' as const,
          message: `Terkirim ${formatJam(b.signedAt)} · ${b.by}${item ? '' : ''}`,
        },
        status: 'terkirim' as const,
        override: l.override,
      };
    }),
  );
  return { ...ctx, orders: [...ctx.orders.filter((o) => o.status === 'terkirim'), ...sent] };
}

/** Kiriman terakhir untuk ringkasan "N order terkirim pukul …". */
export function lastSent(
  s: OrderState,
  encounterId: string,
): { count: number; at: string; by: string } | null {
  const b = batchesOf(s, encounterId).at(-1);
  return b ? { count: b.lines.length, at: formatJam(b.signedAt), by: b.by } : null;
}
