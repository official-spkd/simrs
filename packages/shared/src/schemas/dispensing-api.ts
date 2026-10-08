import { z } from 'zod';
import { MEDICATION_FREQUENCY_CODES } from '../clinical/emar';
import {
  type dispenseHandoverInputSchema,
  type dispenseReturnInputSchema,
  HANDOVER_RECEIVERS,
  RETURN_CONDITIONS,
} from './penunjang-api';

/**
 * S05 · Kontrak jawaban API dispensing (fase 4 potongan 4.6b): penyiapan FEFO dengan label dosis, cek ganda apoteker
 * kedua, serah terima, retur, dan resolusi label untuk eMAR (F3-5). Masukan (`dispensePrepareInputSchema`,
 * `dispenseHandoverInputSchema`, `dispenseReturnInputSchema`) ada di `penunjang-api.ts` (4.0a).
 */

const uuid = z.uuid();
const instant = z.iso.datetime({ offset: true });
const isoDate = z.iso.date();
const person = z.strictObject({ userId: uuid, nama: z.string() });

export type DispenseHandoverInput = z.infer<typeof dispenseHandoverInputSchema>;
export type DispenseReturnInput = z.infer<typeof dispenseReturnInputSchema>;

/** Label dosis farmasi: `OBT-` + 12 karakter heksadesimal huruf besar (unik per RS). */
export const DISPENSE_LABEL_PATTERN = /^OBT-[0-9A-F]{12}$/;

export const dispenseItemViewSchema = z.strictObject({
  id: uuid,
  medicationRequestId: uuid,
  drugName: z.string(),
  stockBatchId: uuid,
  batchNo: z.string(),
  expiryDate: isoDate,
  quantity: z.int().positive(),
  labelBarcode: z.string().regex(DISPENSE_LABEL_PATTERN),
  fefoOverrideReason: z.string().nullable(),
  highAlert: z.boolean(),
  /** Jumlah yang sudah diretur (layak + tidak layak). */
  returned: z.int().min(0),
});
export type DispenseItemView = z.infer<typeof dispenseItemViewSchema>;

export const dispenseReturnViewSchema = z.strictObject({
  id: uuid,
  dispenseItemId: uuid,
  quantity: z.int().positive(),
  condition: z.enum(RETURN_CONDITIONS),
  reason: z.string(),
  /** Layak: kembali ke saldo depo (ledger `return`); tidak layak: dicatat tanpa saldo masuk. */
  restocked: z.boolean(),
  by: person,
  at: instant,
});
export type DispenseReturnView = z.infer<typeof dispenseReturnViewSchema>;

/** Satu penyiapan obat (`dispenses`) untuk resep farmasi; tahap = `disiapkan` → (cek ganda) → `diserahkan`. */
export const dispenseViewSchema = z.strictObject({
  id: uuid,
  pharmacyPrescriptionId: uuid,
  prescriptionNo: z.string(),
  stockLocation: z.strictObject({ id: uuid, name: z.string() }),
  patient: z.strictObject({ id: uuid, name: z.string(), mrn: z.string() }),
  encounter: z.strictObject({ id: uuid, number: z.string() }),
  preparedBy: person,
  preparedAt: instant,
  hasHighAlert: z.boolean(),
  doubleCheck: z.strictObject({ by: person, at: instant }).nullable(),
  handover: z
    .strictObject({
      by: person,
      at: instant,
      receiverKind: z.enum(HANDOVER_RECEIVERS),
      receiverName: z.string(),
      counselingGiven: z.boolean(),
    })
    .nullable(),
  items: z.array(dispenseItemViewSchema),
  returns: z.array(dispenseReturnViewSchema),
});
export type DispenseView = z.infer<typeof dispenseViewSchema>;

/**
 * `GET /api/v1/dispensing/labels/:barcode` (dan `DispensingService.resolveLabel`, F3-5): data etiket untuk eMAR dan
 * cetak ulang. Label hanya sah untuk dosis order yang sama dan setelah obat diserahkan.
 */
export const dispenseLabelViewSchema = z.strictObject({
  barcode: z.string().regex(DISPENSE_LABEL_PATTERN),
  dispenseItemId: uuid,
  dispenseId: uuid,
  prescriptionNo: z.string(),
  medicationRequestId: uuid,
  encounterId: uuid,
  patient: z.strictObject({ id: uuid, name: z.string(), mrn: z.string() }),
  drugName: z.string(),
  dose: z.string(),
  route: z.string(),
  frequency: z.enum(MEDICATION_FREQUENCY_CODES),
  instructions: z.string().nullable(),
  batchNo: z.string(),
  expiryDate: isoDate,
  quantity: z.int().positive(),
  highAlert: z.boolean(),
  preparedAt: instant,
  handedOver: z.boolean(),
});
export type DispenseLabelView = z.infer<typeof dispenseLabelViewSchema>;
