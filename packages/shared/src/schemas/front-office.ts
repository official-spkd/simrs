import { z } from 'zod';

/**
 * F01–F06 · Front office: jadwal dokter, kuota, antrean, anjungan, pendaftaran + SEP.
 * Kontrak respons (zod) yang dipenuhi data dummy mode presentasi sekarang (ADR-0023) dan API kelak. Diisi
 * bersama layar domain ini; nama mengikuti entitas docs/04, camelCase, uang = string rupiah, waktu ISO 8601.
 * Angka mentah (bukan teks tampilan): format Indonesia dikerjakan lapisan tampilan.
 */

const isoDate = z.iso.date();
const isoDateTime = z.iso.datetime({ offset: true });
/** Jam dinding WIB `HH.MM` (format tampilan docs/08, mis. `08.00`). */
export const wallClockSchema = z.string().regex(/^([01]\d|2[0-3])\.[0-5]\d$/);
/** Nomor antrean `<kode>-<3 digit>` (docs/04 §5): poli `PD-027`, loket admisi `A-031`, farmasi `F-021`. */
export const QUEUE_NO_PATTERN = /^[A-Z]{1,2}-\d{3}$/;
export const queueNoSchema = z.string().regex(QUEUE_NO_PATTERN);
const poliCode = z.string().regex(/^[A-Z]{2}$/);
/** Kode ICD-10 (WHO) di awal teks diagnosa, mis. `I10` atau `E11.9`. */
export const ICD10_PATTERN = /^[A-Z]\d{2}(\.\d{1,2})?$/;
const count = z.number().int().min(0);

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
    /** `<id dokter>.<tanggal>`. */
    id: z.string().regex(/^[a-z0-9-]+\.\d{4}-\d{2}-\d{2}$/),
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
  })
  .refine((s) => (s.kind === 'praktik') === (s.quota !== null), {
    message: 'Hanya slot praktik yang berkuota',
  })
  .refine((s) => (s.kind === 'praktik' || s.kind === 'pengganti') === (s.start !== null && s.end !== null), {
    message: 'Jam hanya untuk slot praktik/pengganti',
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

export const hfisDifferenceSchema = z.strictObject({
  slotId: z.string().min(1),
  /** Kalimat penjelasan perbedaan (mis. HFIS masih mencatat praktik padahal cuti). */
  text: z.string().min(1),
});

export const weeklyScheduleSchema = z
  .strictObject({
    /** Senin minggu jadwal. */
    weekStart: isoDate,
    days: z.array(isoDate).min(1).max(7),
    doctors: z.array(scheduleDoctorSchema),
    hfis: z.strictObject({
      lastSyncAt: isoDateTime,
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
  /** Panggilan terakhir (panel besar "SEDANG DIPANGGIL"). */
  calling: queueCallSchema,
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

/** Hasil pencarian pasien di meja pendaftaran (identitas tersamar). */
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

export const registrationDeskSchema = z.strictObject({
  date: isoDate,
  counter: z.strictObject({
    name: z.string().min(1),
    waiting: count,
    /** Tiket loket admisi berikutnya, urut. */
    tickets: z.array(counterTicketSchema),
  }),
  vclaimLatencyMs: count,
  quotas: z.array(practitionerQuotaSchema),
  /** Pasien yang bisa dicari di meja ini (fiktif). */
  patients: z.array(registrationPatientSchema),
});
export type RegistrationDesk = z.infer<typeof registrationDeskSchema>;
