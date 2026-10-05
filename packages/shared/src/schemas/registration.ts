import { z } from 'zod';
import { normalizePhone, PATIENT_SEXES } from '../patient';
import {
  BPJS_VISIT_KIND_CODES,
  bpjsEligibilitySchema,
  bpjsReferenceNumberSchema,
  bpjsSyncSchema,
  changeReasonSchema,
  cursorPageQuerySchema,
  icd10CodingSchema,
  POLI_CODE_PATTERN,
  referralSchema,
  serviceDateSchema,
} from './front-office';
import { bookingCodeSchema } from './booking';
import { queueTicketSchema } from './queue';

/**
 * F03/F06 · Kontrak API registrasi (rawat jalan, IGD, admisi rawat inap), penjaminan, SEP, persetujuan umum, kontak
 * penanggung jawab, dan lookup sinkron BPJS/Dukcapil (ADR-0025). Rencana fase 2 potongan 5a dan 7.
 * Registrasi wajib header `Idempotency-Key` (UUID): permintaan ulang dengan kunci sama mengembalikan hasil yang sama.
 * SEP diterbitkan lewat outbox (`bpjs.vclaim.sep.insert`): gangguan BPJS tidak menggagalkan registrasi (201, SEP
 * `pending`). Izin: `encounter.read|write|cancel`, `coverage.read|write` (SEP, lookup kepesertaan dan rujukan).
 */

const isoDateTime = z.iso.datetime({ offset: true });
const NAME = z.string().trim().min(2, 'Nama minimal 2 karakter').max(120);

// ---------------------------------------------------------------------------------------------------------------
// Kunjungan (encounter)
// ---------------------------------------------------------------------------------------------------------------

/** Kelas kunjungan = kode FHIR `Encounter.class` (v3 ActCode), sama dengan `encounters.class`; label untuk UI. */
export const ENCOUNTER_CLASSES = ['AMB', 'EMER', 'IMP'] as const;
export type EncounterClass = (typeof ENCOUNTER_CLASSES)[number];
export const ENCOUNTER_CLASS_LABEL: Record<EncounterClass, string> = {
  AMB: 'Rawat jalan',
  EMER: 'IGD',
  IMP: 'Rawat inap',
};

/**
 * Status mengikuti FHIR `Encounter.status`: `planned` (admisi rawat inap terencana), `arrived` (terdaftar, menunggu),
 * `in_progress`, `finished`, `cancelled`. Riwayat status append-only (`encounter_status_history`).
 */
export const ENCOUNTER_STATUSES = ['planned', 'arrived', 'in_progress', 'finished', 'cancelled'] as const;
export type EncounterStatus = (typeof ENCOUNTER_STATUSES)[number];
export const ENCOUNTER_STATUS_LABEL: Record<EncounterStatus, string> = {
  planned: 'Direncanakan',
  arrived: 'Terdaftar',
  in_progress: 'Dilayani',
  finished: 'Selesai',
  cancelled: 'Dibatalkan',
};

/** Nomor kunjungan dari layanan penomoran: `RJ-2610-000123`, `IGD-…`, `RI-…`. */
export const ENCOUNTER_NUMBER_PATTERN = /^(RJ|IGD|RI)-\d{4}-\d{6}$/;

/** Jenis penjamin (docs/04: coverages BPJS/asuransi/umum/perusahaan). */
export const PAYER_KINDS = ['bpjs', 'umum', 'asuransi', 'perusahaan'] as const;
export type PayerKind = (typeof PAYER_KINDS)[number];
export const PAYER_KIND_LABEL: Record<PayerKind, string> = {
  bpjs: 'BPJS Kesehatan',
  umum: 'Umum (bayar sendiri)',
  asuransi: 'Asuransi swasta',
  perusahaan: 'Perusahaan',
};

/** Hak kelas rawat peserta JKN (`coverages.class_entitlement`). */
export const JKN_CLASS_RIGHTS = ['kelas_1', 'kelas_2', 'kelas_3'] as const;
export type JknClassRight = (typeof JKN_CLASS_RIGHTS)[number];
/** Kelas rawat yang dipakai (`coverages.care_class`, bisa naik kelas). */
export const COVERAGE_CARE_CLASSES = ['vip', 'kelas_1', 'kelas_2', 'kelas_3'] as const;
export type CoverageCareClass = (typeof COVERAGE_CARE_CLASSES)[number];

export const encounterSchema = z.strictObject({
  id: z.uuid(),
  number: z.string().regex(ENCOUNTER_NUMBER_PATTERN),
  class: z.enum(ENCOUNTER_CLASSES),
  status: z.enum(ENCOUNTER_STATUSES),
  patientId: z.uuid(),
  unitId: z.uuid(),
  /** Layanan antrean poli (rawat jalan). */
  serviceId: z.uuid().nullable(),
  poliCode: z.string().regex(POLI_CODE_PATTERN).nullable(),
  /** DPJP; IGD boleh kosong sampai dokter jaga menerima pasien. */
  practitionerId: z.uuid().nullable(),
  appointmentId: z.uuid().nullable(),
  queueTicketId: z.uuid().nullable(),
  /** Terdaftar/tiba (null untuk admisi `planned`). */
  arrivedAt: isoDateTime.nullable(),
  startedAt: isoDateTime.nullable(),
  endedAt: isoDateTime.nullable(),
  cancelReason: z.string().max(300).nullable(),
  createdAt: isoDateTime,
});
export type Encounter = z.infer<typeof encounterSchema>;

export const encounterListQuerySchema = z.strictObject({
  ...cursorPageQuerySchema.shape,
  date: serviceDateSchema.optional(),
  class: z.enum(ENCOUNTER_CLASSES).optional(),
  status: z.enum(ENCOUNTER_STATUSES).optional(),
  unitId: z.uuid().optional(),
  patientId: z.uuid().optional(),
});
export type EncounterListQuery = z.infer<typeof encounterListQuerySchema>;

/** Batal kunjungan (task 99 bila dari booking JKN). Kunjungan dengan entri klinis final tidak bisa dibatalkan. */
export const cancelEncounterSchema = z.strictObject({ reason: changeReasonSchema });
export type CancelEncounterInput = z.infer<typeof cancelEncounterSchema>;

// ---------------------------------------------------------------------------------------------------------------
// Penjaminan
// ---------------------------------------------------------------------------------------------------------------

/** BPJS: dasar SEP (rujukan/surat kontrol hasil lookup) + diagnosa awal. DPJP dan poli diambil dari sesi. */
export const bpjsCoverageInputSchema = z.strictObject({
  payer: z.literal('bpjs'),
  visitKind: z.enum(BPJS_VISIT_KIND_CODES),
  referenceNumber: bpjsReferenceNumberSchema,
  initialDiagnosis: icd10CodingSchema,
  note: z.string().trim().max(200).optional(),
});

export const coverageInputSchema = z.discriminatedUnion('payer', [
  bpjsCoverageInputSchema,
  z.strictObject({ payer: z.literal('umum') }),
  z.strictObject({
    payer: z.literal('asuransi'),
    payerId: z.uuid(),
    memberNo: z.string().trim().min(1).max(40),
    guaranteeLetterNo: z.string().trim().max(60).optional(),
  }),
  z.strictObject({
    payer: z.literal('perusahaan'),
    payerId: z.uuid(),
    employeeNo: z.string().trim().max(40).optional(),
  }),
]);
export type CoverageInput = z.infer<typeof coverageInputSchema>;

export const COVERAGE_STATUSES = ['active', 'cancelled'] as const;

export const coverageSchema = z.strictObject({
  id: z.uuid(),
  encounterId: z.uuid(),
  /** Master `payers` (BPJS dan umum juga punya baris payer). */
  payerId: z.uuid(),
  payerKind: z.enum(PAYER_KINDS),
  payerName: z.string().min(1).max(160),
  /** 1 = utama, 2–3 = pendamping (koordinasi manfaat). */
  priority: z.number().int().min(1).max(3),
  /** No. peserta/anggota tersamar. */
  memberNoMasked: z.string().max(40).nullable(),
  classEntitlement: z.enum(JKN_CLASS_RIGHTS).nullable(),
  careClass: z.enum(COVERAGE_CARE_CLASSES).nullable(),
  status: z.enum(COVERAGE_STATUSES),
  /** Terkunci (`locked_at`) setelah SEP terbit: ubah penjamin → 409 `COVERAGE_LOCKED` (koreksi lewat revisi SEP). */
  locked: z.boolean(),
});
export type Coverage = z.infer<typeof coverageSchema>;

// ---------------------------------------------------------------------------------------------------------------
// SEP (berversi; beku setelah `issued`, perubahan = versi baru lewat `bpjs.vclaim.sep.update`)
// ---------------------------------------------------------------------------------------------------------------

/**
 * `pending` antre/dicoba ulang (sampai akhir hari layanan); `issued` nomor SEP terbit; `failed` ditolak BPJS atau gagal
 * permanen (DLQ): bedanya di `sync.status` (`rejected`/`dead`), kodenya di `lastErrorCode` (kode penolakan
 * `BPJS_REJECTIONS` atau kode transport) dan pesan untuk petugas di `rejectionReason`, lalu koreksi/kirim ulang; `cancelled` dihapus di BPJS. Poli tidak diblokir SEP
 * yang belum terbit; klaim (fase 5) mewajibkan SEP `issued`.
 */
export const SEP_STATUSES = ['pending', 'issued', 'failed', 'cancelled'] as const;
export type SepStatus = (typeof SEP_STATUSES)[number];
export const SEP_STATUS_LABEL: Record<SepStatus, string> = {
  pending: 'Menunggu BPJS',
  issued: 'Terbit',
  failed: 'Gagal / ditolak BPJS',
  cancelled: 'Dibatalkan',
};
/** Nomor SEP VClaim 19 karakter, mis. `0301R0011026V005102`. */
export const SEP_NO_PATTERN = /^[0-9A-Z]{19}$/;

export const sepSchema = z
  .strictObject({
    id: z.uuid(),
    encounterId: z.uuid(),
    coverageId: z.uuid(),
    /** Rujukan/surat kontrol dasar SEP (`referrals`: jenis + nomor). */
    referralId: z.uuid().nullable(),
    version: z.number().int().min(1),
    supersedesId: z.uuid().nullable(),
    correctionReason: z.string().max(500).nullable(),
    status: z.enum(SEP_STATUSES),
    sepNo: z.string().regex(SEP_NO_PATTERN).nullable(),
    serviceType: z.enum(['rawat_jalan', 'rawat_inap']),
    /** Kelas rawat SEP. */
    careClass: z.enum(JKN_CLASS_RIGHTS).nullable(),
    /** Kode poli BPJS tujuan (rawat jalan, `external_ids` `bpjs:poli`). */
    bpjsPoliCode: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .nullable(),
    /** Diagnosa awal (kode tersimpan; teks dari data rujukan P06). */
    initialDiagnosis: icd10CodingSchema.nullable(),
    /** Kode galat/penolakan terakhir (tanpa PHI), mis. `BPJS_PESERTA_TIDAK_AKTIF`. */
    lastErrorCode: z.string().max(60).nullable(),
    /** Alasan penolakan/kegagalan untuk petugas (`seps.rejection_reason`, hanya saat `failed`). */
    rejectionReason: z.string().max(300).nullable(),
    issuedAt: isoDateTime.nullable(),
    cancelledAt: isoDateTime.nullable(),
    cancelReason: z.string().max(300).nullable(),
    /** Pengiriman terakhir (insert/update/delete). */
    sync: bpjsSyncSchema,
  })
  .refine((v) => v.rejectionReason === null || v.status === 'failed', {
    message: 'Alasan penolakan hanya untuk SEP gagal',
    path: ['rejectionReason'],
  });
export type Sep = z.infer<typeof sepSchema>;

/** Revisi SEP terbit (versi baru). Minimal satu perubahan; alasan wajib. */
export const reviseSepSchema = z
  .strictObject({
    initialDiagnosis: icd10CodingSchema.optional(),
    note: z.string().trim().max(200).optional(),
    /** Alasan koreksi (`seps.correction_reason`, 10–500 karakter). */
    reason: z.string().trim().min(10, 'Alasan koreksi minimal 10 karakter').max(500),
  })
  .refine((v) => v.initialDiagnosis !== undefined || v.note !== undefined, 'Minimal satu data SEP diubah');
export type ReviseSepInput = z.infer<typeof reviseSepSchema>;

export const cancelSepSchema = z.strictObject({ reason: changeReasonSchema });
export type CancelSepInput = z.infer<typeof cancelSepSchema>;

/**
 * Lembar SEP untuk dicetak (HTML 80 mm/A5, keputusan fase 2 no. 10) di loket dan anjungan. Memuat identitas peserta
 * untuk pasien sendiri: endpoint cetaknya berizin (`documents.print` / perangkat `kiosk.use`) dan diaudit `print`.
 */
export const printableSepSchema = z.strictObject({
  tenantName: z.string().min(1).max(160),
  sepNo: z.string().regex(SEP_NO_PATTERN),
  serviceDate: serviceDateSchema,
  serviceType: z.enum(['rawat_jalan', 'rawat_inap']),
  participant: z.strictObject({
    cardNo: z.string().regex(/^\d{13}$/),
    name: z.string().min(1).max(120),
    birthDate: serviceDateSchema,
    mrn: z.string().regex(/^\d{2}-\d{2}-\d{2}-\d{2}$/),
    /** Segmen peserta, mis. PBPU, PBI, PPU. */
    segment: z.string().min(1).max(60),
    classEntitlement: z.enum(JKN_CLASS_RIGHTS),
  }),
  poliName: z.string().min(1).max(160),
  practitionerName: z.string().min(1).max(160),
  visitKind: z.enum(BPJS_VISIT_KIND_CODES),
  referenceNumber: z.string().max(30),
  /** Faskes perujuk (rujukan FKTP/antar-RS); null untuk kontrol dan rujukan internal. */
  referrerName: z.string().max(160).nullable(),
  initialDiagnosis: icd10CodingSchema,
  note: z.string().max(200).nullable(),
  issuedAt: isoDateTime,
});
export type PrintableSep = z.infer<typeof printableSepSchema>;

// ---------------------------------------------------------------------------------------------------------------
// Persetujuan umum dan penanggung jawab
// ---------------------------------------------------------------------------------------------------------------

/**
 * Persetujuan umum (keputusan fase 2 no. 9): rawat jalan berlaku sampai dicabut, rawat inap per admisi. Bukti = centang
 * petugas + scan opsional (dokumen P08). Tanpa persetujuan aktif → 422 `GENERAL_CONSENT_REQUIRED`.
 */
export const generalConsentInputSchema = z
  .strictObject({
    confirmedByStaff: z.literal(true, 'Petugas wajib menyatakan persetujuan sudah ditandatangani'),
    signer: z.enum(['pasien', 'wali']),
    /** Wajib bila ditandatangani wali. */
    signerName: NAME.optional(),
    evidenceDocumentId: z.uuid().optional(),
  })
  .refine((v) => v.signer === 'pasien' || v.signerName !== undefined, {
    message: 'Nama wali wajib diisi',
    path: ['signerName'],
  });
export type GeneralConsentInput = z.infer<typeof generalConsentInputSchema>;

export const CONTACT_RELATIONS = [
  'suami',
  'istri',
  'anak',
  'orang_tua',
  'saudara',
  'wali',
  'lainnya',
] as const;
export type ContactRelation = (typeof CONTACT_RELATIONS)[number];

const PHONE = z.string().transform((v, ctx) => {
  const n = normalizePhone(v);
  if (!n) {
    ctx.addIssue({ code: 'custom', message: 'No. HP tidak valid (contoh 0812-3456-7890)' });
    return z.NEVER;
  }
  return n;
});

/** Kontak/penanggung jawab pasien (`patient_contacts`, nama dan no. HP terenkripsi). Izin `patient.write`. */
export const patientContactInputSchema = z.strictObject({
  name: NAME,
  relation: z.enum(CONTACT_RELATIONS),
  phone: PHONE.optional(),
  address: z.string().trim().min(5).max(300).optional(),
  isGuarantor: z.boolean().default(true),
});
export type PatientContactInput = z.infer<typeof patientContactInputSchema>;

export const patientContactSchema = z.strictObject({
  id: z.uuid(),
  name: z.string().min(1).max(120),
  relation: z.enum(CONTACT_RELATIONS),
  phoneMasked: z.string().max(20).nullable(),
  isGuarantor: z.boolean(),
  active: z.boolean(),
});
export type PatientContact = z.infer<typeof patientContactSchema>;

/** Penanggung jawab saat registrasi: kontak yang sudah ada atau kontak baru. */
export const guarantorInputSchema = z.union([
  z.strictObject({ contactId: z.uuid() }),
  patientContactInputSchema,
]);

// ---------------------------------------------------------------------------------------------------------------
// Registrasi
// ---------------------------------------------------------------------------------------------------------------

/** Rawat jalan: pasien MPI + sesi DPJP hari ini (kuota dipesan bila tanpa booking) + penjamin. */
export const outpatientRegistrationSchema = z.strictObject({
  patientId: z.uuid(),
  sessionId: z.uuid(),
  /** Booking yang di-check-in; tanpa ini kunjungan walk-in (JKN tetap dibuatkan booking kanal `loket`). */
  appointmentId: z.uuid().optional(),
  /** Tiket loket admisi yang sedang dilayani (task 2/3 untuk walk-in). */
  counterTicketId: z.uuid().optional(),
  coverage: coverageInputSchema,
  /** Opsional bila pasien sudah punya persetujuan umum rawat jalan yang aktif. */
  generalConsent: generalConsentInputSchema.optional(),
  guarantor: guarantorInputSchema.optional(),
});
export type OutpatientRegistrationInput = z.infer<typeof outpatientRegistrationSchema>;

export const ARRIVAL_MODES = ['datang_sendiri', 'ambulans', 'rujukan', 'diantar_polisi', 'lainnya'] as const;

/** IGD: pasien tanpa identitas boleh (dibuat di MPI sebagai `unidentified`); penjamin boleh menyusul. */
export const emergencyRegistrationSchema = z.strictObject({
  patient: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('known'), patientId: z.uuid() }),
    z.strictObject({
      kind: z.literal('unidentified'),
      sex: z.enum(PATIENT_SEXES),
      estimatedAgeYears: z.number().int().min(0).max(120).optional(),
      /** Ciri-ciri untuk identifikasi kemudian (tanpa diagnosis). */
      description: z.string().trim().min(3).max(300),
    }),
  ]),
  unitId: z.uuid(),
  arrivalMode: z.enum(ARRIVAL_MODES),
  coverage: coverageInputSchema.optional(),
  guarantor: guarantorInputSchema.optional(),
});
export type EmergencyRegistrationInput = z.infer<typeof emergencyRegistrationSchema>;

/**
 * Admisi rawat inap terencana (`planned`; bed di fase 3). BPJS wajib berdasar SPRI atau kunjungan IGD/RJ asal.
 * Persetujuan umum wajib per admisi.
 */
export const admissionSchema = z
  .strictObject({
    patientId: z.uuid(),
    sourceEncounterId: z.uuid().optional(),
    /** Surat perintah rawat inap (`referrals` jenis `spri`). */
    spriReferralId: z.uuid().optional(),
    /** Unit rawat inap (bangsal). */
    unitId: z.uuid(),
    practitionerId: z.uuid(),
    careClass: z.enum(COVERAGE_CARE_CLASSES),
    plannedAt: isoDateTime,
    coverage: coverageInputSchema,
    generalConsent: generalConsentInputSchema,
    guarantor: guarantorInputSchema.optional(),
  })
  .refine(
    (v) => v.coverage.payer !== 'bpjs' || v.spriReferralId !== undefined || v.sourceEncounterId !== undefined,
    { message: 'Admisi BPJS wajib berdasar SPRI atau kunjungan asal', path: ['spriReferralId'] },
  );
export type AdmissionInput = z.infer<typeof admissionSchema>;

/** Hasil registrasi (201, juga untuk permintaan ulang dengan Idempotency-Key yang sama). */
export const registrationResultSchema = z.strictObject({
  encounter: encounterSchema,
  coverage: coverageSchema.nullable(),
  /** Null bila bukan BPJS (atau BPJS IGD yang SEP-nya menyusul). */
  sep: sepSchema.nullable(),
  /** Tiket antrean poli (rawat jalan); null untuk IGD dan admisi. */
  queueTicket: queueTicketSchema.nullable(),
  appointment: z.strictObject({ id: z.uuid(), bookingCode: bookingCodeSchema }).nullable(),
});
export type RegistrationResult = z.infer<typeof registrationResultSchema>;

// ---------------------------------------------------------------------------------------------------------------
// Lookup sinkron (ADR-0025): baca-saja, di luar transaksi, timeout → 503 `BPJS_UNAVAILABLE`.
// Data pribadi selalu di body (POST), tidak pernah di URL.
// ---------------------------------------------------------------------------------------------------------------

const digits = (n: number, label: string) =>
  z.string().regex(new RegExp(`^\\d{${n}}$`), `${label} ${n} digit`);

export const bpjsParticipantLookupSchema = z.discriminatedUnion('by', [
  z.strictObject({ by: z.literal('nik'), value: digits(16, 'NIK') }),
  z.strictObject({ by: z.literal('kartu'), value: digits(13, 'No. kartu BPJS') }),
]);
export type BpjsParticipantLookupInput = z.infer<typeof bpjsParticipantLookupSchema>;

/**
 * Hasil cek kepesertaan untuk layar (tersamar); peserta tidak aktif tetap hasil (status `tidak-aktif`), bukan galat.
 * Tidak ditemukan → 422 `BPJS_REJECTED` dengan `details.reason = 'BPJS_PESERTA_TIDAK_DITEMUKAN'`.
 */
export const eligibilityResultSchema = z.strictObject({
  eligibility: bpjsEligibilitySchema,
  checkedAt: isoDateTime,
});
export type EligibilityResult = z.infer<typeof eligibilityResultSchema>;

export const bpjsReferralLookupSchema = z.discriminatedUnion('by', [
  z.strictObject({ by: z.literal('kartu'), value: digits(13, 'No. kartu BPJS') }),
  z.strictObject({ by: z.literal('nomor'), value: bpjsReferenceNumberSchema }),
]);
export type BpjsReferralLookupInput = z.infer<typeof bpjsReferralLookupSchema>;

/** Rujukan FKTP dan surat kontrol aktif/kedaluwarsa (model tampilan `referralSchema`). */
export const referralLookupResultSchema = z.strictObject({
  referrals: z.array(referralSchema),
  checkedAt: isoDateTime,
});

/** Isian otomatis pasien baru dari Dukcapil (petugas berizin `patient.write`; tidak disimpan sebelum dikonfirmasi). */
export const dukcapilLookupSchema = z.strictObject({ nik: digits(16, 'NIK') });
export const dukcapilLookupResultSchema = z.discriminatedUnion('found', [
  z.strictObject({ found: z.literal(false) }),
  z.strictObject({
    found: z.literal(true),
    name: z.string().min(1).max(120),
    sex: z.enum(PATIENT_SEXES),
    birthDate: serviceDateSchema,
    birthPlace: z.string().max(80).nullable(),
    address: z.string().max(300).nullable(),
  }),
]);
export type DukcapilLookupResult = z.infer<typeof dukcapilLookupResultSchema>;
