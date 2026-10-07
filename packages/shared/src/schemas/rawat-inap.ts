import { z } from 'zod';
import {
  EMAR_SLOT_STATES,
  MEDICATION_ADMINISTRATION_STATUSES,
  MEDICATION_FREQUENCY_CODES,
} from '../clinical/emar';
import { NEWS2_CONSCIOUSNESS } from '../clinical/ews';
import { TRIAGE_DISCRIMINATOR_CODES, triageVitalsSchema } from '../clinical/triage';
import { PATIENT_SEXES } from '../patient';
import { CARE_CLASSES } from './facility';
import { icd10CodingSchema } from './front-office';
import { ARRIVAL_MODES, generalConsentInputSchema, PAYER_KINDS, SEP_STATUSES } from './registration';
import {
  clinicalAttestationSchema,
  clinicalAuthorSchema,
  clinicalEntryMetaSchema,
  clinicalRevisionSchema,
  SAFETY_REASON_MIN,
} from './klinis';

/**
 * K03–K13 · IGD, tempat tidur, rawat inap (CPPT, eMAR, EWS), resume, persetujuan tindakan.
 * Kontrak respons (zod) yang dipenuhi data dummy mode presentasi sekarang (ADR-0023) dan API kelak. Diisi
 * bersama layar domain ini; nama mengikuti entitas docs/04, camelCase, uang = string rupiah, waktu ISO 8601.
 * Entri klinis immutable (CLAUDE.md §4.2): koreksi = versi baru (`version`, `supersedesId`, `correctionReason`).
 */

const isoDateTime = z.iso.datetime({ offset: true });
const isoDate = z.iso.date();
const id = z.string().min(1).max(60);
const text = (max: number) => z.string().max(max);

/** Alasan wajib (`SAFETY_REASON_MIN`) untuk override gerbang keselamatan (triase turun, gelang eMAR, koreksi, penolakan). */
const reason = z.string().trim().min(SAFETY_REASON_MIN).max(500);

// ---------------------------------------------------------------------------------------------------------
// K03 · IGD: papan pelacakan + triase 5 level
// ---------------------------------------------------------------------------------------------------------

export const TRIAGE_LEVELS = [1, 2, 3, 4, 5] as const;
export type TriageLevel = (typeof TRIAGE_LEVELS)[number];
export const triageLevelSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
]);

/** Zona IGD: T = area triase, R = resusitasi, B = akut, K = fast track. */
export const ED_ZONES = ['T', 'R', 'B', 'K'] as const;
export type EdZone = (typeof ED_ZONES)[number];

export const ED_STATUSES = [
  'registrasi',
  'triase',
  'resusitasi',
  'pemeriksaan',
  'tunggu-dokter',
  'tunggu-lab',
  'observasi',
  'tunggu-bed',
  'siap-pulang',
] as const;
export type EdStatus = (typeof ED_STATUSES)[number];

export const edVitalSchema = z.strictObject({
  label: z.string().min(1).max(20),
  value: z.string().min(1).max(20),
  abnormal: z.boolean(),
});

export const edOrderSchema = z.strictObject({
  id,
  label: z.string().min(1).max(80),
  defaultOn: z.boolean(),
});

export const edTrackingItemSchema = z.strictObject({
  /** Id kunjungan IGD (`kj-…`; pasien tanpa identitas memakai id sementara). */
  encounterId: id,
  /** Bed IGD, null = belum ditempatkan (masih di area triase). */
  bed: z.string().min(1).max(10).nullable(),
  zone: z.enum(ED_ZONES),
  /** Null = pasien tanpa identitas (Mr./Mrs. X), identitas menyusul. */
  patientId: id.nullable(),
  patientName: z.string().min(1).max(80),
  rm: z.string().nullable(),
  sex: z.enum(['L', 'P']),
  ageLabel: z.string().min(1).max(20),
  guarantor: z.string().min(1).max(40),
  /** Null = belum ditriase. */
  triageLevel: triageLevelSchema.nullable(),
  /** Saran sistem dari keluhan + tanda vital. */
  suggestedLevel: triageLevelSchema,
  /** Level paling tidak mendesak yang diizinkan protokol (mis. nyeri dada: maksimal level 3). */
  maxLevel: triageLevelSchema,
  chiefComplaint: z.string().min(1).max(120),
  doctor: z.string().min(1).max(80).nullable(),
  arrivedAt: isoDateTime,
  /** Lama di IGD saat data diambil (menit); layar menghitung maju secara langsung. */
  losMinutes: z
    .int()
    .min(0)
    .max(7 * 1440),
  status: z.enum(ED_STATUSES),
  arrivalMode: z.string().min(1).max(40),
  vitals: z.array(edVitalSchema).max(8),
  /** Penjelasan saran sistem untuk level yang disarankan. */
  recommendation: z.string().min(1).max(300),
  orderTitle: z.string().min(1).max(80),
  orders: z.array(edOrderSchema).max(6),
  /** Pasien skenario Simulasi (keadaannya mengikuti mesin skenario). */
  scenario: z.boolean(),
});
export type EdTrackingItem = z.infer<typeof edTrackingItemSchema>;

export const edBoardSchema = z.strictObject({
  asOf: isoDateTime,
  /** Kapasitas bed IGD (selaras Dasbor direksi). */
  capacity: z.int().positive(),
  ambulancesIncoming: z.int().min(0),
  doctorWaitMedianMinutes: z.int().min(0),
  leftWithoutBeingSeen24h: z.int().min(0),
  items: z.array(edTrackingItemSchema),
});
export type EdBoard = z.infer<typeof edBoardSchema>;

/**
 * Asesmen triase yang disimpan. Saran sistem dan batas protokol (`suggestedLevel`, `maxLevel`) bukan masukan klien:
 * server mencari pasien IGD-nya sendiri, lalu menegakkan gerbang (level di bawah saran = override yang wajib
 * beralasan, level di atas batas protokol ditolak; CLAUDE.md §4.9).
 */
export const triageAssessmentSchema = z.strictObject({
  encounterId: id,
  chosenLevel: triageLevelSchema,
  overrideReason: z.string().trim().max(500).nullable(),
  orders: z.array(z.string().min(1).max(60)).max(6),
});
export type TriageAssessment = z.infer<typeof triageAssessmentSchema>;

// ---------------------------------------------------------------------------------------------------------
// K05 · Tempat tidur (bed management)
// ---------------------------------------------------------------------------------------------------------

/** Status bed. `pulang` = terisi, pasien rencana pulang hari ini. Status selalu tampil sebagai teks. */
export const BED_STATUSES = ['siap', 'terisi', 'pulang', 'dipesan', 'kotor', 'dibersihkan', 'rusak'] as const;
export type BedStatus = (typeof BED_STATUSES)[number];
/** Status yang dihitung "terisi" untuk BOR (pasien masih di bed). */
export const OCCUPIED_BED_STATUSES: readonly BedStatus[] = ['terisi', 'pulang'];

export const WARD_CLASSES = ['VIP', 'Kelas 1', 'Kelas 2', 'Kelas 3', 'ICU', 'HCU', 'Isolasi'] as const;
export type WardClass = (typeof WARD_CLASSES)[number];

export const wardSchema = z.strictObject({
  code: z.string().min(1).max(20),
  name: z.string().min(1).max(60),
  kelas: z.enum(WARD_CLASSES),
  /** Layanan utama ruang, mis. "Penyakit dalam". */
  service: z.string().min(1).max(40),
  beds: z.int().positive(),
});
export type Ward = z.infer<typeof wardSchema>;

export const bedSchema = z.strictObject({
  code: z.string().min(1).max(12),
  wardCode: z.string().min(1).max(20),
  status: z.enum(BED_STATUSES),
  /** Label pasien tersamar (mis. "Ny. E. W.") atau nama pasien skenario; null bila bed kosong. */
  patientLabel: z.string().min(1).max(60).nullable(),
  /** Kunjungan rawat inap untuk tautan ke layar rawat inap; null bila tidak ditautkan. */
  encounterId: id.nullable(),
  note: text(80),
});
export type Bed = z.infer<typeof bedSchema>;

export const bedCandidateSchema = z.strictObject({
  bedCode: z.string().min(1).max(12),
  label: z.string().min(1).max(60),
  note: text(80),
});

export const bedRequestSchema = z.strictObject({
  id,
  patientName: z.string().min(1).max(80),
  sex: z.enum(['L', 'P']),
  ageYears: z.int().min(0).max(130),
  rm: z.string().nullable(),
  /** Asal permintaan, mis. "IGD B5" atau "Jadwal OK Sel 13 Okt 07.30". */
  from: z.string().min(1).max(60),
  /** Kebutuhan ruang, mis. "Bedah · kelas 1 · Asuransi". */
  need: z.string().min(1).max(80),
  kelas: z.enum(WARD_CLASSES),
  /** Menit menunggu; null = permintaan terjadwal (elektif). */
  waitMinutes: z.int().min(0).nullable(),
  /** Menunggu lebih dari target (boarding IGD > 4 jam). */
  late: z.boolean(),
  /** Bed yang cocok (hak kelas, jenis ruang, isolasi). */
  candidates: z.array(bedCandidateSchema).max(4),
  /** Skenario Simulasi pemilik permintaan ini, null untuk permintaan biasa. */
  scenario: z.enum(['igd-ranap', 'elektif-btn']).nullable(),
});
export type BedRequest = z.infer<typeof bedRequestSchema>;

export const bedBoardSchema = z.strictObject({
  asOf: isoDateTime,
  wards: z.array(wardSchema).min(1),
  beds: z.array(bedSchema),
  requests: z.array(bedRequestSchema),
});
export type BedBoard = z.infer<typeof bedBoardSchema>;

export const bedAllocationInputSchema = z.strictObject({
  requestId: id,
  bedCode: z.string().min(1).max(12),
});

// ---------------------------------------------------------------------------------------------------------
// K04/K07/K12 · Rawat inap: CPPT terintegrasi, eMAR, observasi + EWS
// ---------------------------------------------------------------------------------------------------------

/** Profesi pemberi asuhan (PPA) penulis CPPT. */
export const CPPT_ROLES = ['dpjp', 'residen', 'perawat', 'bidan', 'farmasi', 'gizi'] as const;
export type CpptRole = (typeof CPPT_ROLES)[number];

/**
 * Satu entri CPPT (SOAP). Immutable: koreksi = entri baru `version + 1` yang menunjuk `supersedesId` dengan
 * `correctionReason`; entri lama tetap tampil sebagai riwayat.
 */
export const cpptEntrySchema = z
  .strictObject({
    id,
    encounterId: id,
    role: z.enum(CPPT_ROLES),
    author: z.string().min(1).max(80),
    writtenAt: isoDateTime,
    s: text(1000),
    o: text(1000),
    a: text(1000),
    p: text(1000),
    version: z.int().min(1),
    supersedesId: id.nullable(),
    correctionReason: z.string().max(500).nullable(),
    /** Addendum PPA lain atas entri final: entri baru yang menunjuk entri itu tanpa menggantikannya. */
    addendumOf: id.nullable(),
    /** Catatan residen wajib co-sign DPJP. */
    cosignRequired: z.boolean(),
    cosignedBy: z.string().min(1).max(80).nullable(),
    cosignedAt: isoDateTime.nullable(),
  })
  .superRefine((v, ctx) => {
    const isCorrection = v.version > 1;
    if (isCorrection !== (v.supersedesId !== null) || isCorrection !== (v.correctionReason !== null)) {
      ctx.addIssue({
        code: 'custom',
        path: ['supersedesId'],
        message: 'Koreksi (versi > 1) wajib menunjuk entri lama dan menyertakan alasan koreksi.',
      });
    }
    if (v.addendumOf !== null && v.supersedesId !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['addendumOf'],
        message: 'Entri CPPT adalah koreksi atau addendum, tidak keduanya.',
      });
    }
    if ((v.cosignedBy === null) !== (v.cosignedAt === null)) {
      ctx.addIssue({ code: 'custom', path: ['cosignedAt'], message: 'Co-sign wajib bernama dan berwaktu.' });
    }
  });
export type CpptEntry = z.infer<typeof cpptEntrySchema>;

/**
 * Input CPPT baru, koreksi (versi baru, hanya oleh penulisnya, wajib alasan), atau addendum PPA lain. S dan A wajib.
 * Penulis, waktu, dan izin koreksi ditentukan server, bukan klien.
 */
export const cpptNoteInputSchema = z
  .strictObject({
    encounterId: id,
    s: z.string().trim().min(1, 'S wajib diisi.').max(1000),
    o: z.string().trim().max(1000),
    a: z.string().trim().min(1, 'A wajib diisi.').max(1000),
    p: z.string().trim().max(1000),
    supersedesId: id.nullable(),
    correctionReason: z.string().trim().max(500).nullable(),
    addendumOf: id.nullable(),
  })
  .superRefine((v, ctx) => {
    if (v.supersedesId !== null && (v.correctionReason ?? '').length < SAFETY_REASON_MIN) {
      ctx.addIssue({
        code: 'custom',
        path: ['correctionReason'],
        message: `Alasan koreksi wajib (minimal ${SAFETY_REASON_MIN} karakter).`,
      });
    }
    if (v.supersedesId !== null && v.addendumOf !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['addendumOf'],
        message: 'Pilih koreksi atau addendum, tidak keduanya.',
      });
    }
  });
export type CpptNoteInput = z.infer<typeof cpptNoteInputSchema>;

/**
 * Jam grid eMAR mode presentasi (dibekukan). Jalur api: jam dinamis dari frekuensi order (`emarScheduleTimes`), jadi
 * `EmarTime` = jam WIB `HH.MM` apa pun.
 */
export const EMAR_TIMES = ['06.00', '08.00', '12.00', '18.00', '22.00'] as const;
export type EmarTime = string;
const emarTime = z.string().regex(/^([01]\d|2[0-3])\.[0-5]\d$/, 'Jam HH.MM');

export const emarSlotSchema = z.strictObject({
  time: emarTime,
  state: z.enum(EMAR_SLOT_STATES),
  /** Teks slot, mis. "08.05" (jam diberikan), "Ditunda · mual"; kosong untuk slot tanpa jadwal. */
  label: text(40),
});
export type EmarSlot = z.infer<typeof emarSlotSchema>;

export const emarMedicationSchema = z.strictObject({
  id,
  name: z.string().min(1).max(80),
  /** Aturan pakai: rute · frekuensi · keterangan. */
  sig: z.string().min(1).max(80),
  /** Kode KFA 8 digit, null = belum dipetakan. */
  kfa: z
    .string()
    .regex(/^\d{8}$/)
    .nullable(),
  highAlert: z.boolean(),
  slots: z.array(emarSlotSchema).min(1).max(24),
});
export type EmarMedication = z.infer<typeof emarMedicationSchema>;

/**
 * Identitas pasien di eMAR: kode gelang hasil pindai (dicocokkan server dengan RM pasien kunjungan), atau override
 * verifikasi manual dua identitas dengan alasan (`wristbandCode` null).
 */
const wristbandFields = {
  wristbandCode: z.string().trim().min(1).max(40).nullable(),
  scanOverrideReason: z.string().trim().max(500).nullable(),
};

function requireOverrideReason(
  v: { wristbandCode: string | null; scanOverrideReason: string | null },
  ctx: z.RefinementCtx,
): void {
  if (v.wristbandCode === null && (v.scanOverrideReason ?? '').length < SAFETY_REASON_MIN) {
    ctx.addIssue({
      code: 'custom',
      path: ['scanOverrideReason'],
      message: `Pemberian tanpa pindai gelang wajib beralasan (minimal ${SAFETY_REASON_MIN} karakter).`,
    });
  }
}

/** Pindai gelang sebelum pemberian obat: membuka grid eMAR bila cocok (atau override beralasan). */
export const emarWristbandScanInputSchema = z
  .strictObject({ encounterId: id, ...wristbandFields })
  .superRefine(requireOverrideReason);
export type EmarWristbandScanInput = z.infer<typeof emarWristbandScanInputSchema>;

/**
 * Pencatatan pemberian satu dosis (satu obat, satu slot jadwal): identitas pasien seperti pindai gelang + kode label
 * obat hasil pindai (dicocokkan server dengan obat jadwal). Slot, status terlambat, dan sifat kewaspadaan tinggi
 * dibaca server dari eMAR pasien, bukan dari klien.
 */
export const emarAdministrationInputSchema = z
  .strictObject({
    encounterId: id,
    medicationId: id,
    time: emarTime,
    ...wristbandFields,
    /** Kode label obat dari farmasi (hasil pindai). */
    labelCode: z.string().trim().min(1).max(60),
    /** Wajib untuk slot terlambat (diperiksa server); bila diisi minimal 10 karakter. */
    lateReason: z.string().trim().min(SAFETY_REASON_MIN).max(500).nullable(),
    /** Obat kewaspadaan tinggi: nama perawat kedua yang melakukan cek ganda (wajib, diperiksa server). */
    doubleCheckedBy: z.string().trim().max(80).nullable(),
  })
  .superRefine(requireOverrideReason);
export type EmarAdministrationInput = z.infer<typeof emarAdministrationInputSchema>;

/** Tingkat kesadaran ACVPU (C = bingung baru); sama dengan masukan NEWS2. */
export const CONSCIOUSNESS = NEWS2_CONSCIOUSNESS;

export const ewsObservationSchema = z.strictObject({
  at: isoDateTime,
  temp: z.number().min(30).max(45),
  hr: z.int().min(20).max(250),
  rr: z.int().min(4).max(60),
  sbp: z.int().min(40).max(260),
  dbp: z.int().min(20).max(160),
  spo2: z.int().min(50).max(100),
  onOxygen: z.boolean(),
  consciousness: z.enum(CONSCIOUSNESS),
  /** Skor EWS dewasa (dihitung dari parameter di atas). */
  score: z.int().min(0).max(20),
});
export type EwsObservation = z.infer<typeof ewsObservationSchema>;

export const clinicalResultSchema = z.strictObject({
  at: isoDateTime,
  name: z.string().min(1).max(80),
  value: z.string().min(1).max(160),
  flag: z.enum(['normal', 'tinggi', 'rendah', 'kritis']),
});
export type ClinicalResult = z.infer<typeof clinicalResultSchema>;

export const nursingProblemSchema = z.strictObject({
  diagnosis: z.string().min(1).max(80),
  interventions: z.array(z.strictObject({ id, label: z.string().min(1).max(100), done: z.boolean() })).min(1),
});

export const codedDiagnosisSchema = z.strictObject({
  system: z.enum(['ICD-10', 'ICD-9-CM']),
  code: z.string().regex(/^[A-Z]?\d{2}(\.\d{1,2})?$/),
  label: z.string().min(1).max(80),
  primary: z.boolean(),
});
export type CodedDiagnosis = z.infer<typeof codedDiagnosisSchema>;

export const INPATIENT_FLAGS = [
  'cosign',
  'emar-terlambat',
  'rencana-pulang',
  'risiko-jatuh',
  'isolasi',
] as const;
export type InpatientFlag = (typeof INPATIENT_FLAGS)[number];

export const inpatientSummarySchema = z.strictObject({
  encounterId: id,
  patientId: id,
  wardCode: z.string().min(1).max(20),
  bed: z.string().min(1).max(12),
  dpjp: z.string().min(1).max(80),
  diagnoses: z.array(codedDiagnosisSchema).min(1),
  admittedOn: isoDate,
  /** Hari rawat ke-n (hari masuk = 1). */
  day: z.int().min(1),
  lastEws: z.int().min(0).max(20),
  /** Skor parameter tunggal tertinggi pada observasi terakhir (NEWS2: nilai 3 → minimal respons urgen). */
  lastEwsMaxParam: z.int().min(0).max(3),
  flags: z.array(z.enum(INPATIENT_FLAGS)),
  /** Ringkasan risiko untuk banner, mis. "Risiko jatuh sedang · Morse 35". */
  risk: z.string().max(80),
  scenario: z.boolean(),
});
export type InpatientSummary = z.infer<typeof inpatientSummarySchema>;

export const inpatientDetailSchema = z.strictObject({
  summary: inpatientSummarySchema,
  /** Rencana terapi singkat untuk tab ringkasan. */
  plan: z.string().min(1).max(300),
  cppt: z.array(cpptEntrySchema),
  medications: z.array(emarMedicationSchema),
  /** Jam "sekarang" pada grid eMAR (slot `jadwal` = bisa diberikan). */
  emarNow: emarTime,
  /** Keterangan pemberian berikutnya, mis. "GDS 12.00: 236 mg/dL → skala 6 unit SC". */
  emarNote: z.string().max(160),
  observations: z.array(ewsObservationSchema),
  results: z.array(clinicalResultSchema),
  nursing: z.array(nursingProblemSchema),
});
export type InpatientDetail = z.infer<typeof inpatientDetailSchema>;

// ---------------------------------------------------------------------------------------------------------
// K13 · Resume medis pulang
// ---------------------------------------------------------------------------------------------------------

export const RESUME_SOURCES = [
  'asesmen-igd',
  'cppt',
  'observasi',
  'hasil',
  'emar',
  'laporan-operasi',
  'rekonsiliasi',
  'dpjp',
  'surat-kontrol',
] as const;

export const resumeSectionSchema = z.strictObject({
  id,
  title: z.string().min(1).max(80),
  /** Isi; kosong = belum terhimpun dari sumbernya. */
  body: text(1200),
  source: z.enum(RESUME_SOURCES),
});
export type ResumeSection = z.infer<typeof resumeSectionSchema>;

export const dischargeMedicationSchema = z.strictObject({
  name: z.string().min(1).max(80),
  sig: z.string().min(1).max(80),
  change: z.enum(['baru', 'lanjut', 'ubah-dosis', 'dihentikan']),
});

/** 12 butir kelengkapan resume (urutan tetap). */
export const RESUME_CHECK_IDS = [
  'ident',
  'anamnesis',
  'fisik',
  'penunjang',
  'diagnosis',
  'prosedur',
  'terapi',
  'rekonsiliasi',
  'edukasi',
  'instruksi',
  'kontrol',
  'kondisi',
] as const;
export type ResumeCheckId = (typeof RESUME_CHECK_IDS)[number];

export const dischargeSummarySchema = z.strictObject({
  encounterId: id,
  patientId: id,
  admittedAt: isoDateTime,
  dischargeAt: isoDateTime,
  admissionVia: z.string().min(1).max(40),
  dischargeMethod: z.string().min(1).max(60),
  condition: z.string().min(1).max(40),
  location: z.string().min(1).max(60),
  dpjp: z.string().min(1).max(80),
  sections: z.array(resumeSectionSchema).min(7).max(8),
  medications: z.array(dischargeMedicationSchema),
  /** Waktu konfirmasi rekonsiliasi obat pulang oleh DPJP; null = belum. */
  reconciliationConfirmedAt: isoDateTime.nullable(),
  codes: z.array(codedDiagnosisSchema),
  checklist: z
    .array(
      z.strictObject({ id: z.enum(RESUME_CHECK_IDS), label: z.string().min(1).max(80), done: z.boolean() }),
    )
    .length(RESUME_CHECK_IDS.length),
  /** TTE DPJP; setelah final hanya addendum berversi. */
  signedAt: isoDateTime.nullable(),
  signedBy: z.string().min(1).max(80).nullable(),
});
export type DischargeSummary = z.infer<typeof dischargeSummarySchema>;

// ---------------------------------------------------------------------------------------------------------
// K11 · Persetujuan tindakan (tablet)
// ---------------------------------------------------------------------------------------------------------

export const consentDocumentSchema = z.strictObject({
  id,
  encounterId: id,
  patientId: id,
  procedure: z.string().min(1).max(80),
  /** Yang memberi persetujuan, mis. "Pasien sendiri (kompeten)". */
  consentGiver: z.string().min(1).max(60),
  doctor: z.string().min(1).max(80),
  informer: z.string().min(1).max(80),
  explainedAt: isoDateTime,
  explanationMinutes: z.int().min(1).max(120),
  location: z.string().min(1).max(40),
  /** Tujuh butir informasi wajib (diagnosis, tindakan, cara, risiko, komplikasi, alternatif, prognosis). */
  items: z
    .array(z.strictObject({ id, title: z.string().min(1).max(60), body: z.string().min(1).max(300) }))
    .length(7),
  signerName: z.string().min(1).max(80),
  witness: z.strictObject({ name: z.string().min(1).max(80), relation: z.string().min(1).max(30) }),
  staffWitness: z.string().min(1).max(80),
  status: z.enum(['draf', 'final', 'ditolak']),
  finalAt: isoDateTime.nullable(),
});
export type ConsentDocument = z.infer<typeof consentDocumentSchema>;

export const signatureSchema = z.strictObject({
  /** `goresan` = digambar di bantalan; `nama` = alternatif ketik nama (aksesibilitas). */
  method: z.enum(['goresan', 'nama']),
  name: z.string().trim().min(3).max(80),
});

export const consentFinalizeInputSchema = z.strictObject({
  consentId: id,
  acknowledged: z.array(id).length(7),
  patient: signatureSchema,
  witness: signatureSchema,
  staffWitnessPresent: z.literal(true),
});

export const consentRefusalInputSchema = z.strictObject({
  consentId: id,
  reason,
});

// ===============================================================================================================
// Kontrak API fase 3 (rencana §3.0a): CPPT, triase, eMAR jalur api. ID UUID; penulis + waktu catat dari server.
// ===============================================================================================================

const uuid = z.uuid();
const instant = z.iso.datetime({ offset: true });
const longText = (max: number) => z.string().trim().max(max);

/**
 * Status tampilan CPPT: catatan residen `menunggu_cosign` sampai DPJP co-sign (keputusan fase 3 no. 4); di database
 * status tetap `final`/`entered_in_error`, menunggu co-sign = `cosign_required` tanpa atestasi co-sign.
 */
export const CPPT_STATUSES = ['menunggu_cosign', 'final', 'entered_in_error'] as const;
export type CpptStatus = (typeof CPPT_STATUSES)[number];

/** Isi CPPT: SOAP (medis/keperawatan/farmasi) atau ADIME (gizi). */
export const cpptContentSchema = z.discriminatedUnion('format', [
  z.strictObject({
    format: z.literal('soap'),
    s: longText(2000).min(1, 'S wajib diisi.'),
    o: longText(2000),
    a: longText(2000).min(1, 'A wajib diisi.'),
    p: longText(2000),
  }),
  z.strictObject({
    format: z.literal('adime'),
    assessment: longText(2000).min(1, 'Asesmen wajib diisi.'),
    diagnosis: longText(1000),
    intervention: longText(2000),
    monitoring: longText(1000),
    evaluation: longText(1000),
  }),
]);
export type CpptContent = z.infer<typeof cpptContentSchema>;

/** `POST /api/v1/cppt/entries`. PPA, penulis, waktu catat, dan kebutuhan co-sign ditentukan server dari sesi. */
export const cpptCreateInputSchema = z.strictObject({
  encounterId: uuid,
  occurredAt: instant,
  content: cpptContentSchema,
  /** Instruksi PPA (mis. instruksi DPJP ke perawat). */
  instruction: longText(2000).nullable(),
  revision: clinicalRevisionSchema,
});
export type CpptCreateInput = z.infer<typeof cpptCreateInputSchema>;

export const cpptRecordSchema = clinicalEntryMetaSchema.extend({
  encounterId: uuid,
  patientId: uuid,
  ppa: z.enum(CPPT_ROLES),
  content: cpptContentSchema,
  instruction: z.string().nullable(),
  status: z.enum(CPPT_STATUSES),
  cosignRequired: z.boolean(),
  cosign: clinicalAttestationSchema.nullable(),
  /** Verifikasi DPJP atas CPPT PPA lain (keputusan fase 3 no. 5). */
  verification: clinicalAttestationSchema.nullable(),
  /** Singkatan terlarang di isi (peringatan EP 9a, tidak memblokir). */
  abbreviationWarnings: z.array(z.string()),
});
export type CpptRecord = z.infer<typeof cpptRecordSchema>;

/** Serah terima SBAR antarshift/antarunit. */
export const handoverInputSchema = z.strictObject({
  encounterId: uuid,
  occurredAt: instant,
  situation: longText(1000).min(1),
  background: longText(1000),
  assessment: longText(1000).min(1),
  recommendation: longText(1000).min(1),
  /** Penerima serah terima (pengguna), null bila ke unit/shift berikutnya secara umum. */
  toUserId: uuid.nullable(),
});
export type HandoverInput = z.infer<typeof handoverInputSchema>;

/** Arah tanda vital IGD (utang fase 2: kontrak membawa bendera, bukan diturunkan UI). */
export const VITAL_DIRECTIONS = ['tinggi', 'rendah'] as const;

/**
 * `POST /api/v1/triage/assessments`. Saran (`suggestTriage`) dan batas protokol dihitung server dari tanda vital +
 * diskriminator; turun dari saran tanpa alasan → 422 `TRIAGE_REASON_REQUIRED`, di bawah batas protokol → 422
 * `TRIAGE_LEVEL_NOT_ALLOWED`. Berversi (koreksi lewat `revision`).
 */
export const triageAssessmentInputSchema = z.strictObject({
  encounterId: uuid,
  occurredAt: instant,
  vitals: triageVitalsSchema,
  discriminators: z.array(z.enum(TRIAGE_DISCRIMINATOR_CODES)).max(6),
  chosenLevel: triageLevelSchema,
  overrideReason: z.string().trim().max(500).nullable(),
  revision: clinicalRevisionSchema,
});
export type TriageAssessmentInput = z.infer<typeof triageAssessmentInputSchema>;

export const triageAssessmentRecordSchema = clinicalEntryMetaSchema.extend({
  encounterId: uuid,
  vitals: triageVitalsSchema,
  discriminators: z.array(z.enum(TRIAGE_DISCRIMINATOR_CODES)),
  suggestedLevel: triageLevelSchema,
  maxLevel: triageLevelSchema,
  chosenLevel: triageLevelSchema,
  overrideReason: z.string().nullable(),
  /** Alasan saran sistem (teks untuk petugas). */
  reasons: z.array(z.string()),
});
export type TriageAssessmentRecord = z.infer<typeof triageAssessmentRecordSchema>;

/**
 * `POST /api/v1/nursing/wristband-scans`: kode gelang hasil pindai. Tidak ada jalur melewati pindai (keputusan fase 3
 * no. 8); tidak cocok → tercatat + 422 `WRISTBAND_MISMATCH`.
 */
export const wristbandScanInputSchema = z.strictObject({
  encounterId: uuid,
  code: z.string().trim().min(1).max(64),
});
export type WristbandScanInput = z.infer<typeof wristbandScanInputSchema>;

/**
 * `POST /api/v1/nursing/administrations`. Wajib `scanId` pindaian cocok ≤ `emar.scan_valid_minutes` oleh perawat yang
 * sama (dijaga juga trigger database). Ditunda/ditolak/terlambat wajib alasan; obat kewaspadaan tinggi wajib cek ganda
 * perawat kedua.
 */
export const medicationAdministrationInputSchema = z
  .strictObject({
    medicationRequestId: uuid,
    /** Jadwal dosis; null untuk PRN/stat. */
    scheduleId: uuid.nullable(),
    scanId: uuid,
    /** Kode label obat dari farmasi (hasil pindai), dicocokkan server dengan obat order. */
    labelCode: z.string().trim().min(1).max(64),
    status: z.enum(MEDICATION_ADMINISTRATION_STATUSES),
    occurredAt: instant,
    reason: z.string().trim().max(500).nullable(),
    doubleCheckUserId: uuid.nullable(),
    /** Atestasi dosis oleh sesi perawat kedua (3.5); ID petugas saja tidak cukup. */
    doubleCheckId: uuid.nullable().default(null),
  })
  .superRefine((v, ctx) => {
    if (v.status !== 'given' && (v.reason ?? '').length < SAFETY_REASON_MIN) {
      ctx.addIssue({
        code: 'custom',
        path: ['reason'],
        message: `Dosis ditunda/ditolak wajib beralasan (minimal ${SAFETY_REASON_MIN} karakter).`,
      });
    }
  });
export type MedicationAdministrationInput = z.infer<typeof medicationAdministrationInputSchema>;

/** Satu slot jadwal eMAR jalur api (jam dinamis dari frekuensi order). */
export const emarScheduleSlotSchema = z.strictObject({
  scheduleId: uuid,
  scheduledAt: instant,
  time: emarTime,
  state: z.enum(EMAR_SLOT_STATES),
  administration: z
    .strictObject({
      id: uuid,
      status: z.enum(MEDICATION_ADMINISTRATION_STATUSES),
      at: instant,
      by: clinicalAuthorSchema,
      late: z.boolean(),
      reason: z.string().nullable(),
      doubleCheckedBy: clinicalAuthorSchema.nullable(),
    })
    .nullable(),
});
export type EmarScheduleSlot = z.infer<typeof emarScheduleSlotSchema>;

export const emarOrderSchema = z.strictObject({
  medicationRequestId: uuid,
  name: z.string().min(1).max(120),
  /** Aturan pakai tampilan: dosis · rute · frekuensi. */
  sig: z.string().min(1).max(160),
  frequency: z.enum(MEDICATION_FREQUENCY_CODES),
  kfa: z
    .string()
    .regex(/^\d{8}$/)
    .nullable(),
  highAlert: z.boolean(),
  slots: z.array(emarScheduleSlotSchema),
});
export type EmarOrder = z.infer<typeof emarOrderSchema>;

// ---------------------------------------------------------------------------------------------------------------
// Kanal SSE klinis (potongan 3.1, ADR-0026): papan IGD, papan bed, eskalasi EWS. Muatan hanya ID, kode status, dan
// angka; tanpa nama/diagnosis (aliran staf diaudit saat berlangganan).
// ---------------------------------------------------------------------------------------------------------------

/** Kanal `pg_notify` (trigger `app_notify_row`). */
export const CLINICAL_NOTIFY_CHANNELS = {
  edBoard: 'ed_board',
  bedBoard: 'bed_board',
  vitals: 'clinical_vitals',
} as const;

export const CLINICAL_SSE_EVENTS = {
  /** Potret papan IGD saat (sambung ulang) berlangganan, tanpa `id:`. */
  edBoard: 'ed.board',
  edStatus: 'ed.status',
  /** Isi papan IGD berubah selain status alur: kunjungan masuk/keluar, triase, permintaan bed, tim (ADR-0104). */
  edChanged: 'ed.changed',
  /** Potret papan bed saat (sambung ulang) berlangganan, tanpa `id:`. */
  bedBoard: 'bed.board',
  bedStatus: 'bed.status',
  /** Permintaan bed dibuat/dialokasikan/ditutup (ADR-0104). */
  bedRequest: 'bed.request',
  ewsEscalation: 'ews.escalation',
} as const;

/** Sumber perubahan papan IGD di event `ed.changed`. */
export const ED_CHANGE_SOURCES = ['encounter', 'triage', 'bed_request', 'care_team'] as const;
export const edChangedSseEventSchema = z.strictObject({
  /** Id baris sumber (kunjungan, asesmen triase, atau permintaan bed). */
  sourceId: uuid,
  source: z.enum(ED_CHANGE_SOURCES),
  encounterId: uuid,
  unitId: uuid,
  at: instant,
});
export type EdChangedSseEvent = z.infer<typeof edChangedSseEventSchema>;

export const edStatusSseEventSchema = z.strictObject({
  eventId: uuid,
  encounterId: uuid,
  /** Unit kunjungan IGD (dasar saringan lingkup unit). */
  unitId: uuid,
  status: z.enum(ED_STATUSES),
  zone: z.enum(ED_ZONES).nullable(),
  at: instant,
});
export type EdStatusSseEvent = z.infer<typeof edStatusSseEventSchema>;

export const bedStatusSseEventSchema = z.strictObject({
  eventId: uuid,
  /** Lokasi bed (`locations.id`). */
  bedId: uuid,
  unitId: uuid,
  status: z.enum(BED_STATUSES),
  version: z.int().min(1),
  at: instant,
});
export type BedStatusSseEvent = z.infer<typeof bedStatusSseEventSchema>;

export const ewsEscalationSseEventSchema = z.strictObject({
  observationId: uuid,
  encounterId: uuid,
  /** Unit tempat pasien kini (bed atau unit kunjungan), dasar saringan lingkup unit. */
  unitId: uuid.nullable(),
  score: z.int().min(0).max(20),
  maxParam: z.int().min(0).max(3),
  risk: z.enum(['rendah', 'sedang', 'tinggi']),
  at: instant,
});
export type EwsEscalationSseEvent = z.infer<typeof ewsEscalationSseEventSchema>;

// ===============================================================================================================
// K03/K04/K05 · ADT, papan bed, triase IGD, gelang (potongan 3.3). Jawaban papan memakai label pasien seperlunya:
// papan bed hanya inisial; papan IGD nama lengkap (staf klinis IGD, diaudit per pasien).
// ===============================================================================================================

/** Cara pulang (disposisi). `rawat_inap` hanya untuk kunjungan IGD yang dilanjutkan admisi (keputusan fase 3 no. 7). */
export const DISCHARGE_DISPOSITIONS = [
  'pulang',
  'rujuk',
  'pulang_paksa',
  'meninggal',
  'pindah_rawat',
] as const;
export type DischargeDisposition = (typeof DISCHARGE_DISPOSITIONS)[number];
export const ENCOUNTER_DISPOSITIONS = [...DISCHARGE_DISPOSITIONS, 'rawat_inap'] as const;
export type EncounterDisposition = (typeof ENCOUNTER_DISPOSITIONS)[number];

export const BED_REQUEST_ORIGINS = ['igd', 'ok', 'poli', 'lainnya'] as const;
export const BED_REQUEST_STATUSES = ['menunggu', 'dialokasi', 'selesai', 'batal'] as const;
export type BedRequestStatus = (typeof BED_REQUEST_STATUSES)[number];

export const bedRequestSseEventSchema = z.strictObject({
  requestId: uuid,
  /** Unit tujuan (bed yang dialokasikan, atau unit yang diminta); null = bangsal mana pun. */
  unitId: uuid.nullable(),
  status: z.enum(BED_REQUEST_STATUSES),
  at: instant,
});
export type BedRequestSseEvent = z.infer<typeof bedRequestSseEventSchema>;

/**
 * Perubahan status bed manual di papan (`PATCH /adt/beds/:id/status`). `dipesan`/`terisi` hanya lewat alokasi/admisi,
 * `kotor` otomatis saat pulang/transfer; petugas menandai pulang hari ini, membersihkan, merusak, dan memulihkan.
 */
export const MANUAL_BED_TRANSITIONS: Readonly<Record<BedStatus, readonly BedStatus[]>> = {
  siap: ['rusak', 'kotor'],
  dipesan: [],
  terisi: ['pulang'],
  pulang: ['terisi'],
  kotor: ['dibersihkan', 'siap', 'rusak'],
  dibersihkan: ['siap', 'kotor'],
  rusak: ['siap', 'kotor'],
};

export function manualBedTransitionAllowed(from: BedStatus, to: BedStatus): boolean {
  return MANUAL_BED_TRANSITIONS[from].includes(to);
}

const safety = z.string().trim().min(SAFETY_REASON_MIN).max(500);

export const bedStatusChangeInputSchema = z.strictObject({
  status: z.enum(BED_STATUSES),
  /** Versi status yang dilihat petugas (konkurensi optimistis; beda → 409 `BED_VERSION_CONFLICT`). */
  baseVersion: z.int().min(1),
  note: longText(200).nullable(),
});
export type BedStatusChangeInput = z.infer<typeof bedStatusChangeInputSchema>;

export const bedRequestInputSchema = z.strictObject({
  /** Kunjungan asal (IGD, RJ, atau admisi `planned`). */
  encounterId: uuid,
  origin: z.enum(BED_REQUEST_ORIGINS),
  careClass: z.enum(CARE_CLASSES),
  /** Bangsal yang diminta; null = bangsal mana pun sesuai kelas. */
  unitId: uuid.nullable(),
  isolation: z.boolean(),
  note: longText(300).nullable(),
});
export type BedRequestInput = z.infer<typeof bedRequestInputSchema>;

export const bedAllocateInputSchema = z.strictObject({ locationId: uuid });
export const bedRequestCancelInputSchema = z.strictObject({ reason: safety });

/**
 * Admisi nyata: kunjungan rawat inap `planned` (dari registrasi admisi fase 2: SPRI atau kunjungan IGD/RJ asal) masuk
 * bed. Bed harus `siap` atau `dipesan` untuk kunjungan ini. BPJS tanpa SEP rawat inap wajib diagnosa awal.
 */
export const admitInputSchema = z.strictObject({
  encounterId: uuid,
  locationId: uuid,
  initialDiagnosis: icd10CodingSchema.nullable(),
});
export type AdmitInput = z.infer<typeof admitInputSchema>;

export const transferInputSchema = z.strictObject({
  encounterId: uuid,
  locationId: uuid,
  reason: longText(300).nullable(),
});
export type TransferInput = z.infer<typeof transferInputSchema>;

export const dischargeInputSchema = z.strictObject({
  encounterId: uuid,
  disposition: z.enum(DISCHARGE_DISPOSITIONS),
});
export type DischargeInput = z.infer<typeof dischargeInputSchema>;

export const wristbandReprintInputSchema = z.strictObject({ reason: safety });

export const edStatusInputSchema = z.strictObject({
  status: z.enum(ED_STATUSES),
  zone: z.enum(ED_ZONES).nullable(),
  /** Bed IGD (lokasi `bed` unit IGD) tempat pasien ditempatkan, bila ada. */
  locationId: uuid.nullable(),
});
export type EdStatusInput = z.infer<typeof edStatusInputSchema>;

/**
 * `POST /api/v1/triage/suggestions`: pratinjau saran ATS dari server (tanpa menyimpan) untuk tanda vital +
 * diskriminator yang sedang diisi petugas. Gerbang tetap ditegakkan ulang saat `POST /triage/assessments`.
 */
export const triageSuggestionInputSchema = z.strictObject({
  encounterId: uuid,
  vitals: triageVitalsSchema,
  discriminators: z.array(z.enum(TRIAGE_DISCRIMINATOR_CODES)).max(6),
});
export type TriageSuggestionInput = z.infer<typeof triageSuggestionInputSchema>;
export const triageSuggestionSchema = z.strictObject({
  level: triageLevelSchema,
  maxLevel: triageLevelSchema,
  reasons: z.array(z.string()),
  ageYears: z.int().min(0).max(150).nullable(),
});
export type TriageSuggestionApi = z.infer<typeof triageSuggestionSchema>;

/**
 * `POST /api/v1/registration/emergency-admissions`: keputusan rawat inap pasien IGD yang bed-nya sudah dialokasikan →
 * admisi rawat inap (`IMP`, `part_of` IGD, penjaminan IGD dibawa) + masuk bed + gelang terbit, satu transaksi
 * (keputusan fase 3 no. 7). BPJS tanpa SEP rawat inap wajib diagnosa awal.
 */
export const emergencyAdmissionInputSchema = z.strictObject({
  bedRequestId: uuid,
  /** DPJP rawat inap (praktisi dokter aktif). */
  practitionerId: uuid,
  generalConsent: generalConsentInputSchema,
  initialDiagnosis: icd10CodingSchema.nullable(),
});
export type EmergencyAdmissionInput = z.infer<typeof emergencyAdmissionInputSchema>;

/** `GET /api/v1/registration/practitioners`: dokter aktif untuk pilihan DPJP admisi (tanpa STR/SIP). */
export const practitionerOptionSchema = z.strictObject({
  id: uuid,
  name: z.string(),
  specialty: z.string().nullable(),
});
export const practitionerOptionListSchema = z.strictObject({ items: z.array(practitionerOptionSchema) });
export type PractitionerOption = z.infer<typeof practitionerOptionSchema>;

/** Hasil `POST /encounters/:id/care-team/claim` ("Ambil pasien" IGD oleh dokter jaga). */
export const careTeamClaimResultSchema = z.strictObject({
  encounterId: uuid,
  participantId: uuid,
  /** true = sudah penanggung jawab sebelumnya (tidak ada perubahan). */
  unchanged: z.boolean(),
  /** Dokter penanggung jawab sebelumnya yang digantikan (serah terima), null bila belum ada. */
  replacedUserId: uuid.nullable(),
});
export type CareTeamClaimResult = z.infer<typeof careTeamClaimResultSchema>;

/** SEP IGD (VClaim rawat jalan, poli IGD): diagnosa awal dari dokter jaga bila belum diisi saat registrasi. */
export const emergencySepInputSchema = z.strictObject({
  initialDiagnosis: icd10CodingSchema,
  note: longText(200).nullable(),
});
export type EmergencySepInput = z.infer<typeof emergencySepInputSchema>;

export const bedBoardBedSchema = z.strictObject({
  bedId: uuid,
  code: z.string(),
  room: z.string(),
  careClass: z.string().nullable(),
  status: z.enum(BED_STATUSES),
  version: z.int().min(1),
  encounterId: uuid.nullable(),
  /** Inisial pasien (mis. "E. W."), tanpa nama lengkap. */
  patientLabel: z.string().nullable(),
  since: instant,
});
export const bedBoardRequestSchema = z.strictObject({
  id: uuid,
  encounterId: uuid,
  /** Kelas kunjungan asal: `EMER` = admisi dari IGD (`/registration/emergency-admissions`), `IMP` = admisi terencana. */
  encounterClass: z.enum(['AMB', 'EMER', 'IMP']),
  /** Admisi rawat inap `planned` yang menunggu bed ini (kunjungan IMP sendiri, atau IMP ber-`source` IGD/RJ ini). */
  plannedAdmissionId: uuid.nullable(),
  patientLabel: z.string(),
  origin: z.enum(BED_REQUEST_ORIGINS),
  careClass: z.string(),
  unitId: uuid.nullable(),
  isolation: z.boolean(),
  status: z.enum(BED_REQUEST_STATUSES),
  requestedAt: instant,
  waitMinutes: z.int().min(0),
  /** Menunggu lebih dari `bed.boarding_alert_hours` (boarding IGD). */
  boarding: z.boolean(),
  allocatedBedId: uuid.nullable(),
  note: z.string().nullable(),
});

/** Status kirim Aplicare per ruang (bangsal × kelas): revisi papan vs revisi yang sudah diterima BPJS. */
export const APLICARE_SYNC_STATES = ['terkirim', 'menunggu', 'gagal'] as const;
export type AplicareSyncState = (typeof APLICARE_SYNC_STATES)[number];
export const bedBoardAplicareSchema = z.strictObject({
  unitId: uuid,
  careClass: z.string(),
  roomCode: z.string(),
  state: z.enum(APLICARE_SYNC_STATES),
  revision: z.int().min(0),
  sentRevision: z.int().min(0),
  lastErrorCode: z.string().nullable(),
  updatedAt: instant,
});
export type BedBoardAplicare = z.infer<typeof bedBoardAplicareSchema>;

export const bedBoardApiSchema = z.strictObject({
  asOf: instant,
  boardingAlertHours: z.int().min(1),
  aplicare: z.array(bedBoardAplicareSchema),
  units: z.array(
    z.strictObject({
      unitId: uuid,
      code: z.string(),
      name: z.string(),
      kind: z.string(),
      beds: z.array(bedBoardBedSchema),
    }),
  ),
  requests: z.array(bedBoardRequestSchema),
});
export type BedBoardApi = z.infer<typeof bedBoardApiSchema>;

export const edBoardItemSchema = z.strictObject({
  encounterId: uuid,
  number: z.string(),
  patientId: uuid,
  patientName: z.string(),
  rm: z.string(),
  unidentified: z.boolean(),
  sex: z.enum(PATIENT_SEXES),
  /** Umur (tahun, tanggal WIB); null bila tanggal lahir tidak diketahui. */
  ageYears: z.int().min(0).max(150).nullable(),
  arrivalMode: z.enum(ARRIVAL_MODES).nullable(),
  /** Penjamin utama aktif kunjungan IGD. */
  payer: z.strictObject({ kind: z.enum(PAYER_KINDS), name: z.string() }).nullable(),
  /**
   * Dokter penanggung jawab IGD: anggota tim `dpjp_utama` aktif (lewat "Ambil pasien"), atau praktisi kunjungan; null =
   * belum ada. `doctorUserId` = akun dokter tim (null bila hanya dari praktisi kunjungan).
   */
  doctor: z.string().nullable(),
  doctorUserId: uuid.nullable(),
  arrivedAt: instant.nullable(),
  losMinutes: z.int().min(0),
  status: z.enum(ED_STATUSES).nullable(),
  zone: z.enum(ED_ZONES).nullable(),
  bedId: uuid.nullable(),
  bedCode: z.string().nullable(),
  /** Triase final terkini (versi terbaru rantai); `id` = dasar koreksi (`revision.kind = koreksi`). */
  triage: z
    .strictObject({
      id: uuid,
      level: triageLevelSchema,
      suggestedLevel: triageLevelSchema,
      maxLevel: triageLevelSchema,
      at: instant,
      vitals: triageVitalsSchema,
      discriminators: z.array(z.enum(TRIAGE_DISCRIMINATOR_CODES)),
      reasons: z.array(z.string()),
      overrideReason: z.string().nullable(),
    })
    .nullable(),
  bedRequest: z
    .strictObject({
      id: uuid,
      status: z.enum(BED_REQUEST_STATUSES),
      waitMinutes: z.int().min(0),
      boarding: z.boolean(),
      allocatedBedCode: z.string().nullable(),
    })
    .nullable(),
  /** SEP IGD (BPJS); null bila belum ada atau bukan BPJS. */
  sep: z.strictObject({ id: uuid, status: z.enum(SEP_STATUSES), number: z.string().nullable() }).nullable(),
});
export type EdBoardItem = z.infer<typeof edBoardItemSchema>;

/** Bed unit IGD (penempatan pasien + status bertulisan berversi). */
export const edBoardBedSchema = z.strictObject({
  bedId: uuid,
  code: z.string(),
  room: z.string(),
  status: z.enum(BED_STATUSES),
  version: z.int().min(1),
  encounterId: uuid.nullable(),
});
export type EdBoardBed = z.infer<typeof edBoardBedSchema>;

/**
 * Tampilan papan IGD (ADR-0109): `klinis` (`GET /triage/board`, `clinical.read`) memuat triase; `administratif`
 * (`GET /triage/board/admission`, `encounter.read`, loket pendaftaran IGD) hanya identitas, penjamin, status alur,
 * penempatan, permintaan bed, dan SEP: `triage` selalu null.
 */
export const ED_BOARD_VIEWS = ['klinis', 'administratif'] as const;
export type EdBoardView = (typeof ED_BOARD_VIEWS)[number];

export const edBoardApiSchema = z.strictObject({
  view: z.enum(ED_BOARD_VIEWS),
  asOf: instant,
  unitId: uuid,
  unitName: z.string(),
  items: z.array(edBoardItemSchema),
  beds: z.array(edBoardBedSchema),
});
export type EdBoardApi = z.infer<typeof edBoardApiSchema>;

/**
 * Hasil admisi. Tanpa kode gelang (ADR-0109): kode hanya keluar lewat `POST /encounters/:id/wristband/print` atau
 * `/reprint` yang diaudit.
 */
export const admissionResultApiSchema = z.strictObject({
  encounterId: uuid,
  bedId: uuid,
  /** SEP rawat inap `pending` yang dibuat saat admisi (BPJS), null bila bukan BPJS atau sudah ada. */
  sepId: uuid.nullable(),
});
export type AdmissionResultApi = z.infer<typeof admissionResultApiSchema>;

/** Hasil `POST /registration/emergency-admissions` (juga untuk ulangan dengan Idempotency-Key yang sama). */
export const emergencyAdmissionResultSchema = admissionResultApiSchema.extend({
  /** Nomor kunjungan rawat inap (`RI-…`). */
  number: z.string(),
  bedCode: z.string(),
  sourceEncounterId: uuid,
});
export type EmergencyAdmissionResult = z.infer<typeof emergencyAdmissionResultSchema>;

/**
 * Data cetak gelang dengan kode (ADR-0109): hanya respons aksi cetak/cetak ulang (`POST`, diaudit `print`), tidak
 * pernah respons baca.
 */
export const wristbandPrintSchema = z.strictObject({
  encounterId: uuid,
  code: z.string(),
  patientName: z.string(),
  rm: z.string(),
  birthDate: z.string().nullable(),
  sex: z.string(),
  issuedAt: instant,
});
export type WristbandPrint = z.infer<typeof wristbandPrintSchema>;

/** `GET /encounters/:id/wristband`: gelang aktif tanpa kode (identitas pada gelang + waktu terbit). */
export const wristbandStatusSchema = wristbandPrintSchema.omit({ code: true });
export type WristbandStatus = z.infer<typeof wristbandStatusSchema>;
