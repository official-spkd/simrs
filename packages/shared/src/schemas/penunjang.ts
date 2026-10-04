import { z } from 'zod';

/**
 * S01–S09 · Penunjang: laboratorium, radiologi, farmasi.
 * Kontrak respons (zod) yang dipenuhi data dummy mode presentasi sekarang (ADR-0023) dan API kelak. Diisi
 * bersama layar domain ini; nama mengikuti entitas docs/04, camelCase, uang = string rupiah, waktu ISO 8601.
 * Nilai mentah (angka, kode, waktu), bukan teks tampilan: format Indonesia dikerjakan lapisan tampilan.
 */

const isoDateTime = z.iso.datetime({ offset: true });
const isoDate = z.iso.date();
/** Kode LOINC (mis. `2823-3`). */
const loincCode = z.string().regex(/^\d{1,7}-\d$/);
/** Kode KFA obat (8 digit). */
const kfaCode = z.string().regex(/^\d{8}$/);
/** Kode prosedur ICD-9-CM (mis. `87.03`). */
const icd9cmCode = z.string().regex(/^\d{2}\.\d{1,2}$/);

/** Identitas pasien untuk banner layar penunjang (dua pengenal: nama + tanggal lahir/RM; tanpa NIK). */
export const supportPatientSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  rm: z.string().regex(/^00-\d{2}-\d{2}-\d{2}$/),
  sex: z.enum(['L', 'P']),
  ageYears: z.number().int().min(0).max(130),
  birthDate: isoDate,
  allergies: z.array(z.string().min(1)),
  guarantor: z.string().min(1),
});
export type SupportPatient = z.infer<typeof supportPatientSchema>;

export const SUPPORT_PRIORITIES = ['cito', 'rutin'] as const;
export type SupportPriority = (typeof SUPPORT_PRIORITIES)[number];

// ───────────────────────────── Laboratorium (S01, S09) ─────────────────────────────

/** Flag hasil: normal, tinggi, rendah, kritis (melewati batas kritis). Delta check terpisah (`delta`). */
export const LAB_FLAGS = ['N', 'H', 'L', 'KRITIS'] as const;
export type LabFlag = (typeof LAB_FLAGS)[number];

/** Rentang inklusif; batas yang tidak berlaku = null (mis. CRP `< 5` → `{ low: null, high: 5 }`). */
export const labRangeSchema = z.strictObject({ low: z.number().nullable(), high: z.number().nullable() });
export type LabRange = z.infer<typeof labRangeSchema>;

export const labResultSchema = z.strictObject({
  loinc: loincCode,
  name: z.string().min(1),
  /** Nilai numerik; null bila hasil kualitatif (`text`) atau masih diproses (`pending`). */
  value: z.number().nullable(),
  /** Hasil kualitatif, mis. golongan darah "O". */
  text: z.string().nullable(),
  unit: z.string(),
  /** Jumlah desimal tampilan. */
  decimals: z.number().int().min(0).max(3),
  ref: labRangeSchema.nullable(),
  critical: labRangeSchema.nullable(),
  /** Hasil sebelumnya (lama → baru) untuk tren dan delta check. */
  previous: z.array(z.number()).max(5),
  /** Batas delta check: selisih absolut terhadap hasil sebelumnya; null = tidak dicek. */
  deltaLimit: z.number().positive().nullable(),
  /** Null selama hasil belum keluar. */
  flag: z.enum(LAB_FLAGS).nullable(),
  delta: z.boolean(),
  pending: z.boolean(),
  /** Catatan turunan, mis. "eGFR 74 mL/menit/1,73 m² (dihitung)". */
  note: z.string().nullable(),
});
export type LabResult = z.infer<typeof labResultSchema>;

/**
 * Pelaporan nilai kritis (S09): wajib ≤ `limitMinutes` sejak hasil keluar, dan baru sah setelah penerima
 * membacakan ulang (read-back). `minutesToReport` = hasil keluar → read-back terkonfirmasi.
 */
export const labCriticalReportSchema = z.strictObject({
  loinc: loincCode,
  analyte: z.string().min(1),
  value: z.number(),
  unit: z.string().min(1),
  decimals: z.number().int().min(0).max(3),
  resultAt: isoDateTime,
  limitMinutes: z.number().int().positive(),
  /** Detik berjalan sejak hasil keluar saat data diambil (awal timer di layar). */
  elapsedSeconds: z.number().int().nonnegative(),
  recipient: z.string().min(5).nullable(),
  reportedAt: isoDateTime.nullable(),
  readBackAt: isoDateTime.nullable(),
  minutesToReport: z.number().int().nonnegative().nullable(),
});
export type LabCriticalReport = z.infer<typeof labCriticalReportSchema>;

/** order → sampel diterima (analyzer) → hasil masuk → validasi teknis → selesai (validasi klinis, rilis). */
export const LAB_SAMPLE_STATUSES = [
  'order',
  'diterima',
  'hasil',
  'validasi-teknis',
  'selesai',
  'inkubasi',
] as const;
export type LabSampleStatus = (typeof LAB_SAMPLE_STATUSES)[number];

const signOffSchema = z.strictObject({ by: z.string().min(1), at: isoDateTime });

/** Satu sampel di worklist laboratorium beserta hasilnya. */
export const labSampleSchema = z.strictObject({
  id: z.string().min(1),
  /** Nomor laboratorium: `L` + YYMMDD + 4 digit (barcode tabung). */
  labNo: z.string().regex(/^L\d{10}$/),
  patient: supportPatientSchema,
  location: z.string().min(1),
  sender: z.string().min(1),
  priority: z.enum(SUPPORT_PRIORITIES),
  status: z.enum(LAB_SAMPLE_STATUSES),
  /** Ringkasan pemeriksaan yang diorder, mis. "DL, kimia". */
  tests: z.string().min(1),
  specimen: z.string().min(1),
  orderedAt: isoDateTime,
  receivedAt: isoDateTime.nullable(),
  /** Waktu tunggu berjalan (menit) sejak sampel diterima; null bila belum diterima. */
  tatMinutes: z.number().int().nonnegative().nullable(),
  results: z.array(labResultSchema),
  /** QC dan catatan analis, mis. "QC harian lolos (Westgard 1-2s)". */
  qcNote: z.string().min(1),
  technical: signOffSchema.nullable(),
  clinical: signOffSchema.nullable(),
  critical: labCriticalReportSchema.nullable(),
});
export type LabSample = z.infer<typeof labSampleSchema>;

export const labWorklistSchema = z.strictObject({
  asOf: isoDateTime,
  stats: z.strictObject({
    samplesToday: z.number().int().nonnegative(),
    awaitingValidation: z.number().int().nonnegative(),
    tatRoutineMinutes: z.number().int().positive(),
    tatRoutineTarget: z.number().int().positive(),
    tatCitoMinutes: z.number().int().positive(),
    tatCitoTarget: z.number().int().positive(),
  }),
  analyzers: z.array(
    z.strictObject({ name: z.string().min(1), link: z.string().min(1), online: z.boolean() }),
  ),
  samples: z.array(labSampleSchema).min(1),
});
export type LabWorklist = z.infer<typeof labWorklistSchema>;

// ───────────────────────────── Farmasi (S04, S05) ─────────────────────────────

/** Tingkat peringatan CDS: mayor memblokir sampai ditindaklanjuti; sedang perlu konfirmasi; info tidak memblokir. */
export const PHARMACY_CDS_LEVELS = ['mayor', 'sedang', 'info'] as const;
export type PharmacyCdsLevel = (typeof PHARMACY_CDS_LEVELS)[number];
export const PHARMACY_CDS_KINDS = [
  'interaksi',
  'dosis-ginjal',
  'alergi',
  'kontraindikasi',
  'high-alert',
] as const;
export type PharmacyCdsKind = (typeof PHARMACY_CDS_KINDS)[number];

export const pharmacyCdsAlertSchema = z.strictObject({
  id: z.string().min(1),
  level: z.enum(PHARMACY_CDS_LEVELS),
  kind: z.enum(PHARMACY_CDS_KINDS),
  title: z.string().min(1),
  detail: z.string().min(1),
  /** Tindakan yang disarankan, mis. "Ganti omeprazol dengan pantoprazol 40 mg". */
  recommendation: z.string().nullable(),
  /** Item resep yang terlibat (kosong bila item sudah dihapus di CPOE). */
  itemIds: z.array(z.string().min(1)),
  /** terbuka = perlu tindakan apoteker; teratasi = sudah ditindaklanjuti; override = dilanjutkan dengan alasan. */
  status: z.enum(['terbuka', 'teratasi', 'override']),
  /** Ringkasan tindak lanjut/alasan override (wajib bila bukan terbuka). */
  resolution: z.string().nullable(),
});
export type PharmacyCdsAlert = z.infer<typeof pharmacyCdsAlertSchema>;

export const pharmacyItemSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  /** Kode KFA; null = belum dipetakan (tampil "KFA belum dipetakan"). */
  kfa: kfaCode.nullable(),
  /** Masuk Formularium Nasional. */
  fornas: z.boolean(),
  dose: z.string().min(1),
  route: z.string().min(1),
  frequency: z.string().min(1),
  /** Jumlah yang diserahkan (satuan `unit`). */
  quantity: z.number().int().positive(),
  unit: z.string().min(1),
  highAlert: z.boolean(),
  /** Stok depo saat ini dan batas minimum (satuan `unit`). */
  stock: z.number().int().nonnegative(),
  stockMin: z.number().int().nonnegative(),
  note: z.string().nullable(),
});
export type PharmacyItem = z.infer<typeof pharmacyItemSchema>;

/** Status penyerahan: telaah → penyiapan → serah terima → selesai. */
export const DISPENSE_STAGES = ['telaah', 'siap', 'serah', 'selesai'] as const;
export type DispenseStage = (typeof DISPENSE_STAGES)[number];

export const pharmacyPrescriptionSchema = z.strictObject({
  id: z.string().min(1),
  no: z.string().regex(/^R-\d{4}-\d{4}$/),
  patient: supportPatientSchema,
  location: z.string().min(1),
  setting: z.enum(['rawat-jalan', 'rawat-inap', 'igd']),
  depot: z.string().min(1),
  prescriber: z.string().min(1),
  writtenAt: isoDateTime,
  stage: z.enum(DISPENSE_STAGES),
  cito: z.boolean(),
  /** Label antrean, mis. "PRB", "Pulang", "Racikan". */
  tag: z.string().min(1),
  prb: z.boolean(),
  /** Lama terapi (hari) untuk resep pulang/rawat jalan. */
  days: z.number().int().positive().nullable(),
  weightKg: z.number().positive().nullable(),
  egfr: z.number().positive().nullable(),
  items: z.array(pharmacyItemSchema).min(1),
  alerts: z.array(pharmacyCdsAlertSchema),
  dispensedTo: z.enum(['pasien', 'keluarga', 'perawat']).nullable(),
  dispensedAt: isoDateTime.nullable(),
});
export type PharmacyPrescription = z.infer<typeof pharmacyPrescriptionSchema>;

export const pharmacyQueueSchema = z.strictObject({
  asOf: isoDateTime,
  /** Apoteker bertugas (cek ganda obat high alert oleh apoteker kedua). */
  pharmacists: z.array(z.string().min(1)).min(2),
  prescriptions: z.array(pharmacyPrescriptionSchema).min(1),
});
export type PharmacyQueue = z.infer<typeof pharmacyQueueSchema>;

// ───────────────────────────── Radiologi (S03) ─────────────────────────────

export const RAD_MODALITIES = ['CT', 'DR', 'USG', 'MRI', 'ANGIO'] as const;
export type RadModality = (typeof RAD_MODALITIES)[number];
/** terjadwal → berlangsung → ekspertise → ditandatangani (TTE radiolog). */
export const RAD_STATUSES = ['terjadwal', 'berlangsung', 'ekspertise', 'ditandatangani'] as const;
export type RadStatus = (typeof RAD_STATUSES)[number];

export const radiologyReportSchema = z.strictObject({
  findings: z.string(),
  impression: z.string(),
  radiologist: z.string().min(1),
  signedAt: isoDateTime.nullable(),
});
export type RadiologyReport = z.infer<typeof radiologyReportSchema>;

export const radiologyExamSchema = z.strictObject({
  id: z.string().min(1),
  accession: z.string().regex(/^RAD-\d{4}-\d{4}$/),
  patient: supportPatientSchema,
  location: z.string().min(1),
  sender: z.string().min(1),
  modality: z.enum(RAD_MODALITIES),
  procedure: z.string().min(1),
  /** Kode ICD-9-CM; null = belum dipetakan. */
  procedureCode: icd9cmCode.nullable(),
  priority: z.enum(SUPPORT_PRIORITIES),
  status: z.enum(RAD_STATUSES),
  room: z.string().min(1),
  scheduledAt: isoDateTime,
  startedAt: isoDateTime.nullable(),
  indication: z.string().min(1),
  contrast: z.boolean(),
  /** Dosis radiasi CT: CTDIvol (mGy) dan DLP (mGy·cm); wajib sebelum ekspertise untuk CT. */
  dose: z.strictObject({ ctdiVol: z.number().positive(), dlp: z.number().positive() }).nullable(),
  report: radiologyReportSchema.nullable(),
});
export type RadiologyExam = z.infer<typeof radiologyExamSchema>;

export const radiologyModalitySchema = z.strictObject({
  modality: z.enum(RAD_MODALITIES),
  name: z.string().min(1),
  room: z.string().min(1),
  status: z.enum(['siap', 'dipakai', 'perawatan']),
  slotsTotal: z.number().int().positive(),
  slotsUsed: z.number().int().nonnegative(),
  /** Slot kosong berikutnya ("13.30"); null bila penuh/perawatan. */
  nextSlot: z
    .string()
    .regex(/^\d{2}\.\d{2}$/)
    .nullable(),
});
export type RadiologyModality = z.infer<typeof radiologyModalitySchema>;

export const radiologyWorklistSchema = z.strictObject({
  asOf: isoDateTime,
  stats: z.strictObject({
    tatExpertiseMinutes: z.number().int().positive(),
    tatExpertiseTarget: z.number().int().positive(),
  }),
  modalities: z.array(radiologyModalitySchema).min(1),
  exams: z.array(radiologyExamSchema).min(1),
});
export type RadiologyWorklist = z.infer<typeof radiologyWorklistSchema>;
