import { z } from 'zod';

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

/** Alasan wajib untuk override gerbang keselamatan (triase turun, gelang eMAR, koreksi, penolakan). */
export const SAFETY_REASON_MIN = 10;
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

/** Jam pemberian obat di grid eMAR. */
export const EMAR_TIMES = ['06.00', '08.00', '12.00', '18.00', '22.00'] as const;
export type EmarTime = (typeof EMAR_TIMES)[number];
export const EMAR_SLOT_STATES = ['diberikan', 'jadwal', 'terlambat', 'ditunda', 'rencana', 'kosong'] as const;
export type EmarSlotState = (typeof EMAR_SLOT_STATES)[number];

export const emarSlotSchema = z.strictObject({
  time: z.enum(EMAR_TIMES),
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
  slots: z.array(emarSlotSchema).length(EMAR_TIMES.length),
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
    time: z.enum(EMAR_TIMES),
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

/** Tingkat kesadaran AVPU (C = bingung baru). */
export const CONSCIOUSNESS = ['A', 'C', 'V', 'P', 'U'] as const;

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
  emarNow: z.enum(EMAR_TIMES),
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
