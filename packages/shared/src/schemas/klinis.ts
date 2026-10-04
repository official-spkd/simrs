import { z } from 'zod';

/**
 * K01–K13 · Klinis RME: pemeriksaan poli, CPPT, order + CDS, resep.
 * Kontrak respons (zod) yang dipenuhi data dummy mode presentasi sekarang (ADR-0023) dan API kelak. Diisi
 * bersama layar domain ini; nama mengikuti entitas docs/04, camelCase, uang = string rupiah, waktu ISO 8601.
 */

const nonEmpty = z.string().min(1);
/** Rupiah bulat sebagai string (bigint tidak didukung JSON). */
const rupiahString = z.string().regex(/^\d{1,18}$/);
/** Jam tampilan WIB `08.42`. */
const jam = z.string().regex(/^\d{2}\.\d{2}$/);

const SCENARIO_IDS = ['rawat-jalan', 'igd-ranap', 'elektif-btn'] as const;

// ---------------------------------------------------------------------------------------------------------------
// K01/K02 · Antrean poli dan ringkasan kunjungan
// ---------------------------------------------------------------------------------------------------------------

export const POLI_QUEUE_STATUSES = ['menunggu', 'diperiksa', 'menunggu-hasil', 'dijeda', 'selesai'] as const;
export type PoliQueueStatus = (typeof POLI_QUEUE_STATUSES)[number];

const PAYERS = ['BPJS', 'Umum', 'Asuransi'] as const;

export const poliQueueItemSchema = z.strictObject({
  patientId: nonEmpty,
  encounterId: nonEmpty,
  /** Nomor antrean poli `PD-027` (docs/04 §5). */
  queueNo: z.string().regex(/^[A-Z]{1,2}-\d{3}$/),
  name: nonEmpty,
  rm: z.string().regex(/^\d{2}-\d{2}-\d{2}-\d{2}$/),
  sex: z.enum(['L', 'P']),
  ageYears: z.number().int().min(0).max(130),
  payer: z.enum(PAYERS),
  status: z.enum(POLI_QUEUE_STATUSES),
  /** Keterangan waktu antrean, mis. "mulai 08.44", "tunggu 18 mnt". */
  waitNote: nonEmpty,
  /** Skenario Simulasi yang membawakan pasien ini (keadaannya mengikuti mesin skenario). */
  scenario: z.enum(SCENARIO_IDS).nullable(),
});
export type PoliQueueItem = z.infer<typeof poliQueueItemSchema>;

export const poliWorklistSchema = z.strictObject({
  poli: z.strictObject({ code: nonEmpty, name: nonEmpty, room: nonEmpty }),
  doctor: nonEmpty,
  date: z.iso.date(),
  items: z.array(poliQueueItemSchema),
});
export type PoliWorklist = z.infer<typeof poliWorklistSchema>;

export const POLI_VITAL_IDS = ['td', 'nadi', 'suhu', 'napas', 'spo2', 'berat', 'gds'] as const;
export const POLI_VITAL_FLAGS = ['normal', 'tinggi', 'rendah', 'belum'] as const;

export const poliVitalSchema = z.strictObject({
  id: z.enum(POLI_VITAL_IDS),
  label: nonEmpty,
  /** Nilai tampilan (`150/95`, `36,8`); `—` bila belum diukur. */
  value: nonEmpty,
  unit: nonEmpty,
  /** Pembanding atau keterangan, mis. "↑ dari 142/90", "IMT 28,1". */
  note: z.string(),
  flag: z.enum(POLI_VITAL_FLAGS),
});
export type PoliVital = z.infer<typeof poliVitalSchema>;

/** EncounterDiagnosis kunjungan: kode baku ICD-10 (hanya dari rujukan seed, CLAUDE.md §4.10). */
export const encounterDiagnosisSchema = z.strictObject({
  system: z.literal('ICD-10'),
  code: nonEmpty,
  display: nonEmpty,
  primary: z.boolean(),
});
export type EncounterDiagnosis = z.infer<typeof encounterDiagnosisSchema>;

/** Entri CPPT · SOAP aktif (draf atau final). Versi baru, bukan UPDATE (CLAUDE.md §4.2). */
export const cpptSoapSchema = z.strictObject({
  subjective: z.string(),
  objective: z.string(),
  author: nonEmpty,
  createdAt: jam.nullable(),
  savedAt: jam.nullable(),
  signedAt: jam.nullable(),
  version: z.number().int().min(1),
});
export type CpptSoap = z.infer<typeof cpptSoapSchema>;

export const SOAP_PLAN_KINDS = ['LAB', 'RAD', 'OBAT', 'TINDAKAN', 'KONTROL'] as const;
export const soapPlanRowSchema = z.strictObject({
  kind: z.enum(SOAP_PLAN_KINDS),
  text: nonEmpty,
  note: z.string(),
  /** Perlu perhatian (mis. dosis naik). */
  attention: z.boolean(),
});
export type SoapPlanRow = z.infer<typeof soapPlanRowSchema>;

export const ENCOUNTER_LAB_FLAGS = ['', 'H', 'L', 'A', 'K'] as const;
export const encounterLabSchema = z.strictObject({
  name: nonEmpty,
  value: nonEmpty,
  /** H tinggi, L rendah, A abnormal (non-numerik), K kritis, kosong = dalam rentang. */
  flag: z.enum(ENCOUNTER_LAB_FLAGS),
  reference: z.string(),
  loinc: z.string().nullable(),
});
export type EncounterLab = z.infer<typeof encounterLabSchema>;

export const klinisPatientSchema = z.strictObject({
  id: nonEmpty,
  name: nonEmpty,
  sex: z.enum(['L', 'P']),
  ageYears: z.number().int().min(0).max(130),
  birthDate: z.iso.date(),
  rm: z.string().regex(/^\d{2}-\d{2}-\d{2}-\d{2}$/),
  /** NIK tersamar (awalan fiktif 9999). */
  nikMasked: z.string().regex(/^9999•+\d{4}$/),
  allergies: z.array(nonEmpty),
  payer: z.enum(PAYERS),
  /** Penjamin tampilan, mis. "BPJS Kelas 2". */
  payerLabel: nonEmpty,
  sep: z.string().nullable(),
  fallRisk: nonEmpty,
  history: nonEmpty,
});
export type KlinisPatient = z.infer<typeof klinisPatientSchema>;

/** Tahapan kunjungan rawat jalan (stepper): 0 Registrasi … 5 Kasir. */
export const POLI_VISIT_STAGES = [
  'Registrasi',
  'Tanda vital',
  'Pemeriksaan',
  'Order',
  'Farmasi',
  'Kasir',
] as const;

export const poliEncounterSchema = z.strictObject({
  encounterId: nonEmpty,
  queueNo: z.string().regex(/^[A-Z]{1,2}-\d{3}$/),
  poliName: nonEmpty,
  doctor: nonEmpty,
  patient: klinisPatientSchema,
  /** Indeks tahap aktif di `POLI_VISIT_STAGES`. */
  stage: z
    .number()
    .int()
    .min(0)
    .max(POLI_VISIT_STAGES.length - 1),
  /** Jam pengukuran tanda vital oleh perawat; null bila belum diukur hari ini. */
  vitalsAt: jam.nullable(),
  vitals: z.array(poliVitalSchema),
  /** Catatan pemeriksaan klinis (CDS) sebelum tanda tangan. */
  cdsNote: nonEmpty,
  soap: cpptSoapSchema,
  diagnoses: z.array(encounterDiagnosisSchema),
  plan: z.array(soapPlanRowSchema),
  labDate: z.string().nullable(),
  labs: z.array(encounterLabSchema),
  meds: z.array(z.strictObject({ name: nonEmpty, since: nonEmpty })),
  history: z.array(z.strictObject({ when: nonEmpty, what: nonEmpty })),
  documents: z.array(z.strictObject({ name: nonEmpty, value: nonEmpty, done: z.boolean() })),
});
export type PoliEncounter = z.infer<typeof poliEncounterSchema>;

// ---------------------------------------------------------------------------------------------------------------
// K09 · CPOE + CDS
// ---------------------------------------------------------------------------------------------------------------

export const CPOE_ORDER_KINDS = ['lab', 'radiologi', 'obat', 'tindakan', 'kontrol'] as const;
export type CpoeOrderKind = (typeof CPOE_ORDER_KINDS)[number];
/** Penjaminan item: masuk paket/ditanggung, obat Formularium Nasional, atau di luar paket (dibayar pasien). */
export const CPOE_COVERAGES = ['ditanggung', 'fornas', 'tidak-ditanggung'] as const;
export const CPOE_PRIORITIES = ['rutin', 'cito'] as const;
export const CPOE_CDS_LEVELS = ['info', 'warn', 'block'] as const;
export type CpoeCdsLevel = (typeof CPOE_CDS_LEVELS)[number];
export const CPOE_CDS_RULES = [
  'aman',
  'alergi',
  'alergi-silang',
  'interaksi',
  'riwayat',
  'dosis',
  'biaya',
] as const;

/** Kode baku item order: LOINC (lab), KFA (obat), ICD-9-CM (tindakan); null = belum dipetakan. */
export const cpoeCodeSchema = z.strictObject({
  system: z.enum(['LOINC', 'KFA', 'ICD-9-CM']),
  code: nonEmpty,
});

export const cpoeCatalogItemSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]+$/),
  kind: z.enum(CPOE_ORDER_KINDS),
  name: nonEmpty,
  /** Baris keterangan katalog, mis. "Lab PK · LOINC 4548-4". */
  meta: nonEmpty,
  /** Aturan pakai / indikasi. */
  detail: nonEmpty,
  code: cpoeCodeSchema.nullable(),
  coverage: z.enum(CPOE_COVERAGES),
  priority: z.enum(CPOE_PRIORITIES),
  /** Tarif RS. Dibayar pasien bila item di luar paket penjamin, atau seluruhnya bila pasien umum. */
  tariff: rupiahString,
  keywords: z.string(),
  /** Zat aktif (obat) untuk CDS alergi dan interaksi; null untuk non-obat. */
  substance: z.string().nullable(),
  /** Golongan obat, mis. "penisilin", "sefalosporin-1", "sulfonilurea", "ppi". */
  classes: z.array(nonEmpty),
  /** Catatan CDS bila tidak ada temuan, mis. "Terakhir 12 Sep 2026 (7,9%)". */
  note: nonEmpty,
});
export type CpoeCatalogItem = z.infer<typeof cpoeCatalogItemSchema>;

export const cpoeCdsFindingSchema = z.strictObject({
  level: z.enum(CPOE_CDS_LEVELS),
  rule: z.enum(CPOE_CDS_RULES),
  message: nonEmpty,
});
export type CpoeCdsFinding = z.infer<typeof cpoeCdsFindingSchema>;

export const cpoeOrderSchema = z.strictObject({
  /** Id baris order (unik per kunjungan). */
  id: nonEmpty,
  catalogId: z.string().regex(/^[a-z0-9-]+$/),
  kind: z.enum(CPOE_ORDER_KINDS),
  name: nonEmpty,
  detail: nonEmpty,
  code: cpoeCodeSchema.nullable(),
  coverage: z.enum(CPOE_COVERAGES),
  priority: z.enum(CPOE_PRIORITIES),
  tariff: rupiahString,
  cds: cpoeCdsFindingSchema,
  /** `terkirim` = sudah di worklist unit penerima (tidak bisa dihapus, hanya dibatalkan lewat addendum). */
  status: z.enum(['draf', 'terkirim']),
  /** Alasan override CDS yang tercatat (wajib bila temuan CDS memblokir). */
  override: z.string().nullable(),
});
export type CpoeOrder = z.infer<typeof cpoeOrderSchema>;

export const cpoeOrderSetSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: nonEmpty,
  meta: nonEmpty,
  itemIds: z.array(z.string().regex(/^[a-z0-9-]+$/)).min(1),
});
export type CpoeOrderSet = z.infer<typeof cpoeOrderSetSchema>;

export const CPOE_CDS_FLAGS = ['hipoglikemia-berat', 'ckd'] as const;

export const cpoeContextSchema = z.strictObject({
  encounterId: nonEmpty,
  setting: z.enum(['rawat-jalan', 'igd']),
  /** Remah lokasi, mis. "Rawat jalan / Poli Penyakit Dalam / Order". */
  breadcrumb: nonEmpty,
  doctor: nonEmpty,
  patient: klinisPatientSchema,
  weightKg: z.number().positive().nullable(),
  egfr: z.number().int().positive().nullable(),
  /** Obat rutin pasien (dasar CDS interaksi). */
  activeMeds: z.array(
    z.strictObject({
      name: nonEmpty,
      substance: nonEmpty,
      /** Item katalog yang sama persis (lanjutan); id lain dengan zat sama = perubahan dosis. */
      catalogId: z.string().nullable(),
    }),
  ),
  /** Tanda riwayat untuk CDS. */
  flags: z.array(z.enum(CPOE_CDS_FLAGS)),
  catalog: z.array(cpoeCatalogItemSchema),
  orderSets: z.array(cpoeOrderSetSchema),
  orders: z.array(cpoeOrderSchema),
  /** Hasil penunjang terbaru (ditampilkan di samping order). */
  results: z.array(encounterLabSchema),
});
export type CpoeContext = z.infer<typeof cpoeContextSchema>;

/** Kunjungan hari ini yang bisa dibuka di CPOE (`/klinis/order`). */
export const cpoeEncounterRefSchema = z.strictObject({
  encounterId: nonEmpty,
  name: nonEmpty,
  rm: z.string().regex(/^\d{2}-\d{2}-\d{2}-\d{2}$/),
  unit: nonEmpty,
  note: nonEmpty,
  allergies: z.array(nonEmpty),
});
export type CpoeEncounterRef = z.infer<typeof cpoeEncounterRefSchema>;

// ---------------------------------------------------------------------------------------------------------------
// Masukan aksi (Server Action mode presentasi; kelak body API)
// ---------------------------------------------------------------------------------------------------------------

/** Id kunjungan: format bebas tapi berbatas (UUID v7 kelak, `kj-suryo` di mode presentasi); id asing ditolak lookup. */
const encounterId = z.string().min(1).max(60);
const icd10Code = z.string().regex(/^[A-Z]\d{2}(\.\d{1,2})?$/);

export const cpptDraftInputSchema = z.strictObject({
  encounterId,
  subjective: z.string().max(2000),
  objective: z.string().max(2000),
  diagnosisCodes: z.array(icd10Code).max(10),
});
export type CpptDraftInput = z.infer<typeof cpptDraftInputSchema>;

/** Tanda tangan CPPT: minimal satu diagnosis (mockup: "Isi minimal satu diagnosis …"). */
export const cpptSignInputSchema = cpptDraftInputSchema.extend({
  diagnosisCodes: z.array(icd10Code).min(1).max(10),
});

/** Asesmen awal keperawatan: tanda vital yang diukur ulang perawat. */
export const poliVitalsInputSchema = z.strictObject({
  encounterId,
  td: z.string().regex(/^\d{2,3}\/\d{2,3}$/, 'Isi dengan format sistolik/diastolik, mis. 120/80.'),
  nadi: z.coerce
    .number({ error: 'Nadi 20–250 x/mnt.' })
    .int()
    .min(20, 'Nadi 20–250 x/mnt.')
    .max(250, 'Nadi 20–250 x/mnt.'),
  suhu: z
    .string()
    .regex(/^\d{2}([.,]\d)?$/, 'Suhu dalam °C, mis. 36,8.')
    .refine((v) => {
      const n = Number(v.replace(',', '.'));
      return n >= 30 && n <= 43;
    }, 'Suhu 30–43 °C.'),
  spo2: z.coerce.number({ error: 'SpO2 50–100%.' }).int().min(50, 'SpO2 50–100%.').max(100, 'SpO2 50–100%.'),
});
export type PoliVitalsInput = z.infer<typeof poliVitalsInputSchema>;

export const CPOE_OVERRIDE_MIN_REASON = 10;

export const cpoeSendInputSchema = z.strictObject({
  encounterId,
  orders: z
    .array(
      z.strictObject({
        catalogId: z.string().regex(/^[a-z0-9-]+$/),
        /** Alasan override CDS (wajib bila order diblokir CDS). */
        override: z.string().trim().min(CPOE_OVERRIDE_MIN_REASON).max(500).nullable(),
      }),
    )
    .min(1)
    .max(40),
});
export type CpoeSendInput = z.infer<typeof cpoeSendInputSchema>;
