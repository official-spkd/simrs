import { z } from 'zod';
import { MEDICATION_FREQUENCY_CODES } from '../clinical/emar';
import {
  CDS_ALERT_DECISIONS,
  CPOE_CDS_LEVELS,
  CPOE_CDS_RULES,
  CPOE_ORDER_KINDS,
  CPOE_PRIORITIES,
  cdsAlertSchema,
  clinicalAuthorSchema,
  cpoeCdsFindingSchema,
  cpoeCodeSchema,
} from './klinis';

/**
 * K09 · Kontrak respons API CPOE + CDS (potongan 3.4). Masukan (`orderSubmitInputSchema`, `orderCancelInputSchema`)
 * ada di `schemas/klinis.ts` (potongan 3.0a); berkas ini menambah bentuk jawaban `/orders/*` dan `/cds/*`. ID selalu
 * UUID, waktu ISO 8601, penulis dari sesi server, tarif tidak pernah dikirim sampai master tarif U01 (fase 5).
 */

const uuid = z.uuid();
const instant = z.iso.datetime({ offset: true });
const nonEmpty = z.string().min(1);

/** Satu temuan CDS beserta kode aturan KB (`bawaan:*` untuk aturan bawaan mesin). */
export const cdsFindingViewSchema = z.strictObject({
  level: z.enum(CPOE_CDS_LEVELS),
  rule: z.enum(CPOE_CDS_RULES),
  ruleCode: z.string().min(1).max(80),
  message: nonEmpty,
});
export type CdsFindingView = z.infer<typeof cdsFindingViewSchema>;

/** Hasil CDS satu baris kiriman (urutan sama dengan `items` masukan). */
export const orderLineEvaluationSchema = z.strictObject({
  index: z.int().min(0),
  name: nonEmpty,
  /** Semua temuan, paling berat dulu (yang dicatat ke `cds_alerts` saat dikirim). */
  findings: z.array(cdsFindingViewSchema),
  /** Temuan teratas untuk tampilan (atau info "aman"). */
  top: cpoeCdsFindingSchema,
  /** Masih diblokir: ada temuan `block` dan alasan override belum sah. */
  blocked: z.boolean(),
  /** Temuan `block` di-override dengan alasan sah. */
  overridden: z.boolean(),
});
export type OrderLineEvaluation = z.infer<typeof orderLineEvaluationSchema>;

/** `POST /orders/evaluate`: pratinjau CDS server tanpa menyimpan apa pun. */
export const orderEvaluationSchema = z.strictObject({
  encounterId: uuid,
  lines: z.array(orderLineEvaluationSchema),
  blocked: z.boolean(),
});
export type OrderEvaluation = z.infer<typeof orderEvaluationSchema>;

export const ORDER_STATUSES = ['aktif', 'dibatalkan', 'selesai'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const serviceRequestViewSchema = z.strictObject({
  id: uuid,
  orderableId: uuid,
  kind: z.enum(CPOE_ORDER_KINDS),
  name: nonEmpty,
  code: cpoeCodeSchema.nullable(),
  priority: z.enum(CPOE_PRIORITIES),
  instructions: z.string().nullable(),
  status: z.enum(ORDER_STATUSES),
  /** Alasan pembatalan bila `dibatalkan`. */
  statusReason: z.string().nullable(),
});
export type ServiceRequestView = z.infer<typeof serviceRequestViewSchema>;

export const medicationRequestViewSchema = z.strictObject({
  id: uuid,
  drugId: uuid.nullable(),
  /** Racikan (komponen di `compound`), null untuk obat tunggal. */
  compound: z
    .strictObject({
      name: nonEmpty,
      dosageForm: nonEmpty,
      quantity: z.int().min(1),
      components: z.array(z.strictObject({ drugId: uuid, name: nonEmpty, amount: nonEmpty })),
    })
    .nullable(),
  name: nonEmpty,
  code: cpoeCodeSchema.nullable(),
  dose: nonEmpty,
  route: nonEmpty,
  frequency: z.enum(MEDICATION_FREQUENCY_CODES),
  customTimes: z.array(z.string()),
  durationDays: z.int().nullable(),
  instructions: z.string().nullable(),
  highAlert: z.boolean(),
  status: z.enum(ORDER_STATUSES),
  statusReason: z.string().nullable(),
});
export type MedicationRequestView = z.infer<typeof medicationRequestViewSchema>;

/** Resep (PDF klinis, ADR-0029): dokumen + permintaan TTE (null bila penulis belum berwenang TTE, mis. residen). */
export const prescriptionViewSchema = z.strictObject({
  documentId: uuid,
  signatureId: uuid.nullable(),
  /** `pending` | `signed` | `failed`, atau null bila belum dimintakan TTE. */
  signatureStatus: z.enum(['pending', 'signed', 'failed']).nullable(),
});
export type PrescriptionView = z.infer<typeof prescriptionViewSchema>;

/** Satu kiriman order (`order_groups`) dengan isi beku, status terkini, temuan CDS, dan resep. */
export const orderGroupSchema = z.strictObject({
  id: uuid,
  encounterId: uuid,
  patientId: uuid,
  orderSetId: uuid.nullable(),
  orderedAt: instant,
  orderedBy: clinicalAuthorSchema,
  /** Order residen yang BELUM ditinjau DPJP (keputusan fase 3 no. 4); false setelah atestasi `review_order`. */
  needsReview: z.boolean(),
  /** Tinjauan DPJP atas order residen (`POST /orders/:id/review`), null bila belum/tidak perlu. */
  review: z.strictObject({ by: clinicalAuthorSchema, at: instant }).nullable(),
  serviceRequests: z.array(serviceRequestViewSchema),
  medicationRequests: z.array(medicationRequestViewSchema),
  cdsAlerts: z.array(cdsAlertSchema),
  prescription: prescriptionViewSchema.nullable(),
});
export type OrderGroup = z.infer<typeof orderGroupSchema>;

/** `GET /orders/order-sets`: order set institusi aktif beserta isinya. */
export const orderSetViewSchema = z.strictObject({
  id: uuid,
  code: nonEmpty,
  name: nonEmpty,
  description: z.string(),
  items: z.array(
    z.strictObject({ type: z.enum(['layanan', 'obat']), id: uuid, name: nonEmpty, active: z.boolean() }),
  ),
});
export type OrderSetView = z.infer<typeof orderSetViewSchema>;

/** `POST /orders/order-sets` (`order.manage`): order set institusi baru. */
export const orderSetCreateInputSchema = z.strictObject({
  code: z.string().regex(/^[a-z0-9][a-z0-9-]{2,60}$/, 'Kode: huruf kecil, angka, strip (3–61 karakter)'),
  name: z.string().trim().min(3).max(120),
  description: z.string().trim().max(500).default(''),
  items: z
    .array(z.union([z.strictObject({ orderableId: uuid }), z.strictObject({ drugId: uuid })]))
    .min(1)
    .max(40),
});
export type OrderSetCreateInput = z.infer<typeof orderSetCreateInputSchema>;

/** Satu baris laporan tinjauan override CDS (auditor mutu, `order.read` lingkup seluruh RS). */
export const cdsOverrideReportItemSchema = z.strictObject({
  id: uuid,
  encounterId: uuid,
  patientId: uuid,
  mrn: nonEmpty,
  orderGroupId: uuid.nullable(),
  ruleCode: z.string().min(1).max(80),
  ruleVersion: z.int().nullable(),
  level: z.enum(CPOE_CDS_LEVELS),
  rule: z.enum(CPOE_CDS_RULES),
  message: nonEmpty,
  decision: z.enum(CDS_ALERT_DECISIONS),
  overrideReason: z.string().nullable(),
  decidedBy: clinicalAuthorSchema,
  decidedAt: instant,
});
export type CdsOverrideReportItem = z.infer<typeof cdsOverrideReportItemSchema>;

export const cdsOverrideReportSchema = z.strictObject({
  items: z.array(cdsOverrideReportItemSchema),
  /** Kursor halaman berikutnya (opak), null bila habis. */
  nextCursor: z.string().nullable(),
});
export type CdsOverrideReport = z.infer<typeof cdsOverrideReportSchema>;

/** `GET /cds/overrides`: rentang waktu keputusan (bawaan 30 hari terakhir) + keputusan yang dilaporkan. */
export const cdsOverrideQuerySchema = z.strictObject({
  from: instant.optional(),
  to: instant.optional(),
  decision: z.enum(['override', 'diblokir']).default('override'),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type CdsOverrideQuery = z.infer<typeof cdsOverrideQuerySchema>;

/** `GET /orders/catalog`: pencarian katalog (nama/kata kunci), opsional per jenis. */
export const orderCatalogQuerySchema = z.strictObject({
  q: z.string().trim().max(80).default(''),
  kind: z.enum(CPOE_ORDER_KINDS).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type OrderCatalogQuery = z.infer<typeof orderCatalogQuerySchema>;
