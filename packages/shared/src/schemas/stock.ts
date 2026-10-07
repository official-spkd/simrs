import { z } from 'zod';
import { KFA_PATTERN, STOCK_LOCATION_KINDS, STOCK_MOVEMENT_KINDS, STOCK_TRANSFER_STAGES } from './penunjang-api';

/**
 * S05 · Kontrak baca API stok depo (fase 4 potongan 4.6a, B01 minimal). Masukan (penerimaan, mutasi, penyesuaian) dan
 * `stockBalanceSchema` ada di `penunjang-api.ts` (4.0a); berkas ini menambah bentuk jawaban daftar, kartu stok, dan
 * dokumen stok yang dibaca layar Depo mode api. Uang = rupiah bigint sebagai string digit.
 */

const uuid = z.uuid();
const instant = z.iso.datetime({ offset: true });
const isoDate = z.iso.date();
const person = z.strictObject({ userId: uuid, nama: z.string() });
const rupiah = z.string().regex(/^\d{1,18}$/);

/** `GET /api/v1/stock/locations`: depo/gudang yang boleh dibuka sesi ini (lingkup `unit` = unit penugasan). */
export const stockLocationViewSchema = z.strictObject({
  id: uuid,
  code: z.string(),
  name: z.string(),
  kind: z.enum(STOCK_LOCATION_KINDS),
  unit: z.strictObject({ id: uuid, name: z.string() }),
});
export type StockLocationView = z.infer<typeof stockLocationViewSchema>;

/** `GET /api/v1/stock/suppliers`: pemasok aktif (penerimaan barang). */
export const supplierViewSchema = z.strictObject({ id: uuid, code: z.string(), name: z.string() });
export type SupplierView = z.infer<typeof supplierViewSchema>;

/** `GET /api/v1/stock/drugs?q=`: obat formularium aktif untuk penerimaan barang. */
export const stockDrugQuerySchema = z.strictObject({ q: z.string().trim().max(80).default('') });
export const stockDrugViewSchema = z.strictObject({
  id: uuid,
  name: z.string(),
  kfa: z.string().regex(KFA_PATTERN).nullable(),
  highAlert: z.boolean(),
});
export type StockDrugView = z.infer<typeof stockDrugViewSchema>;

/** `GET /api/v1/stock/balances?stockLocationId=` (atau semua lokasi yang boleh dibuka); `expiring=1` = ED dekat/lewat. */
export const stockBalanceQuerySchema = z.strictObject({
  stockLocationId: uuid.optional(),
  expiring: z.enum(['0', '1']).default('0'),
});
export type StockBalanceQuery = z.infer<typeof stockBalanceQuerySchema>;

/** `GET /api/v1/stock/movements?stockLocationId=&stockBatchId=`: kartu stok (ledger), terbaru dulu. */
export const stockMovementQuerySchema = z.strictObject({
  stockLocationId: uuid,
  stockBatchId: uuid.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
export type StockMovementQuery = z.infer<typeof stockMovementQuerySchema>;

export const stockMovementViewSchema = z.strictObject({
  id: uuid,
  at: instant,
  kind: z.enum(STOCK_MOVEMENT_KINDS),
  /** Bertanda: masuk positif, keluar negatif. */
  quantity: z.int(),
  stockLocationId: uuid,
  stockBatchId: uuid,
  drugName: z.string(),
  batchNo: z.string(),
  /** Nomor dokumen rujukan (TRM-…, MUT-…), null bila tanpa nomor (penyesuaian, dispensing). */
  refNo: z.string().nullable(),
  refType: z.string(),
  reason: z.string().nullable(),
  by: person,
});
export type StockMovementView = z.infer<typeof stockMovementViewSchema>;

const docItem = z.strictObject({
  stockBatchId: uuid,
  drugId: uuid,
  drugName: z.string(),
  batchNo: z.string(),
  expiryDate: isoDate,
  quantity: z.int(),
});

/** Jawaban `POST /api/v1/stock/receipts`. */
export const stockReceiptViewSchema = z.strictObject({
  id: uuid,
  receiptNo: z.string(),
  stockLocationId: uuid,
  supplier: supplierViewSchema,
  invoiceNo: z.string(),
  receivedAt: instant,
  receivedBy: person,
  items: z.array(docItem.extend({ unitCost: rupiah })),
});
export type StockReceiptView = z.infer<typeof stockReceiptViewSchema>;

/** `GET /api/v1/stock/transfers?status=`, `POST /stock/transfers`, `POST /stock/transfers/:id/receive`. */
export const stockTransferQuerySchema = z.strictObject({ status: z.enum(STOCK_TRANSFER_STAGES).optional() });
export const stockTransferViewSchema = z.strictObject({
  id: uuid,
  transferNo: z.string(),
  status: z.enum(STOCK_TRANSFER_STAGES),
  from: z.strictObject({ id: uuid, name: z.string() }),
  to: z.strictObject({ id: uuid, name: z.string() }),
  items: z.array(docItem),
  sentAt: instant,
  sentBy: person,
  receivedAt: instant.nullable(),
  receivedBy: person.nullable(),
  /** Sesi ini boleh menerima (lingkup atas depo tujuan dan izin `stock.transfer`). */
  canReceive: z.boolean(),
});
export type StockTransferView = z.infer<typeof stockTransferViewSchema>;

/** Jawaban `POST /api/v1/stock/adjustments`. */
export const stockAdjustmentViewSchema = z.strictObject({
  id: uuid,
  stockLocationId: uuid,
  reason: z.string(),
  adjustedAt: instant,
  adjustedBy: person,
  items: z.array(docItem),
});
export type StockAdjustmentView = z.infer<typeof stockAdjustmentViewSchema>;
