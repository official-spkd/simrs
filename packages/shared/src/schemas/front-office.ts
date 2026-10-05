import { z } from 'zod';
import { nameBasedId } from '../ids';
import { ANTREAN_JENIS_KUNJUNGAN } from '../integrations/bpjs/antrean';
import { BPJS_REJECTIONS, type BpjsRejectionCode } from '../integrations/bpjs/common';

/**
 * F01–F08 · Front office: jadwal dokter, kuota, antrean, anjungan, pendaftaran + SEP.
 * File ini memuat (1) primitif bersama kontrak API front office (dipakai `scheduling`, `booking`, `queue`,
 * `registration`, `referral`, `kiosk`, `public-info`) dan (2) model tampilan layar (view model) yang dipenuhi data
 * dummy mode presentasi sekarang (ADR-0023) dan endpoint API layar yang sama kelak. Nama mengikuti entitas docs/04,
 * camelCase, uang = string rupiah, waktu ISO 8601. Angka mentah (bukan teks tampilan): format Indonesia dikerjakan
 * lapisan tampilan, kecuali jam dinding `HH.MM` di model tampilan.
 */

const isoDate = z.iso.date();
const isoDateTime = z.iso.datetime({ offset: true });
/** Jam dinding WIB `HH.MM` (format tampilan docs/08, mis. `08.00`). Hanya di model tampilan. */
export const wallClockSchema = z.string().regex(/^([01]\d|2[0-3])\.[0-5]\d$/);
/** Nomor antrean `<kode>-<3 digit>` (docs/04 §5): poli `PD-027`, loket admisi `A-031`, farmasi `F-021`. */
export const QUEUE_NO_PATTERN = /^[A-Z]{1,2}-\d{3}$/;
export const queueNoSchema = z.string().regex(QUEUE_NO_PATTERN);
/** Kode poli lokal RS (2 huruf, juga awalan nomor antrean poli): `PD`, `JT`, `SR`, `PR`. */
export const POLI_CODE_PATTERN = /^[A-Z]{2}$/;
const poliCode = z.string().regex(POLI_CODE_PATTERN);
/** Kode ICD-10 (WHO) di awal teks diagnosa, mis. `I10` atau `E11.9`. */
export const ICD10_PATTERN = /^[A-Z]\d{2}(\.\d{1,2})?$/;
const count = z.number().int().min(0);

// ---------------------------------------------------------------------------------------------------------------
// Primitif kontrak API front office (fase 2)
// ---------------------------------------------------------------------------------------------------------------

/** Tanggal layanan (kalender WIB) `YYYY-MM-DD`. */
export const serviceDateSchema = isoDate;
/** Jam di API `HH:MM` 24 jam (ISO 8601). Model tampilan memakai `HH.MM` (`wallClockSchema`). */
export const TIME_OF_DAY_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
export const timeOfDaySchema = z.string().regex(TIME_OF_DAY_PATTERN, 'Format jam HH:MM');
/** `HH:MM` → `HH.MM` untuk model tampilan. */
export function toWallClock(time: string): string {
  return time.replace(':', '.');
}
/** Diagnosis ICD-10 (kode WHO + teks) untuk SEP, rujukan, dan surat kontrol. Kode tidak pernah dikarang (CLAUDE.md §4.10). */
export const icd10CodingSchema = z.strictObject({
  code: z.string().regex(ICD10_PATTERN, 'Kode ICD-10 tidak valid'),
  display: z.string().trim().min(1).max(200),
});
export type Icd10Coding = z.infer<typeof icd10CodingSchema>;

/**
 * Status pengiriman ke BPJS lewat outbox (dilihat layar: chip SEP, task antrean, HFIS):
 * `not_required` tidak dikirim (mis. pasien non-JKN), `pending` antre/dicoba ulang, `sent` diterima BPJS,
 * `rejected` BPJS menolak (galat bisnis, bukan DLQ), `dead` gagal permanen setelah batas coba (DLQ, bisa dikirim ulang).
 */
export const BPJS_SYNC_STATUSES = ['not_required', 'pending', 'sent', 'rejected', 'dead'] as const;
export type BpjsSyncStatus = (typeof BPJS_SYNC_STATUSES)[number];
export const bpjsSyncSchema = z.strictObject({
  status: z.enum(BPJS_SYNC_STATUSES),
  /** Waktu terakhir diterima BPJS. */
  sentAt: isoDateTime.nullable(),
  /**
   * Galat terakhir, null bila tidak ada: kode internal stabil (penolakan `BPJS_REJECTIONS`/`BPJS_TIDAK_DIKENAL`, atau
   * kode transport mis. `BPJS_UNAVAILABLE`) + pesan untuk petugas.
   */
  error: z.strictObject({ code: z.string().min(1).max(60), message: z.string().max(500) }).nullable(),
});
export type BpjsSync = z.infer<typeof bpjsSyncSchema>;

/** Kode penolakan BPJS (kontrak kawat) yang dibawa galat API `BPJS_REJECTED` dan status kirim `rejected`. */
export const BPJS_REJECTION_CODES: readonly [BpjsRejectionCode, ...BpjsRejectionCode[]] = [
  'BPJS_TIDAK_DIKENAL',
  ...(Object.keys(BPJS_REJECTIONS) as BpjsRejectionCode[]),
];
/** `details` galat `BPJS_REJECTED`: alasan baku + pesan BPJS apa adanya (untuk petugas, tanpa PHI tambahan). */
export const bpjsRejectedDetailsSchema = z.strictObject({
  reason: z.enum(BPJS_REJECTION_CODES),
  bpjsMessage: z.string().max(500),
});
export type BpjsRejectedDetails = z.infer<typeof bpjsRejectedDetailsSchema>;

/** Header idempotensi untuk tindakan yang tidak boleh terjadi dua kali (registrasi, SEP, check-in anjungan). */
export const IDEMPOTENCY_HEADER = 'Idempotency-Key';
export const idempotencyKeySchema = z.uuid('Idempotency-Key harus UUID');

/** Paginasi kursor (UUID v7 → urut waktu dibuat). */
export const cursorPageQuerySchema = z.strictObject({
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export function cursorPageSchema<T extends z.ZodType>(item: T) {
  return z.strictObject({ items: z.array(item), nextCursor: z.uuid().nullable() });
}

/**
 * Jenis kunjungan JKN (`jeniskunjungan` Antrean BPJS) = dasar rujukan SEP rawat jalan:
 * 1 rujukan FKTP, 2 rujukan internal, 3 kontrol (surat kontrol), 4 rujukan antar-RS. `referralKind` = jenis baris
 * `referrals` yang menyimpan nomornya (SEP menautkannya lewat `referral_id`).
 */
export const BPJS_VISIT_KINDS = {
  rujukan_fktp: {
    code: ANTREAN_JENIS_KUNJUNGAN.rujukanFktp,
    label: 'Rujukan FKTP',
    referralKind: 'rujukan-fktp',
  },
  rujukan_internal: {
    code: ANTREAN_JENIS_KUNJUNGAN.rujukanInternal,
    label: 'Rujukan internal',
    referralKind: 'rujukan-internal',
  },
  kontrol: {
    code: ANTREAN_JENIS_KUNJUNGAN.kontrol,
    label: 'Kontrol (surat kontrol)',
    referralKind: 'surat-kontrol',
  },
  rujukan_antar_rs: {
    code: ANTREAN_JENIS_KUNJUNGAN.rujukanAntarRs,
    label: 'Rujukan antar-RS',
    referralKind: 'rujukan-rs',
  },
} as const;
export type BpjsVisitKind = keyof typeof BPJS_VISIT_KINDS;
export const BPJS_VISIT_KIND_CODES = Object.keys(BPJS_VISIT_KINDS) as [BpjsVisitKind, ...BpjsVisitKind[]];
/** Nomor rujukan / surat kontrol BPJS (alfanumerik, mis. `0301R0011025K000117`). */
export const bpjsReferenceNumberSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[0-9A-Z]{8,40}$/, 'Nomor rujukan/surat kontrol tidak valid');
/**
 * Dasar kunjungan JKN: jenis kunjungan + nomor rujukan/surat kontrol. Disimpan di `appointments.jkn_visit_kind`
 * (= `BPJS_VISIT_KINDS[visitKind].code`, 1–4) dan `appointments.reference_number` (wajib untuk keranjang `jkn`).
 */
export const jknReferenceSchema = z.strictObject({
  visitKind: z.enum(BPJS_VISIT_KIND_CODES),
  referenceNumber: bpjsReferenceNumberSchema,
});
export type JknReference = z.infer<typeof jknReferenceSchema>;

/** Alasan pembatalan/perubahan (tercatat di audit dan riwayat status). */
export const changeReasonSchema = z.string().trim().min(5, 'Alasan minimal 5 karakter').max(300);

const SCHEDULE_CELL_NAMESPACE = '173f7131-5ea7-437a-8d2f-c152b892d46b';

/**
 * ID sel grid jadwal (dokter × tanggal), UUID deterministik. Sel tidak selalu punya baris sesi sendiri (hari libur,
 * atau sel pengganti yang memakai sesi dokter yang digantikan), sehingga ID sel dipisah dari `sessionId`.
 */
export function scheduleCellId(practitionerId: string, date: string): string {
  return nameBasedId(`${practitionerId}.${date}`, SCHEDULE_CELL_NAMESPACE);
}

// ---------------------------------------------------------------------------------------------------------------
// F01 · Jadwal praktik mingguan dan kuota (sinkron HFIS)
// ---------------------------------------------------------------------------------------------------------------

/** `praktik` = slot berkuota; `cuti` = dokter cuti (pasien perlu dialihkan); `pengganti`; `libur` = tidak praktik. */
export const SCHEDULE_SLOT_KINDS = ['praktik', 'cuti', 'pengganti', 'libur'] as const;
export type ScheduleSlotKind = (typeof SCHEDULE_SLOT_KINDS)[number];

/** Kuota slot: JKN (Mobile JKN + loket) dan non-JKN (umum/asuransi), beserta pasien yang sudah booking. */
export const slotQuotaSchema = z
  .strictObject({ jkn: count, nonJkn: count, bookedJkn: count, bookedNonJkn: count })
  .refine((q) => q.bookedJkn + q.bookedNonJkn <= q.jkn + q.nonJkn, {
    message: 'Pasien booking melebihi kuota slot',
  });
export type SlotQuota = z.infer<typeof slotQuotaSchema>;

export const scheduleSlotSchema = z
  .strictObject({
    /** ID sel (dokter × tanggal), lihat `scheduleCellId`. Kunci pilihan di layar (`?pilih=`). */
    id: z.uuid(),
    /**
     * Sesi praktik (`schedule_sessions.id`) yang ditindak lanjuti (ubah kuota, cuti, alih): `praktik`/`cuti` = sesi
     * dokter itu sendiri, `pengganti` = sesi dokter yang digantikan, `libur` = null.
     */
    sessionId: z.uuid().nullable(),
    date: isoDate,
    kind: z.enum(SCHEDULE_SLOT_KINDS),
    start: wallClockSchema.nullable(),
    end: wallClockSchema.nullable(),
    /** Hanya slot `praktik` yang berkuota sendiri; slot pengganti memakai kuota slot yang digantikan. */
    quota: slotQuotaSchema.nullable(),
    /** `cuti`: dokter pengganti yang diusulkan; `pengganti`: dokter yang digantikan. */
    relatedDoctorId: z.string().nullable(),
    /** `cuti`: pasien yang sudah booking dan perlu dialihkan/dijadwal ulang. */
    affectedPatients: count.nullable(),
    /** Jadwal RS dan HFIS sudah sama untuk slot ini. */
    hfisSynced: z.boolean(),
    /** Versi sesi (`updatedAt`) untuk ubah kuota berversi (`baseUpdatedAt`); tidak ada di data mode presentasi. */
    updatedAt: isoDateTime.optional(),
    /** `cuti`: pasien sudah dialihkan (pengganti/sesi lain) pada waktu ini; null = belum. Tidak ada di data demo. */
    transferredAt: isoDateTime.nullable().optional(),
  })
  .refine((s) => (s.kind === 'praktik') === (s.quota !== null), {
    message: 'Hanya slot praktik yang berkuota',
  })
  .refine((s) => (s.kind === 'praktik' || s.kind === 'pengganti') === (s.start !== null && s.end !== null), {
    message: 'Jam hanya untuk slot praktik/pengganti',
  })
  .refine((s) => (s.kind === 'libur') === (s.sessionId === null), {
    message: 'Hanya slot libur yang tanpa sesi',
  });
export type ScheduleSlot = z.infer<typeof scheduleSlotSchema>;

export const scheduleDoctorSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  poliCode,
  poliName: z.string().min(1),
  room: z.string().min(1),
  /** Satu slot per hari minggu itu (urut sama dengan `days`). */
  slots: z.array(scheduleSlotSchema).min(1),
});
export type ScheduleDoctor = z.infer<typeof scheduleDoctorSchema>;

/**
 * Cara menyelesaikan perbedaan: `kirim` = kirim templat jadwal lewat web service (`bpjs.hfis.update`);
 * `aplikasi-hfis` = petugas mencatat di aplikasi HFIS (cuti/libur per tanggal dan kapasitas tidak bisa dikirim
 * lewat web service, keputusan fase 2 potongan 2).
 */
export const HFIS_RESOLUTIONS = ['kirim', 'aplikasi-hfis'] as const;
export type HfisResolution = (typeof HFIS_RESOLUTIONS)[number];

export const hfisDifferenceSchema = z.strictObject({
  /** ID sel jadwal (`scheduleSlotSchema.id`). */
  slotId: z.uuid(),
  /** Kalimat penjelasan perbedaan (mis. HFIS masih mencatat praktik padahal cuti). */
  text: z.string().min(1),
  /** Tidak ada di data mode presentasi. */
  resolution: z.enum(HFIS_RESOLUTIONS).optional(),
});
export type HfisDifference = z.infer<typeof hfisDifferenceSchema>;

export const weeklyScheduleSchema = z
  .strictObject({
    /** Senin minggu jadwal. */
    weekStart: isoDate,
    days: z.array(isoDate).min(1).max(7),
    doctors: z.array(scheduleDoctorSchema),
    hfis: z.strictObject({
      /** Tarikan HFIS terakhir untuk minggu ini; null = belum pernah ditarik. */
      lastSyncAt: isoDateTime.nullable(),
      differences: z.array(hfisDifferenceSchema),
    }),
  })
  .refine((w) => w.doctors.every((d) => d.slots.map((s) => s.date).join() === w.days.join()), {
    message: 'Setiap dokter harus punya satu slot per hari, urut sesuai `days`',
  });
export type WeeklySchedule = z.infer<typeof weeklyScheduleSchema>;

// ---------------------------------------------------------------------------------------------------------------
// F04 · Papan antrean ruang tunggu (TV)
// ---------------------------------------------------------------------------------------------------------------

export const queueBoardClinicSchema = z.strictObject({
  poliCode,
  poliName: z.string().min(1),
  room: z.string().min(1),
  doctorName: z.string().min(1),
  /** Nomor yang sedang dilayani (terakhir dipanggil), null bila belum mulai. */
  current: queueNoSchema.nullable(),
  /** Urutan menunggu (FIFO); layar menampilkan dua teratas sebagai "Berikutnya". */
  waiting: z.array(queueNoSchema),
  /**
   * Nomor yang sudah dialokasikan ke booking dan hanya dipanggil petugas poli (bukan panggilan otomatis papan),
   * mis. pasien yang belum diperiksa perawat. Nomor baru tidak pernah memakai nomor ini.
   */
  reserved: z.array(queueNoSchema),
  note: z.string().min(1),
  /** `perhatian` = catatan keterlambatan dokter (warna peringatan + label teks). */
  noteTone: z.enum(['normal', 'perhatian']),
});
export type QueueBoardClinic = z.infer<typeof queueBoardClinicSchema>;

export const queueCallSchema = z.strictObject({ queueNo: queueNoSchema, poliCode });
export type QueueCall = z.infer<typeof queueCallSchema>;

export const queueBoardSchema = z.strictObject({
  /** Area ruang tunggu, mis. "Rawat Jalan Lantai 2". */
  area: z.string().min(1),
  asOf: isoDateTime,
  /** Panggilan terakhir (panel besar "SEDANG DIPANGGIL"); null bila belum ada panggilan hari ini (API, potongan 4a). */
  calling: queueCallSchema.nullable(),
  /** Panggilan sebelumnya, terbaru dulu. */
  history: z.array(queueCallSchema).max(4),
  clinics: z.array(queueBoardClinicSchema).min(1).max(4),
  info: z.string().min(1),
});
export type QueueBoard = z.infer<typeof queueBoardSchema>;

// ---------------------------------------------------------------------------------------------------------------
// F03/F06 · Meja pendaftaran: kuota dokter hari ini, antrean loket, pencarian pasien + kepesertaan + rujukan
// ---------------------------------------------------------------------------------------------------------------

export const practitionerQuotaSchema = z.strictObject({
  /** Sesi praktik hari ini yang dipilih saat registrasi (`outpatientRegistrationSchema.sessionId`). */
  sessionId: z.uuid(),
  doctorId: z.string().min(1),
  doctorName: z.string().min(1),
  poliCode,
  poliName: z.string().min(1),
  room: z.string().min(1),
  start: wallClockSchema,
  end: wallClockSchema,
  jkn: z.strictObject({ booked: count, total: count }),
  nonJkn: z.strictObject({ booked: count, total: count }),
  /** Nomor antrean poli untuk pendaftaran baru ke dokter ini. */
  nextQueueNo: queueNoSchema,
  /** Perkiraan dipanggil pasien baru. */
  eta: wallClockSchema,
});
export type PractitionerQuota = z.infer<typeof practitionerQuotaSchema>;

export const counterTicketSchema = z.strictObject({
  ticket: queueNoSchema,
  /** Pasien yang sudah teridentifikasi di anjungan (booking), null untuk walk-in. */
  patientId: z.string().nullable(),
});
export type CounterTicket = z.infer<typeof counterTicketSchema>;

export const REFERRAL_KINDS = ['surat-kontrol', 'rujukan-fktp'] as const;

export const referralSchema = z.strictObject({
  id: z.string().min(1),
  kind: z.enum(REFERRAL_KINDS),
  /** Nomor surat kontrol / rujukan (fiktif). */
  number: z.string().min(1),
  title: z.string().min(1),
  /** Asal: poli RS (surat kontrol) atau FKTP perujuk. */
  origin: z.string().min(1),
  diagnosis: z.strictObject({ code: z.string().regex(ICD10_PATTERN), label: z.string().min(1) }),
  issuedAt: isoDate,
  validUntil: isoDate,
  /** Kunjungan ke- (rujukan FKTP berlaku untuk beberapa kunjungan). */
  visitNo: z.number().int().min(1).nullable(),
  poliCode,
  /** DPJP yang diusulkan (surat kontrol), null bila bebas dipilih. */
  doctorId: z.string().nullable(),
});
export type Referral = z.infer<typeof referralSchema>;

export const bpjsEligibilitySchema = z.strictObject({
  status: z.enum(['aktif', 'tidak-aktif']),
  cardMasked: z.string().min(1),
  kelas: z.enum(['Kelas 1', 'Kelas 2', 'Kelas 3']),
  /** Segmen peserta, mis. PBPU, PBI, PPU. */
  segment: z.string().min(1),
  fktp: z.string().min(1),
});
export type BpjsEligibility = z.infer<typeof bpjsEligibilitySchema>;

export const PAYERS = ['BPJS', 'Umum', 'Asuransi'] as const;
export type Payer = (typeof PAYERS)[number];

/**
 * Hasil pencarian pasien di meja pendaftaran (identitas tersamar). API mengembalikan pasien satu per satu lewat
 * pencarian (MPI) + cek kepesertaan + rujukan; meja tidak pernah memuat daftar pasien di depan.
 */
export const registrationPatientSchema = z.strictObject({
  id: z.string().min(1),
  rm: z.string().regex(/^\d{2}-\d{2}-\d{2}-\d{2}$/),
  name: z.string().min(1),
  sex: z.enum(['L', 'P']),
  birthDate: isoDate,
  ageYears: count,
  nikMasked: z.string().min(1),
  bpjsMasked: z.string().nullable(),
  phoneMasked: z.string().min(1),
  address: z.string().min(1),
  guardian: z.string().min(1),
  /** Ringkasan kunjungan terakhir, null untuk pasien baru. */
  lastVisit: z.string().nullable(),
  /** NIK cocok dengan Dukcapil dan SATUSEHAT. */
  identityVerified: z.boolean(),
  defaultPayer: z.enum(PAYERS),
  /** Hasil cek kepesertaan (tampil setelah petugas menekan Cek kepesertaan); null bila bukan peserta. */
  eligibility: bpjsEligibilitySchema.nullable(),
  referrals: z.array(referralSchema),
});
export type RegistrationPatient = z.infer<typeof registrationPatientSchema>;

/**
 * Meja pendaftaran: antrean loket dan kuota dokter hari ini. Tanpa daftar pasien pra-muat (data pribadi hanya lewat
 * pencarian berizin dan diaudit) dan tanpa latensi VClaim (status integrasi milik layar Integrasi, fase 7).
 */
export const registrationDeskSchema = z.strictObject({
  date: isoDate,
  counter: z.strictObject({
    name: z.string().min(1),
    waiting: count,
    /** Tiket loket admisi berikutnya, urut. */
    tickets: z.array(counterTicketSchema),
  }),
  quotas: z.array(practitionerQuotaSchema),
});
export type RegistrationDesk = z.infer<typeof registrationDeskSchema>;
