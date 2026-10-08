import { z } from 'zod';
import { clinicalAuthorSchema } from './klinis';
import { medicationRequestViewSchema } from './orders';
import { PHARMACY_CDS_KINDS, PHARMACY_CDS_LEVELS } from './penunjang';
import {
  CDS_DECISIONS,
  type pharmacistInterventionInputSchema,
  type prescriptionAcceptInputSchema,
  INTERVENTION_KINDS,
  INTERVENTION_RESPONSES,
  PHARMACY_SETTINGS,
  PRESCRIPTION_STATUSES,
  REVIEW_DECISIONS,
} from './penunjang-api';

/**
 * S04 · Kontrak jawaban API farmasi klinis (fase 4 potongan 4.5): antrean masuk, resep farmasi dengan item (bentuk
 * `medicationRequestViewSchema` CPOE + stok depo dari ledger 4.6a), temuan CDS telaah + tindak lanjut, telaah tiga aspek,
 * dan intervensi apoteker. Masukan (terima, keputusan CDS, intervensi, telaah) ada di `penunjang-api.ts` (4.0a).
 */

export type PrescriptionAcceptInput = z.infer<typeof prescriptionAcceptInputSchema>;
export type PharmacistInterventionInput = z.infer<typeof pharmacistInterventionInputSchema>;

const uuid = z.uuid();
const instant = z.iso.datetime({ offset: true });
const person = z.strictObject({ userId: uuid, nama: z.string() });
const ENCOUNTER_CLASSES = ['AMB', 'EMER', 'IMP'] as const;

const patientRef = z.strictObject({ id: uuid, name: z.string(), mrn: z.string() });
const locationRef = z.strictObject({ id: uuid, name: z.string() });

/** `GET /api/v1/pharmacy/incoming`: kiriman CPOE ber-obat aktif yang belum diterima farmasi (lingkup depo unit). */
export const pharmacyIncomingSchema = z.strictObject({
  orderGroupId: uuid,
  encounter: z.strictObject({
    id: uuid,
    number: z.string(),
    class: z.enum(ENCOUNTER_CLASSES),
    unitName: z.string(),
  }),
  patient: patientRef,
  orderedAt: instant,
  orderedBy: clinicalAuthorSchema,
  /** Order residen yang belum ditinjau DPJP (resep belum ber-TTE). */
  needsReview: z.boolean(),
  items: z.array(medicationRequestViewSchema),
  /** Depo tujuan menurut kelas kunjungan (dalam lingkup sesi). */
  stockLocation: locationRef,
});
export type PharmacyIncoming = z.infer<typeof pharmacyIncomingSchema>;

export const PHARMACY_ALERT_STATUSES = ['terbuka', 'override', 'teratasi'] as const;

/**
 * Temuan CDS telaah. `status`: `terbuka` (belum ditindaklanjuti, atau diusulkan ke dokter dan belum dijawab),
 * `override` (dokter meng-override temuan blok di CPOE, belum ditinjau apoteker), `teratasi` (dikonfirmasi atau
 * di-override apoteker beralasan). `blocking` = menahan keputusan `setujui` (`CDS_UNRESOLVED`).
 */
export const pharmacyAlertViewSchema = z.strictObject({
  id: uuid,
  level: z.enum(PHARMACY_CDS_LEVELS),
  kind: z.enum(PHARMACY_CDS_KINDS),
  ruleCode: z.string(),
  title: z.string(),
  detail: z.string(),
  recommendation: z.string().nullable(),
  medicationRequestIds: z.array(uuid),
  prescriberOverride: z.boolean(),
  status: z.enum(PHARMACY_ALERT_STATUSES),
  decision: z
    .strictObject({ decision: z.enum(CDS_DECISIONS), reason: z.string().nullable(), by: person, at: instant })
    .nullable(),
  blocking: z.boolean(),
});
export type PharmacyAlertView = z.infer<typeof pharmacyAlertViewSchema>;

/** Item resep farmasi = baris obat CPOE + stok layak (tidak kedaluwarsa) di depo resep dari ledger. */
export const pharmacyItemViewSchema = medicationRequestViewSchema.extend({
  kfa: z.string().nullable(),
  fornas: z.boolean(),
  stock: z.strictObject({ usable: z.int().min(0), minQuantity: z.int().min(0).nullable() }),
});
export type PharmacyItemView = z.infer<typeof pharmacyItemViewSchema>;

export const pharmacyReviewViewSchema = z.strictObject({
  id: uuid,
  aspects: z.strictObject({ administratif: z.boolean(), farmasetik: z.boolean(), klinis: z.boolean() }),
  decision: z.enum(REVIEW_DECISIONS),
  reason: z.string().nullable(),
  medicationRequestIds: z.array(uuid),
  by: person,
  at: instant,
});

export const pharmacyInterventionViewSchema = z.strictObject({
  id: uuid,
  kind: z.enum(INTERVENTION_KINDS),
  medicationRequestIds: z.array(uuid),
  recommendation: z.string(),
  prescriber: person,
  by: person,
  at: instant,
  response: z
    .strictObject({
      response: z.enum(INTERVENTION_RESPONSES),
      note: z.string().nullable(),
      by: person,
      at: instant,
    })
    .nullable(),
});
export type PharmacyInterventionView = z.infer<typeof pharmacyInterventionViewSchema>;

/** `GET /api/v1/pharmacy/prescriptions/:id` (dan setiap jawaban tulis): resep farmasi lengkap untuk telaah. */
export const pharmacyPrescriptionViewSchema = z.strictObject({
  id: uuid,
  prescriptionNo: z.string().regex(/^R-\d{4}-\d{4}$/),
  orderGroupId: uuid,
  status: z.enum(PRESCRIPTION_STATUSES),
  setting: z.enum(PHARMACY_SETTINGS),
  stockLocation: locationRef,
  encounter: z.strictObject({
    id: uuid,
    number: z.string(),
    class: z.enum(ENCOUNTER_CLASSES),
    unitName: z.string(),
  }),
  patient: patientRef,
  allergies: z.array(z.string()),
  egfr: z.number().nullable(),
  prescriber: clinicalAuthorSchema,
  orderedAt: instant,
  acceptedBy: person,
  acceptedAt: instant,
  needsReview: z.boolean(),
  items: z.array(pharmacyItemViewSchema),
  alerts: z.array(pharmacyAlertViewSchema),
  reviews: z.array(pharmacyReviewViewSchema),
  interventions: z.array(pharmacyInterventionViewSchema),
});
export type PharmacyPrescriptionView = z.infer<typeof pharmacyPrescriptionViewSchema>;

/** `GET /api/v1/pharmacy/prescriptions?status=`: antrean ringkas per status. */
export const pharmacyQueueQuerySchema = z.strictObject({ status: z.enum(PRESCRIPTION_STATUSES).optional() });
export const pharmacyQueueRowSchema = z.strictObject({
  id: uuid,
  prescriptionNo: z.string(),
  status: z.enum(PRESCRIPTION_STATUSES),
  setting: z.enum(PHARMACY_SETTINGS),
  stockLocation: locationRef,
  patient: patientRef,
  encounterNumber: z.string(),
  prescriber: z.string(),
  acceptedAt: instant,
  items: z.int().min(0),
  highAlert: z.boolean(),
  /** Temuan CDS yang masih menahan telaah. */
  blockingAlerts: z.int().min(0),
});
export type PharmacyQueueRow = z.infer<typeof pharmacyQueueRowSchema>;

/**
 * `POST /api/v1/pharmacy/interventions/:id/response`: jawaban dokter penulis atas usulan apoteker (sekali). Perubahan
 * order tetap dilakukan dokter di CPOE; `ditolak` wajib beralasan.
 */
export const pharmacistInterventionResponseInputSchema = z
  .strictObject({
    response: z.enum(INTERVENTION_RESPONSES),
    note: z.string().trim().max(500).nullable(),
  })
  .refine((v) => v.response !== 'ditolak' || (v.note ?? '').length >= 10, {
    path: ['note'],
    message: 'Menolak usulan apoteker wajib beralasan (minimal 10 karakter).',
  });
export type PharmacistInterventionResponseInput = z.infer<typeof pharmacistInterventionResponseInputSchema>;
