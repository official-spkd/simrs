import { z } from 'zod';
import { MEDICATION_FREQUENCY_CODES } from '../clinical/emar';
import { NEWS2_CONSCIOUSNESS } from '../clinical/ews';

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
  /** `-` = jenis kelamin tidak diketahui (data api; pasien tanpa identitas). */
  sex: z.enum(['L', 'P', '-']),
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
  /** `-` = jenis kelamin tidak diketahui (data api; pasien tanpa identitas). */
  sex: z.enum(['L', 'P', '-']),
  ageYears: z.number().int().min(0).max(130),
  /** Null bila tanggal lahir tidak tercatat (data api). */
  birthDate: z.iso.date().nullable(),
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
export type CpoeCoverage = (typeof CPOE_COVERAGES)[number];
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
  // Fase 3 (KB CDS per RS): dosis ginjal, duplikasi order, singkatan terlarang di aturan pakai.
  'ginjal',
  'duplikasi',
  'singkatan',
] as const;
export type CpoeCdsRule = (typeof CPOE_CDS_RULES)[number];

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
  /**
   * Tarif RS. Dibayar pasien bila item di luar paket penjamin, atau seluruhnya bila pasien umum. Null = belum ada tarif
   * (mode api sampai master tarif U01 fase 5; nominal disembunyikan).
   */
  tariff: rupiahString.nullable(),
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
  tariff: rupiahString.nullable(),
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

// ===============================================================================================================
// Kontrak API fase 3 (rencana §3.0a). Bagian di atas = kontrak mode presentasi (dibekukan bersama jalur demo,
// keputusan fase 2 no. 4); bagian ini = kontrak jalur api. ID selalu UUID, penulis selalu dari sesi server, dua stempel
// waktu (MRMIK 8b), biaya null sampai master tarif U01 (fase 5).
// ===============================================================================================================

/** Alasan wajib untuk override gerbang keselamatan dan koreksi entri klinis (= CHECK ≥ 10 di database). */
export const SAFETY_REASON_MIN = 10;
const safetyReason = z.string().trim().min(SAFETY_REASON_MIN).max(500);
const uuid = z.uuid();
const instant = z.iso.datetime({ offset: true });
const freeText = (max: number) => z.string().trim().max(max);
const roleCodeSchema = z.string().regex(/^[a-z][a-z0-9_]{2,40}$/);

/** Status entri klinis tersimpan (ADR-0004/0028). Draf bukan rekam medis (`clinical_drafts`). */
export const CLINICAL_ENTRY_STATUSES = ['final', 'entered_in_error'] as const;
export type ClinicalEntryStatus = (typeof CLINICAL_ENTRY_STATUSES)[number];

/** Penulis entri: SELALU dari sesi server (MRMIK 8a); body klien tidak pernah memuat penulis. */
export const clinicalAuthorSchema = z.strictObject({
  userId: uuid,
  nama: z.string().min(1).max(120),
  /** Kode peran penugasan sesi saat menulis (mis. `dokter_residen`). */
  peran: roleCodeSchema,
});
export type ClinicalAuthor = z.infer<typeof clinicalAuthorSchema>;

/** Kolom bersama setiap entri klinis berversi (jawaban API). */
export const clinicalEntryMetaSchema = z.strictObject({
  id: uuid,
  /** Versi 1 rantai ini (riwayat = semua versi ber-`rootId` sama). */
  rootId: uuid,
  version: z.int().min(1),
  supersedesId: uuid.nullable(),
  /** Addendum: entri baru yang menunjuk entri final tanpa menggantikannya. */
  addendumOf: uuid.nullable(),
  status: z.enum(CLINICAL_ENTRY_STATUSES),
  correctionReason: z.string().max(500).nullable(),
  /** Waktu kejadian, diisi PPA. */
  occurredAt: instant,
  /** Waktu catat, dari server, tidak bisa diubah. */
  recordedAt: instant,
  /** Selisih catat − kejadian melebihi `clinical.late_entry_hours`. */
  lateEntry: z.boolean(),
  author: clinicalAuthorSchema,
  /** Versi ber-TTE: tidak bisa digantikan, hanya addendum (`RECORD_LOCKED`). */
  locked: z.boolean(),
});
export type ClinicalEntryMeta = z.infer<typeof clinicalEntryMetaSchema>;

/**
 * Skema input umum revisi entri klinis: entri baru, koreksi (versi baru oleh penulis asli, wajib alasan; 409 bila versi
 * itu sudah digantikan), atau addendum (PPA lain boleh, atas entri final).
 */
export const clinicalRevisionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('baru') }),
  z.strictObject({ kind: z.literal('koreksi'), supersedesId: uuid, correctionReason: safetyReason }),
  z.strictObject({ kind: z.literal('addendum'), addendumOf: uuid }),
]);
export type ClinicalRevision = z.infer<typeof clinicalRevisionSchema>;

/** Tandai salah entri (`entered_in_error`): versi baru beralasan; isi asli tetap tersimpan. ID target dari path. */
export const clinicalEnteredInErrorInputSchema = z.strictObject({ reason: safetyReason });
export type ClinicalEnteredInErrorInput = z.infer<typeof clinicalEnteredInErrorInputSchema>;

/** Atestasi elektronik sesi (keputusan fase 3 no. 2): co-sign, verifikasi DPJP, tinjau order residen. */
export const CLINICAL_ATTESTATION_KINDS = ['cosign', 'verify', 'review_order'] as const;
export type ClinicalAttestationKind = (typeof CLINICAL_ATTESTATION_KINDS)[number];
export const clinicalAttestationSchema = z.strictObject({
  kind: z.enum(CLINICAL_ATTESTATION_KINDS),
  by: clinicalAuthorSchema,
  at: instant,
});
export type ClinicalAttestation = z.infer<typeof clinicalAttestationSchema>;

// ---------------------------------------------------------------------------------------------------------------
// K12/K08 · Observasi (tanda vital + NEWS2 dihitung server)
// ---------------------------------------------------------------------------------------------------------------

export const OBSERVATION_CATEGORIES = ['vital', 'lab', 'imaging', 'survei', 'cairan'] as const;
export type ObservationCategory = (typeof OBSERVATION_CATEGORIES)[number];
/** Bendera interpretasi hasil/observasi (arah selalu tertulis, tidak hanya warna). */
export const OBSERVATION_INTERPRETATIONS = ['normal', 'tinggi', 'rendah', 'abnormal', 'kritis'] as const;
export type ObservationInterpretation = (typeof OBSERVATION_INTERPRETATIONS)[number];

/** Tanda vital dewasa. Skor NEWS2 dihitung server dari nilai ini, tidak diterima dari klien. */
export const vitalSignsInputSchema = z.strictObject({
  encounterId: uuid,
  occurredAt: instant,
  temp: z.number().min(30).max(45),
  hr: z.int().min(20).max(250),
  rr: z.int().min(4).max(60),
  sbp: z.int().min(40).max(260),
  dbp: z.int().min(20).max(160),
  spo2: z.int().min(50).max(100),
  onOxygen: z.boolean(),
  consciousness: z.enum(NEWS2_CONSCIOUSNESS),
  weightKg: z.number().positive().max(400).nullable(),
});
export type VitalSignsInput = z.infer<typeof vitalSignsInputSchema>;

export const vitalSignsRecordSchema = clinicalEntryMetaSchema.extend({
  encounterId: uuid,
  values: vitalSignsInputSchema.omit({ encounterId: true, occurredAt: true }),
  ews: z.strictObject({
    score: z.int().min(0).max(20),
    maxParam: z.int().min(0).max(3),
    risk: z.enum(['rendah', 'sedang', 'tinggi']),
  }),
});
export type VitalSignsRecord = z.infer<typeof vitalSignsRecordSchema>;

// ---------------------------------------------------------------------------------------------------------------
// K08 · Diagnosis, prosedur, alergi (kode baku dari `ref`; tidak dikarang)
// ---------------------------------------------------------------------------------------------------------------

const icd10 = z.string().regex(/^[A-Z][0-9]{2}(\.[0-9A-Z]{1,4})?$/, 'Kode ICD-10 tidak valid');
const icd9cm = z.string().regex(/^[0-9]{2}(\.[0-9]{1,2})?$/, 'Kode ICD-9-CM tidak valid');

export const CONDITION_ROLES = ['utama', 'sekunder', 'komplikasi'] as const;
export type ConditionRole = (typeof CONDITION_ROLES)[number];
/** Diagnosis kunjungan, atau masalah di problem list pasien (lintas kunjungan). */
export const CONDITION_KINDS = ['encounter', 'problem_list'] as const;
export const CONDITION_CLINICAL_STATUSES = ['active', 'resolved'] as const;

export const conditionInputSchema = z
  .strictObject({
    encounterId: uuid,
    kind: z.enum(CONDITION_KINDS),
    /** Wajib untuk diagnosis kunjungan; null untuk problem list. */
    role: z.enum(CONDITION_ROLES).nullable(),
    code: icd10,
    clinicalStatus: z.enum(CONDITION_CLINICAL_STATUSES),
    note: freeText(500).nullable(),
    occurredAt: instant,
    revision: clinicalRevisionSchema,
  })
  .refine((v) => (v.kind === 'encounter') === (v.role !== null), {
    path: ['role'],
    message: 'Diagnosis kunjungan wajib berperan utama/sekunder/komplikasi; problem list tanpa peran.',
  });
export type ConditionInput = z.infer<typeof conditionInputSchema>;

export const procedureInputSchema = z.strictObject({
  encounterId: uuid,
  code: icd9cm,
  note: freeText(500).nullable(),
  occurredAt: instant,
  revision: clinicalRevisionSchema,
});
export type ProcedureInput = z.infer<typeof procedureInputSchema>;

export const ALLERGY_CATEGORIES = ['obat', 'makanan', 'lingkungan', 'lainnya'] as const;
export const ALLERGY_CRITICALITIES = ['rendah', 'tinggi', 'tidak_diketahui'] as const;

/**
 * Alergi: zat terkode (`drug_substances`) atau teks bebas; `nkda` = "tidak ada alergi obat yang diketahui" dicatat
 * eksplisit (bukan kosong). Perubahan = versi baru.
 */
export const allergyInputSchema = z
  .strictObject({
    patientId: uuid,
    encounterId: uuid.nullable(),
    kind: z.enum(['alergi', 'nkda']),
    substanceId: uuid.nullable(),
    text: freeText(120).nullable(),
    category: z.enum(ALLERGY_CATEGORIES).nullable(),
    criticality: z.enum(ALLERGY_CRITICALITIES).nullable(),
    reaction: freeText(300).nullable(),
    occurredAt: instant,
    revision: clinicalRevisionSchema,
  })
  .superRefine((v, ctx) => {
    if (v.kind === 'nkda') {
      if (v.substanceId || v.text || v.category || v.criticality || v.reaction) {
        ctx.addIssue({
          code: 'custom',
          path: ['kind'],
          message: 'NKDA tidak memuat zat, kategori, atau reaksi.',
        });
      }
      return;
    }
    if (!v.substanceId && !v.text) {
      ctx.addIssue({
        code: 'custom',
        path: ['substanceId'],
        message: 'Pilih zat terkode atau tulis nama alergen.',
      });
    }
    if (!v.category || !v.criticality) {
      ctx.addIssue({ code: 'custom', path: ['category'], message: 'Kategori dan kritikalitas wajib diisi.' });
    }
  });
export type AllergyInput = z.infer<typeof allergyInputSchema>;

// ---------------------------------------------------------------------------------------------------------------
// K09 · CPOE + CDS (jalur api)
// ---------------------------------------------------------------------------------------------------------------

/** Item katalog order (orderable penunjang/tindakan atau obat). Tarif null sampai U01. */
export const orderCatalogItemSchema = z.strictObject({
  id: uuid,
  kind: z.enum(CPOE_ORDER_KINDS),
  name: nonEmpty,
  code: cpoeCodeSchema.nullable(),
  coverage: z.enum(CPOE_COVERAGES),
  priority: z.enum(CPOE_PRIORITIES),
  tariff: rupiahString.nullable(),
  substance: z.string().nullable(),
  classes: z.array(nonEmpty),
  highAlert: z.boolean(),
  /** Unit tujuan (lab/radiologi/farmasi); null = ditentukan saat order. */
  unitId: uuid.nullable(),
});
export type OrderCatalogItem = z.infer<typeof orderCatalogItemSchema>;

const overrideReason = z.string().trim().min(CPOE_OVERRIDE_MIN_REASON).max(500).nullable();
const emarTime = z.string().regex(/^([01]\d|2[0-3])\.[0-5]\d$/, 'Jam HH.MM');

/** Satu komponen racikan (keputusan fase 3 no. 17: struktur data sekarang, antarmuka bersama farmasi fase 4). */
const compoundComponentSchema = z.strictObject({ drugId: uuid, amount: z.string().trim().min(1).max(40) });

export const medicationOrderLineSchema = z
  .strictObject({
    type: z.literal('obat'),
    /** Obat tunggal; null bila racikan. */
    drugId: uuid.nullable(),
    compound: z
      .strictObject({
        name: z.string().trim().min(1).max(80),
        dosageForm: z.string().trim().min(1).max(40),
        quantity: z.int().min(1).max(500),
        components: z.array(compoundComponentSchema).min(2).max(10),
      })
      .nullable(),
    dose: z.string().trim().min(1).max(40),
    route: z.string().trim().min(1).max(30),
    frequency: z.enum(MEDICATION_FREQUENCY_CODES),
    /** Jam khusus order (WIB), mis. insulin 22.00; null = jam bawaan frekuensi. */
    customTimes: z.array(emarTime).min(1).max(8).nullable(),
    durationDays: z.int().min(1).max(90).nullable(),
    instructions: freeText(300).nullable(),
    override: overrideReason,
  })
  .refine((v) => (v.drugId === null) !== (v.compound === null), {
    path: ['drugId'],
    message: 'Pilih satu obat atau satu racikan.',
  });

export const serviceOrderLineSchema = z.strictObject({
  type: z.literal('layanan'),
  orderableId: uuid,
  priority: z.enum(CPOE_PRIORITIES),
  instructions: freeText(300).nullable(),
  override: overrideReason,
});

export const orderLineInputSchema = z.discriminatedUnion('type', [
  serviceOrderLineSchema,
  medicationOrderLineSchema,
]);
export type OrderLineInput = z.infer<typeof orderLineInputSchema>;

/**
 * Kirim order (`POST /orders/submit`, header Idempotency-Key). Server mengevaluasi ulang CDS; temuan `block` tanpa
 * override beralasan → 422 `CDS_BLOCKED`. Pratinjau (`/orders/evaluate`) memakai skema yang sama.
 */
export const orderSubmitInputSchema = z.strictObject({
  encounterId: uuid,
  orderSetId: uuid.nullable(),
  items: z.array(orderLineInputSchema).min(1).max(40),
});
export type OrderSubmitInput = z.infer<typeof orderSubmitInputSchema>;

export const orderCancelInputSchema = z.strictObject({ reason: safetyReason });

/** Keputusan atas satu temuan CDS (`cds_alerts`, append-only). */
export const CDS_ALERT_DECISIONS = ['diterima', 'override', 'diblokir'] as const;
export type CdsAlertDecision = (typeof CDS_ALERT_DECISIONS)[number];

export const cdsAlertSchema = z.strictObject({
  id: uuid,
  orderLineIndex: z.int().min(0),
  ruleCode: z.string().min(1).max(80),
  level: z.enum(CPOE_CDS_LEVELS),
  rule: z.enum(CPOE_CDS_RULES),
  message: nonEmpty,
  decision: z.enum(CDS_ALERT_DECISIONS),
  overrideReason: z.string().nullable(),
  decidedBy: clinicalAuthorSchema,
  decidedAt: instant,
});
export type CdsAlert = z.infer<typeof cdsAlertSchema>;

// ---------------------------------------------------------------------------------------------------------------
// Draf klinis (`PUT/GET/DELETE /api/v1/drafts/:encounterId/:kind`, potongan 3.1; ADR-0028 butir 5)
// ---------------------------------------------------------------------------------------------------------------

/** Jenis draf: `cppt`, `soap`, `asesmen:<kode formulir>`, `resume`, … */
export const CLINICAL_DRAFT_KIND_PATTERN = /^[a-z][a-z0-9_:-]{1,60}$/;
/** Batas ukuran isi draf (JSON), cukup untuk SOAP/resume panjang. */
export const CLINICAL_DRAFT_MAX_BYTES = 64 * 1024;
/** Batas jumlah draf per penulis × kunjungan (jenis bebas sesuai pola; cegah penimbunan draf 64 KB tanpa batas). */
export const CLINICAL_DRAFT_MAX_PER_ENCOUNTER = 20;

export const clinicalDraftInputSchema = z.strictObject({
  content: z.record(z.string(), z.unknown()).refine(
    // Byte UTF-8, bukan jumlah karakter (teks non-ASCII bisa 3–4 byte per karakter).
    (v) => new TextEncoder().encode(JSON.stringify(v)).length <= CLINICAL_DRAFT_MAX_BYTES,
    'Draf terlalu besar (maks. 64 KB)',
  ),
});
export type ClinicalDraftInput = z.infer<typeof clinicalDraftInputSchema>;

/** Draf milik penulis sesi; tidak pernah dikirim ke pengguna lain. */
export const clinicalDraftSchema = z.strictObject({
  encounterId: uuid,
  kind: z.string().regex(CLINICAL_DRAFT_KIND_PATTERN),
  content: z.record(z.string(), z.unknown()),
  updatedAt: instant,
});
export type ClinicalDraft = z.infer<typeof clinicalDraftSchema>;
