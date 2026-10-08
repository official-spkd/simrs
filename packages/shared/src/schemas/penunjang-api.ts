import { z } from 'zod';
import { patientBannerSchema } from './clinical-records';
import { clinicalEntryMetaSchema, SAFETY_REASON_MIN } from './klinis';
import { LAB_FLAGS, labRangeSchema, RAD_MODALITIES, SUPPORT_PRIORITIES } from './penunjang';

/**
 * S01–S10 · Kontrak API penunjang (fase 4, rencana §4.0a): token status yang sama dengan CHECK database (4.0b),
 * skema masukan (body) per aksi, dan rekaman jawaban API. Kontrak layar mode presentasi tetap di `penunjang.ts`
 * (ID slug, `elapsedSeconds`) sampai fondasi web 4.0c memindahkan fixture ke UUID; layar mode api memakai skema di
 * sini. Revisi dari kontrak demo: ID UUID; timer nilai kritis = `raisedAt` + `serverNow` (jam server); penerima nilai
 * kritis = staf terpilih ATAU nama + peran. Penulis, waktu catat, flag, delta, dan status kritis selalu dari server.
 */

const uuid = z.uuid();
const instant = z.iso.datetime({ offset: true });
const isoDate = z.iso.date();
const text = (min: number, max: number) => z.string().trim().min(min).max(max);
const reason = z.string().trim().min(SAFETY_REASON_MIN).max(500);
const optionalNote = z.string().trim().max(500).nullable();
/** Rupiah bulat tak bertanda sebagai string (bigint tidak didukung JSON). */
const rupiahString = z.string().regex(/^\d{1,18}$/);

/** Kode LOINC (mis. `2823-3`). */
export const LOINC_PATTERN = /^\d{1,7}-\d$/;
/** Kode prosedur ICD-9-CM (mis. `87.03`, `47.0`). */
export const ICD9CM_PATTERN = /^\d{2}(\.\d{1,2})?$/;
/** Kode KFA obat (8 digit). */
export const KFA_PATTERN = /^\d{8}$/;

/** Waktu server saat jawaban dibentuk: timer layar dihitung dari sini, bukan jam klien. */
export const serverTimeSchema = z.strictObject({ serverNow: instant });

/** Pasien di layar penunjang: banner dua pengenal + alergi (data klinis minimal, keputusan fase 4 no. 3). */
export const supportPatientApiSchema = z.strictObject({
  banner: patientBannerSchema,
  allergies: z.array(z.string()),
  /** eGFR terhitung terakhir (mL/menit/1,73 m²) bila relevan (farmasi, radiologi kontras). */
  egfr: z.number().positive().nullable(),
  weightKg: z.number().positive().nullable(),
});
export type SupportPatientApi = z.infer<typeof supportPatientApiSchema>;

/** Rujukan order fase 3 (`service_requests`) yang dikerjakan unit penunjang (F3-1). */
export const supportOrderRefSchema = z.strictObject({
  serviceRequestId: uuid,
  orderGroupId: uuid,
  encounterId: uuid,
  code: z.string().nullable(),
  name: z.string().min(1),
  priority: z.enum(SUPPORT_PRIORITIES),
  orderedAt: instant,
  orderedBy: z.string().min(1),
  indication: z.string().nullable(),
});
export type SupportOrderRef = z.infer<typeof supportOrderRefSchema>;

// ═════════════════════════════ S01 · Laboratorium ═════════════════════════════

export const LAB_RESULT_TYPES = ['numeric', 'text'] as const;
export const LAB_SEXES = ['male', 'female', 'any'] as const;
/** Status order lab (DB `lab_orders.status`): diterima unit → spesimen → hasil → validasi teknis → selesai (rilis). */
export const LAB_ORDER_STATUSES = [
  'diterima',
  'sampel',
  'proses',
  'hasil',
  'validasi_teknis',
  'selesai',
  'batal',
] as const;
export type LabOrderStatus = (typeof LAB_ORDER_STATUSES)[number];
export const SPECIMEN_STATUSES = ['menunggu', 'diambil', 'diterima', 'ditolak'] as const;
export type SpecimenStatus = (typeof SPECIMEN_STATUSES)[number];
export const SPECIMEN_REJECT_REASONS = [
  'hemolisis',
  'volume_kurang',
  'label_tidak_sesuai',
  'beku',
  'wadah_salah',
  'terlambat',
  'lainnya',
] as const;
export const LAB_RESULT_SOURCES = ['manual', 'analyzer'] as const;
/** Hasil analyzer selalu `preliminary` sampai divalidasi manusia (keputusan fase 4 no. 5). */
export const LAB_RESULT_STATUSES = ['preliminary', 'final', 'entered_in_error'] as const;
export const LAB_VALIDATION_LEVELS = ['teknis', 'klinis'] as const;
export type LabValidationLevel = (typeof LAB_VALIDATION_LEVELS)[number];
export const WESTGARD_RULES = ['1-2s', '1-3s', '2-2s', 'R-4s', '4-1s', '10x'] as const;
export type WestgardRule = (typeof WESTGARD_RULES)[number];
export const QC_OUTCOMES = ['ok', 'warn', 'reject'] as const;
export type QcOutcome = (typeof QC_OUTCOMES)[number];

export const labTestDefinitionSchema = z.strictObject({
  id: uuid,
  code: z.string().min(1),
  loinc: z.string().regex(LOINC_PATTERN).nullable(),
  name: z.string().min(1),
  specimenType: z.string().min(1),
  unit: z.string(),
  decimals: z.int().min(0).max(3),
  resultType: z.enum(LAB_RESULT_TYPES),
  panelCode: z.string().nullable(),
  analyzerCode: z.string().nullable(),
  deltaLimit: z.number().positive().nullable(),
  active: z.boolean(),
});
export type LabTestDefinition = z.infer<typeof labTestDefinitionSchema>;

/** Rentang rujukan + batas kritis per jenis kelamin × rentang umur (hari). `ageMaxDays` eksklusif; null = tanpa batas. */
export const labReferenceRangeSchema = z.strictObject({
  testDefinitionId: uuid,
  sex: z.enum(LAB_SEXES),
  ageMinDays: z.int().min(0),
  ageMaxDays: z.int().min(1).nullable(),
  ref: labRangeSchema,
  critical: labRangeSchema,
});
export type LabReferenceRange = z.infer<typeof labReferenceRangeSchema>;

/** `POST /api/v1/lab/orders` (Idempotency-Key): unit lab menerima order → nomor lab + spesimen + label. */
export const labOrderAcceptInputSchema = z.strictObject({
  serviceRequestIds: z.array(uuid).min(1).max(50),
});
export type LabOrderAcceptInput = z.infer<typeof labOrderAcceptInputSchema>;

export const specimenCollectInputSchema = z.strictObject({ occurredAt: instant });
export const specimenRejectInputSchema = z
  .strictObject({ reason: z.enum(SPECIMEN_REJECT_REASONS), note: optionalNote })
  .refine((v) => v.reason !== 'lainnya' || (v.note ?? '').length >= SAFETY_REASON_MIN, {
    path: ['note'],
    message: `Alasan "lainnya" wajib dijelaskan (minimal ${SAFETY_REASON_MIN} karakter).`,
  });
export type SpecimenRejectInput = z.infer<typeof specimenRejectInputSchema>;

/** `POST /api/v1/lab/orders/:id/results`: input manual. Flag, delta, kritis dihitung server. */
export const labResultInputSchema = z.strictObject({
  items: z
    .array(
      z
        .strictObject({
          testDefinitionId: uuid,
          valueNumeric: z.number().finite().nullable(),
          valueText: text(1, 200).nullable(),
          comment: optionalNote,
        })
        .refine((v) => (v.valueNumeric === null) !== (v.valueText === null), {
          path: ['valueNumeric'],
          message: 'Isi nilai angka ATAU teks hasil.',
        }),
    )
    .min(1)
    .max(100),
});
export type LabResultInput = z.infer<typeof labResultInputSchema>;

export const labResultRecordSchema = clinicalEntryMetaSchema.extend({
  labOrderId: uuid,
  testDefinitionId: uuid,
  loinc: z.string().nullable(),
  name: z.string().min(1),
  valueNumeric: z.number().nullable(),
  valueText: z.string().nullable(),
  unit: z.string(),
  decimals: z.int().min(0).max(3),
  /** Salinan rentang rujukan dan batas kritis yang berlaku saat hasil masuk. */
  ref: labRangeSchema.nullable(),
  critical: labRangeSchema.nullable(),
  flag: z.enum(LAB_FLAGS),
  delta: z.boolean(),
  deltaComparedResultId: uuid.nullable(),
  source: z.enum(LAB_RESULT_SOURCES),
  resultStatus: z.enum(LAB_RESULT_STATUSES),
  comment: z.string().nullable(),
});
export type LabResultRecord = z.infer<typeof labResultRecordSchema>;

/** `POST /api/v1/lab/orders/:id/validations`. QC ditolak hari itu hanya lolos dengan override beralasan. */
export const labValidationInputSchema = z.strictObject({
  level: z.enum(LAB_VALIDATION_LEVELS),
  qcOverrideReason: reason.nullable(),
});
export type LabValidationInput = z.infer<typeof labValidationInputSchema>;

/** `POST /api/v1/lab/results/:id/corrections`: versi baru beralasan (hasil rilis → "dikoreksi" + notifikasi DPJP). */
export const labResultCorrectionInputSchema = z
  .strictObject({
    valueNumeric: z.number().finite().nullable(),
    valueText: text(1, 200).nullable(),
    reason,
  })
  .refine((v) => (v.valueNumeric === null) !== (v.valueText === null), {
    path: ['valueNumeric'],
    message: 'Isi nilai angka ATAU teks hasil.',
  });
export type LabResultCorrectionInput = z.infer<typeof labResultCorrectionInputSchema>;

/** `POST /api/v1/lab/qc`: satu run kontrol; hasil Westgard dihitung server (`westgardEvaluate`). */
export const labQcRunInputSchema = z.strictObject({
  analyzerId: uuid.nullable(),
  testDefinitionId: uuid,
  controlLevel: z.int().min(1).max(3),
  value: z.number().finite(),
  mean: z.number().finite(),
  sd: z.number().positive(),
});
export type LabQcRunInput = z.infer<typeof labQcRunInputSchema>;

export const labQcRunSchema = labQcRunInputSchema.extend({
  id: uuid,
  outcome: z.enum(QC_OUTCOMES),
  violations: z.array(z.enum(WESTGARD_RULES)),
  runAt: instant,
  by: z.string().min(1),
});
export type LabQcRun = z.infer<typeof labQcRunSchema>;

export const specimenSchema = z.strictObject({
  id: uuid,
  barcode: z.string().min(1),
  specimenType: z.string().min(1),
  status: z.enum(SPECIMEN_STATUSES),
  collectedAt: instant.nullable(),
  receivedAt: instant.nullable(),
  rejectedReason: z.enum(SPECIMEN_REJECT_REASONS).nullable(),
});
export type Specimen = z.infer<typeof specimenSchema>;

export const labValidationSchema = z.strictObject({
  level: z.enum(LAB_VALIDATION_LEVELS),
  by: z.string().min(1),
  at: instant,
  /** TTE validasi klinis (null untuk teknis). */
  signatureStatus: z.enum(['pending', 'signed', 'failed']).nullable(),
});

/** Item worklist lab (`GET /api/v1/lab/worklist`): order fase 3 yang ditujukan ke unit lab + entitas kerjanya. */
export const labWorklistItemSchema = z.strictObject({
  /** Null selama order belum diterima unit lab. */
  labOrderId: uuid.nullable(),
  labNo: z.string().nullable(),
  status: z.enum(LAB_ORDER_STATUSES).nullable(),
  orders: z.array(supportOrderRefSchema).min(1),
  patient: patientBannerSchema,
  location: z.string(),
  priority: z.enum(SUPPORT_PRIORITIES),
  receivedAt: instant.nullable(),
  criticalOpen: z.boolean(),
});
export type LabWorklistItem = z.infer<typeof labWorklistItemSchema>;

export const labOrderDetailSchema = serverTimeSchema.extend({
  id: uuid,
  labNo: z.string(),
  status: z.enum(LAB_ORDER_STATUSES),
  priority: z.enum(SUPPORT_PRIORITIES),
  patient: supportPatientApiSchema,
  orders: z.array(supportOrderRefSchema).min(1),
  specimens: z.array(specimenSchema),
  results: z.array(labResultRecordSchema),
  /** Hingga 5 hasil final sebelumnya per LOINC dari kelompok rekam medis (lama → baru). */
  previous: z.record(z.string(), z.array(z.strictObject({ at: instant, valueNumeric: z.number() })).max(5)),
  validations: z.array(labValidationSchema),
  criticalResultIds: z.array(uuid),
});
export type LabOrderDetail = z.infer<typeof labOrderDetailSchema>;

// ═════════════════════════════ S09 · Nilai kritis ═════════════════════════════

/** `transfusion`: reaksi transfusi berat (4.9b, ADR-0106). */
export const CRITICAL_SOURCES = ['lab', 'radiology', 'transfusion'] as const;
export type CriticalSource = (typeof CRITICAL_SOURCES)[number];
/** Status hanya berubah lewat trigger saat laporan ber-read-back masuk (tidak ada endpoint penutupan lain). */
export const CRITICAL_STATUSES = ['terbuka', 'dilaporkan'] as const;
export type CriticalStatus = (typeof CRITICAL_STATUSES)[number];
export const CRITICAL_CHANNELS = ['telepon', 'langsung'] as const;
export const CRITICAL_RECIPIENT_NAME_MIN = 5;

/** Penerima laporan nilai kritis: staf aktif terpilih, ATAU nama + peran bila di luar daftar. */
export const criticalRecipientSchema = z.union([
  z.strictObject({ userId: uuid }),
  z.strictObject({
    name: z.string().trim().min(CRITICAL_RECIPIENT_NAME_MIN).max(120),
    role: z.string().trim().min(3).max(60),
  }),
]);
export type CriticalRecipient = z.infer<typeof criticalRecipientSchema>;

/**
 * `POST /api/v1/critical-results/:id/reports`. `readBackConfirmed` false atau penerima kosong → 422
 * `CRITICAL_READBACK_REQUIRED` / `CRITICAL_RECIPIENT_REQUIRED` (aturan `criticalReportBlock`; juga CHECK database).
 * Durasi dihitung server sejak hasil masuk, bukan dari klien.
 */
export const criticalReportInputSchema = z.strictObject({
  recipient: criticalRecipientSchema.nullable(),
  channel: z.enum(CRITICAL_CHANNELS),
  readBackText: z.string().trim().max(500),
  readBackConfirmed: z.boolean(),
});
export type CriticalReportInput = z.infer<typeof criticalReportInputSchema>;

export const criticalResultViewSchema = serverTimeSchema.extend({
  id: uuid,
  source: z.enum(CRITICAL_SOURCES),
  sourceId: uuid,
  encounterId: uuid,
  patient: patientBannerSchema,
  analyte: z.string().min(1),
  valueText: z.string().min(1),
  raisedAt: instant,
  limitMinutes: z.int().min(1),
  status: z.enum(CRITICAL_STATUSES),
  escalationLevel: z.int().min(0).max(3),
  report: z
    .strictObject({
      reportedAt: instant,
      minutesToReport: z.int().min(0),
      withinLimit: z.boolean(),
      recipient: z.strictObject({ userId: uuid.nullable(), name: z.string(), role: z.string() }),
      channel: z.enum(CRITICAL_CHANNELS),
      reportedBy: z.string().min(1),
    })
    .nullable(),
});
export type CriticalResultView = z.infer<typeof criticalResultViewSchema>;

export const criticalMetricsQuerySchema = z.strictObject({
  from: isoDate,
  to: isoDate,
  unitId: uuid.optional(),
});
export const criticalMetricsSchema = z.strictObject({
  from: isoDate,
  to: isoDate,
  total: z.int().min(0),
  reported: z.int().min(0),
  withinLimit: z.int().min(0),
  withinLimitPercent: z.number().min(0).max(100).nullable(),
  medianMinutes: z.number().min(0).nullable(),
  p90Minutes: z.number().min(0).nullable(),
  open: z.int().min(0),
});
export type CriticalMetrics = z.infer<typeof criticalMetricsSchema>;

// ═════════════════════════════ S03 · Radiologi ═════════════════════════════

/** Token modalitas huruf kecil untuk event; tampilan dan DB memakai `RAD_MODALITIES` (huruf besar). */
export const RAD_MODALITY_TOKENS = ['ct', 'dr', 'usg', 'mri', 'angio'] as const;
export function radModalityToken(m: (typeof RAD_MODALITIES)[number]): (typeof RAD_MODALITY_TOKENS)[number] {
  return m.toLowerCase() as (typeof RAD_MODALITY_TOKENS)[number];
}
export const IMAGING_STUDY_STATUSES = [
  'terjadwal',
  'berlangsung',
  'selesai',
  'ditandatangani',
  'batal',
] as const;
export type ImagingStudyStatus = (typeof IMAGING_STUDY_STATUSES)[number];
export const PREGNANCY_STATUSES = ['tidak_hamil', 'hamil', 'tidak_diketahui', 'tidak_berlaku'] as const;

/** `POST /api/v1/radiology/studies`: terima order + accession + slot modalitas (bentrok → 409 `SLOT_CONFLICT`). */
export const imagingStudyAcceptInputSchema = z.strictObject({
  serviceRequestId: uuid,
  modalityId: uuid,
  scheduledAt: instant,
});

/** Skrining kontras yang dicentang petugas; eGFR dibaca server dari hasil lab terbaru (`ResultsQueryService`). */
export const contrastScreeningSchema = z.strictObject({
  contrastAllergyAsked: z.boolean(),
  pregnancy: z.enum(PREGNANCY_STATUSES),
  fasting: z.boolean(),
});
export type ContrastScreening = z.infer<typeof contrastScreeningSchema>;

/** `POST /api/v1/radiology/studies/:id/start`. Override gerbang kontras hanya dokter, beralasan. */
export const imagingStartInputSchema = z.strictObject({
  identityConfirmed: z.boolean(),
  contrastScreening: contrastScreeningSchema.nullable(),
  overrideReason: reason.nullable(),
});
export type ImagingStartInput = z.infer<typeof imagingStartInputSchema>;

/** `POST /api/v1/radiology/studies/:id/complete`: CT wajib CTDIvol + DLP (juga CHECK database). */
export const imagingCompleteInputSchema = z.strictObject({
  ctdiVol: z.number().positive().max(200).nullable(),
  dlp: z.number().positive().max(5000).nullable(),
});
export type ImagingCompleteInput = z.infer<typeof imagingCompleteInputSchema>;

/** `POST /api/v1/radiology/studies/:id/reports`: ekspertise (draf boleh diubah; final = append-only, TTE). */
export const imagingReportInputSchema = z.strictObject({
  templateCode: z.string().max(40).nullable(),
  findings: text(20, 8000),
  impression: text(10, 2000),
  /** Temuan kritis → `CriticalResultsService.raise()`. */
  critical: z.boolean(),
  /** Addendum atas ekspertise ber-TTE (bukan menggantikan). */
  addendumOf: uuid.nullable(),
});
export type ImagingReportInput = z.infer<typeof imagingReportInputSchema>;

export const imagingStudyRecordSchema = z.strictObject({
  id: uuid,
  accession: z.string().regex(/^RAD-\d{4}-\d{4}$/),
  order: supportOrderRefSchema,
  patient: patientBannerSchema,
  modality: z.enum(RAD_MODALITIES),
  modalityId: uuid,
  room: z.string(),
  status: z.enum(IMAGING_STUDY_STATUSES),
  scheduledAt: instant,
  startedAt: instant.nullable(),
  completedAt: instant.nullable(),
  contrast: z.boolean(),
  dose: z.strictObject({ ctdiVol: z.number(), dlp: z.number() }).nullable(),
  /** Kosong sampai PACS (keputusan fase 4 no. 15). */
  studyInstanceUid: z.string().nullable(),
});
export type ImagingStudyRecord = z.infer<typeof imagingStudyRecordSchema>;

// ═════════════════════════════ S04/S05 · Farmasi, dispensing, stok ═════════════════════════════

export const PHARMACY_SETTINGS = ['rawat_jalan', 'rawat_inap', 'igd', 'ok'] as const;
export type PharmacySetting = (typeof PHARMACY_SETTINGS)[number];
/** Status resep farmasi (DB `pharmacy_prescriptions.status`). */
export const PRESCRIPTION_STATUSES = ['telaah', 'ditahan', 'penyiapan', 'serah', 'selesai', 'batal'] as const;
export type PrescriptionStatus = (typeof PRESCRIPTION_STATUSES)[number];
export const REVIEW_ASPECTS = ['administratif', 'farmasetik', 'klinis'] as const;
export const REVIEW_DECISIONS = ['setujui', 'tahan', 'sebagian'] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];
export const CDS_DECISIONS = ['konfirmasi', 'override', 'usul'] as const;
export const INTERVENTION_KINDS = ['ganti_obat', 'ubah_dosis', 'hentikan', 'tambah', 'lainnya'] as const;
export const INTERVENTION_RESPONSES = ['diterima', 'ditolak', 'diubah'] as const;
export const HANDOVER_RECEIVERS = ['pasien', 'keluarga', 'perawat'] as const;
export const RETURN_CONDITIONS = ['layak', 'tidak_layak'] as const;

/** `POST /api/v1/pharmacy/prescriptions`: terima satu kiriman resep CPOE (`order_groups`) → nomor R. */
export const prescriptionAcceptInputSchema = z.strictObject({ orderGroupId: uuid, stockLocationId: uuid });

/** `POST .../alerts/:alertId/decision`: konfirmasi, override beralasan (≥ `pharmacy.override_reason_min`), atau usul. */
export const cdsDecisionInputSchema = z
  .strictObject({ decision: z.enum(CDS_DECISIONS), reason: optionalNote })
  .refine((v) => v.decision !== 'override' || (v.reason ?? '').length >= SAFETY_REASON_MIN, {
    path: ['reason'],
    message: `Override wajib alasan klinis (minimal ${SAFETY_REASON_MIN} karakter).`,
  });
export type CdsDecisionInput = z.infer<typeof cdsDecisionInputSchema>;

/** `POST .../interventions`: usulan apoteker ke dokter penulis. Apoteker TIDAK mengubah resep (dokter di CPOE). */
export const pharmacistInterventionInputSchema = z.strictObject({
  kind: z.enum(INTERVENTION_KINDS),
  medicationRequestIds: z.array(uuid).min(1),
  recommendation: text(SAFETY_REASON_MIN, 1000),
});

/** `POST .../reviews`: telaah tiga aspek. `tahan`/`sebagian` wajib alasan; `setujui` diblokir CDS terbuka. */
export const prescriptionReviewInputSchema = z
  .strictObject({
    aspects: z.strictObject({ administratif: z.boolean(), farmasetik: z.boolean(), klinis: z.boolean() }),
    decision: z.enum(REVIEW_DECISIONS),
    reason: optionalNote,
    /** Item yang disetujui untuk keputusan `sebagian`. */
    medicationRequestIds: z.array(uuid),
  })
  .superRefine((v, ctx) => {
    if (v.decision !== 'setujui' && (v.reason ?? '').length < SAFETY_REASON_MIN) {
      ctx.addIssue({ code: 'custom', path: ['reason'], message: 'Tahan/sebagian wajib beralasan.' });
    }
    if (v.decision === 'setujui' && !(v.aspects.administratif && v.aspects.farmasetik && v.aspects.klinis)) {
      ctx.addIssue({ code: 'custom', path: ['aspects'], message: 'Tiga aspek telaah wajib dicentang.' });
    }
    if (v.decision === 'sebagian' && v.medicationRequestIds.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['medicationRequestIds'], message: 'Pilih item yang disetujui.' });
    }
  });
export type PrescriptionReviewInput = z.infer<typeof prescriptionReviewInputSchema>;

/** `POST /api/v1/dispensing/prescriptions/:id/prepare`: FEFO otomatis; batch lain wajib alasan. */
export const dispensePrepareInputSchema = z.strictObject({
  items: z
    .array(
      z
        .strictObject({
          medicationRequestId: uuid,
          quantity: z.int().positive().max(10_000),
          /** Null = FEFO otomatis (`pickFefo`). */
          stockBatchId: uuid.nullable(),
          fefoOverrideReason: optionalNote,
        })
        .refine((v) => v.stockBatchId === null || (v.fefoOverrideReason ?? '').length >= SAFETY_REASON_MIN, {
          path: ['fefoOverrideReason'],
          message: `Memilih batch di luar FEFO wajib beralasan (minimal ${SAFETY_REASON_MIN} karakter).`,
        }),
    )
    .min(1),
});
export type DispensePrepareInput = z.infer<typeof dispensePrepareInputSchema>;

/** `POST /api/v1/dispensing/dispenses/:id/handover`: penerima + nama + PIO. */
export const dispenseHandoverInputSchema = z.strictObject({
  receiverKind: z.enum(HANDOVER_RECEIVERS),
  receiverName: text(3, 120),
  counselingGiven: z.literal(true),
});

/** `POST /api/v1/dispensing/dispenses/:id/returns`: layak → kembali ke stok; tidak layak → hapus buku. */
export const dispenseReturnInputSchema = z.strictObject({
  items: z
    .array(
      z.strictObject({
        dispenseItemId: uuid,
        quantity: z.int().positive(),
        condition: z.enum(RETURN_CONDITIONS),
      }),
    )
    .min(1),
  reason,
});

export const STOCK_LOCATION_KINDS = ['depo', 'gudang', 'ruang', 'ok'] as const;
/** Jenis baris ledger stok (append-only). Qty bertanda: masuk positif, keluar negatif. */
export const STOCK_MOVEMENT_KINDS = [
  'receipt',
  'transfer_out',
  'transfer_in',
  'dispense',
  'return',
  'adjustment',
  'usage',
  'write_off',
] as const;
export type StockMovementKind = (typeof STOCK_MOVEMENT_KINDS)[number];
export const STOCK_TRANSFER_STAGES = ['dikirim', 'diterima'] as const;

/** `POST /api/v1/stock/receipts`: penerimaan tanpa PO (keputusan fase 4 no. 10). Harga pokok per satuan bigint. */
export const stockReceiptInputSchema = z.strictObject({
  stockLocationId: uuid,
  supplierId: uuid,
  invoiceNo: text(1, 60),
  items: z
    .array(
      z.strictObject({
        drugId: uuid,
        batchNo: text(1, 40),
        expiryDate: isoDate,
        quantity: z.int().positive().max(1_000_000),
        unitCost: rupiahString,
      }),
    )
    .min(1)
    .max(200),
});
export type StockReceiptInput = z.infer<typeof stockReceiptInputSchema>;

/** `POST /api/v1/stock/transfers` (langkah kirim); `POST .../:id/receive` langkah terima. */
export const stockTransferInputSchema = z
  .strictObject({
    fromStockLocationId: uuid,
    toStockLocationId: uuid,
    items: z.array(z.strictObject({ stockBatchId: uuid, quantity: z.int().positive() })).min(1),
  })
  .refine((v) => v.fromStockLocationId !== v.toStockLocationId, {
    path: ['toStockLocationId'],
    message: 'Depo tujuan harus berbeda dari depo asal.',
  });
export type StockTransferInput = z.infer<typeof stockTransferInputSchema>;

/** `POST /api/v1/stock/adjustments`: penyesuaian beralasan (qty bertanda, tidak nol). */
export const stockAdjustmentInputSchema = z.strictObject({
  stockLocationId: uuid,
  items: z
    .array(
      z.strictObject({
        stockBatchId: uuid,
        quantityDelta: z
          .int()
          .refine((v) => v !== 0, 'Selisih tidak boleh nol')
          .refine((v) => Math.abs(v) <= 1_000_000, 'Selisih terlalu besar'),
      }),
    )
    .min(1),
  reason,
});
export type StockAdjustmentInput = z.infer<typeof stockAdjustmentInputSchema>;

export const stockBalanceSchema = z.strictObject({
  stockLocationId: uuid,
  drugId: uuid,
  drugName: z.string(),
  kfa: z.string().regex(KFA_PATTERN).nullable(),
  stockBatchId: uuid,
  batchNo: z.string(),
  expiryDate: isoDate,
  quantity: z.int().min(0),
  expiringSoon: z.boolean(),
  expired: z.boolean(),
});
export type StockBalance = z.infer<typeof stockBalanceSchema>;

// ═════════════════════════════ S06 · Kamar operasi (token bersama event) ═════════════════════════════

export const SURGERY_PRIORITIES = ['elektif', 'cito'] as const;

// ═════════════════════════════ S07 · Gizi ═════════════════════════════

export const MEALS = ['pagi', 'selingan_pagi', 'siang', 'selingan_sore', 'malam'] as const;
export const DIET_TEXTURES = ['biasa', 'lunak', 'saring', 'cair', 'sonde'] as const;
export const MEAL_LEFTOVERS = ['habis', 'sisa_seperempat', 'sisa_setengah', 'utuh'] as const;

export const dietOrderInputSchema = z.strictObject({
  encounterId: uuid,
  dietTypeId: uuid,
  texture: z.enum(DIET_TEXTURES),
  /** Batasan/alergi makanan tambahan untuk dapur (bukan PHI di label). */
  notes: optionalNote,
  startsOn: isoDate,
});
export type DietOrderInput = z.infer<typeof dietOrderInputSchema>;

export const mealServiceInputSchema = z.strictObject({
  dietOrderId: uuid,
  meal: z.enum(MEALS),
  servedAt: instant,
  leftover: z.enum(MEAL_LEFTOVERS).nullable(),
});

// ═════════════════════════════ S08 · Bank darah ═════════════════════════════

export const ABO_GROUPS = ['A', 'B', 'AB', 'O'] as const;
export type AboGroup = (typeof ABO_GROUPS)[number];
export const RH_FACTORS = ['pos', 'neg'] as const;
export type RhFactor = (typeof RH_FACTORS)[number];
export const BLOOD_URGENCIES = ['rutin', 'cito', 'darurat'] as const;
export const BLOOD_UNIT_STATUSES = [
  'tersedia',
  'dicadangkan',
  'dikeluarkan',
  'kedaluwarsa',
  'dimusnahkan',
] as const;
export const CROSSMATCH_RESULTS = ['cocok', 'tidak_cocok'] as const;

export const bloodRequestInputSchema = z.strictObject({
  encounterId: uuid,
  componentCode: text(1, 20),
  units: z.int().min(1).max(20),
  urgency: z.enum(BLOOD_URGENCIES),
  indication: text(3, 500),
  patientAbo: z.enum(ABO_GROUPS).nullable(),
  patientRh: z.enum(RH_FACTORS).nullable(),
});
export type BloodRequestInput = z.infer<typeof bloodRequestInputSchema>;

export const crossmatchInputSchema = z.strictObject({
  bloodRequestId: uuid,
  bloodUnitId: uuid,
  result: z.enum(CROSSMATCH_RESULTS),
  method: text(2, 60),
});

/** Pengeluaran kantong. Darurat tanpa crossmatch: hanya golongan O, alasan dokter (keputusan fase 4 no. 22). */
export const bloodIssueInputSchema = z.strictObject({
  bloodRequestId: uuid,
  bloodUnitId: uuid,
  emergencyReason: reason.nullable(),
});
export type BloodIssueInput = z.infer<typeof bloodIssueInputSchema>;

export const transfusionReactionInputSchema = z.strictObject({
  bloodIssueId: uuid,
  occurredAt: instant,
  severity: z.enum(['ringan', 'sedang', 'berat']),
  description: text(SAFETY_REASON_MIN, 2000),
});

// ═════════════════════════════ S02 · Mikrobiologi/PA · S10 · Diagnostik lain ═════════════════════════════

export const MICRO_REPORT_STAGES = ['awal', 'akhir'] as const;
export const SUSCEPTIBILITY_RESULTS = ['S', 'I', 'R'] as const;
export const DIAGNOSTIC_KINDS = ['ekg', 'usg', 'echo', 'endoskopi', 'treadmill'] as const;
export type DiagnosticKind = (typeof DIAGNOSTIC_KINDS)[number];

export const microIsolateInputSchema = z.strictObject({
  labOrderId: uuid,
  /** Kode organisme dari daftar lokal (SNOMED menyusul, keputusan fase 4 no. 20). */
  organismCode: text(1, 40),
  growth: text(1, 120),
  susceptibilities: z
    .array(
      z.strictObject({
        antibioticCode: text(1, 40),
        result: z.enum(SUSCEPTIBILITY_RESULTS),
        micValue: z.number().positive().nullable(),
      }),
    )
    .max(60),
});
export type MicroIsolateInput = z.infer<typeof microIsolateInputSchema>;

export const paReportInputSchema = z.strictObject({
  encounterId: uuid,
  surgeryCaseId: uuid.nullable(),
  specimenSite: text(2, 200),
  macroscopic: text(5, 8000),
  microscopic: text(5, 8000),
  diagnosis: text(5, 2000),
  icd10: z
    .string()
    .regex(/^[A-Z][0-9]{2}(\.[0-9A-Z]{1,4})?$/)
    .nullable(),
});
export type PaReportInput = z.infer<typeof paReportInputSchema>;

/** S10: isian formulir P07 per jenis + lampiran P08, lalu TTE (`diagnostics.sign`). */
export const diagnosticReportInputSchema = z.strictObject({
  serviceRequestId: uuid,
  kind: z.enum(DIAGNOSTIC_KINDS),
  formResponseId: uuid,
  documentIds: z.array(uuid).max(20),
  conclusion: text(5, 4000),
});
export type DiagnosticReportInput = z.infer<typeof diagnosticReportInputSchema>;
