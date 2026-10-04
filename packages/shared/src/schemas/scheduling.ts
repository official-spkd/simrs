import { z } from 'zod';
import {
  changeReasonSchema,
  POLI_CODE_PATTERN,
  serviceDateSchema,
  slotQuotaSchema,
  timeOfDaySchema,
} from './front-office';

/**
 * F01 · Kontrak API jadwal praktik dan kuota (`/api/v1/scheduling`, rencana fase 2 potongan 2).
 * Templat mingguan (`practitioner_schedules`) membangkitkan sesi bertanggal (`schedule_sessions`, kuota dijamin
 * CHECK `booked <= quota` di database). Layar Jadwal memakai model tampilan `weeklyScheduleSchema` dan meja
 * pendaftaran `practitionerQuotaSchema` (schemas/front-office.ts); skema di sini untuk masukan dan data mentah.
 * Izin: baca `schedule.read`; ubah templat/kuota/cuti `schedule.write`; kirim/tarik HFIS `schedule.sync`.
 */

/** Hari templat: 1 = Senin … 7 = Minggu (ISO 8601). */
export const weekdaySchema = z.number().int().min(1).max(7);
export const WEEKDAY_LABEL = ['', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'] as const;

/** Kuota satu kolam per sesi. Batas atas sekadar pengaman salah ketik. */
const quotaCount = z.number().int().min(0).max(500);
const isMonday = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay() === 1;
const NAME = z.string().min(1).max(160);

/**
 * Pembagian kuota bawaan dari total (`schedule.jkn_share_percent`, bawaan 80%): JKN dibulatkan, sisanya non-JKN.
 * Contoh 30 → 24 JKN + 6 non-JKN (mockup Jadwal).
 */
export function defaultQuotaSplit(total: number, jknPercent: number): { jkn: number; nonJkn: number } {
  if (!Number.isInteger(total) || total < 0) throw new RangeError('Total kuota harus bilangan bulat ≥ 0');
  if (!Number.isInteger(jknPercent) || jknPercent < 0 || jknPercent > 100) {
    throw new RangeError('Porsi JKN harus 0–100');
  }
  const jkn = Math.round((total * jknPercent) / 100);
  return { jkn, nonJkn: total - jkn };
}

// ---------------------------------------------------------------------------------------------------------------
// Templat mingguan
// ---------------------------------------------------------------------------------------------------------------

export const scheduleTemplateInputSchema = z
  .strictObject({
    practitionerId: z.uuid(),
    /** Unit poli. */
    unitId: z.uuid(),
    weekday: weekdaySchema,
    start: timeOfDaySchema,
    end: timeOfDaySchema,
    quotaJkn: quotaCount,
    quotaNonJkn: quotaCount,
    validFrom: serviceDateSchema,
    validUntil: serviceDateSchema.optional(),
  })
  .refine((v) => v.start < v.end, { message: 'Jam mulai harus sebelum jam selesai', path: ['end'] })
  .refine((v) => v.validUntil === undefined || v.validUntil >= v.validFrom, {
    message: 'Berlaku sampai tidak boleh sebelum berlaku mulai',
    path: ['validUntil'],
  });
export type ScheduleTemplateInput = z.infer<typeof scheduleTemplateInputSchema>;

/** Ubah templat (data master, bukan rekam medis). Sesi yang sudah dibangkitkan tidak ikut berubah otomatis. */
export const updateScheduleTemplateSchema = z
  .strictObject({
    start: timeOfDaySchema.optional(),
    end: timeOfDaySchema.optional(),
    quotaJkn: quotaCount.optional(),
    quotaNonJkn: quotaCount.optional(),
    validUntil: serviceDateSchema.nullable().optional(),
    active: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Minimal satu field diubah')
  .refine((v) => v.start === undefined || v.end === undefined || v.start < v.end, {
    message: 'Jam mulai harus sebelum jam selesai',
    path: ['end'],
  });
export type UpdateScheduleTemplateInput = z.infer<typeof updateScheduleTemplateSchema>;

export const scheduleTemplateSchema = z.strictObject({
  id: z.uuid(),
  practitionerId: z.uuid(),
  practitionerName: NAME,
  unitId: z.uuid(),
  poliCode: z.string().regex(POLI_CODE_PATTERN),
  poliName: NAME,
  weekday: weekdaySchema,
  start: timeOfDaySchema,
  end: timeOfDaySchema,
  quotaJkn: quotaCount,
  quotaNonJkn: quotaCount,
  validFrom: serviceDateSchema,
  validUntil: serviceDateSchema.nullable(),
  active: z.boolean(),
});
export type ScheduleTemplate = z.infer<typeof scheduleTemplateSchema>;

export const scheduleTemplateQuerySchema = z.strictObject({
  practitionerId: z.uuid().optional(),
  unitId: z.uuid().optional(),
});

// ---------------------------------------------------------------------------------------------------------------
// Sesi bertanggal
// ---------------------------------------------------------------------------------------------------------------

/** `scheduled` praktik; `on_leave` dokter cuti (booking perlu dialihkan, atau diganti dokter pengganti); `cancelled`. */
export const SCHEDULE_SESSION_STATUSES = ['scheduled', 'on_leave', 'cancelled'] as const;
export type ScheduleSessionStatus = (typeof SCHEDULE_SESSION_STATUSES)[number];
export const SCHEDULE_SESSION_STATUS_LABEL: Record<ScheduleSessionStatus, string> = {
  scheduled: 'Praktik',
  on_leave: 'Cuti',
  cancelled: 'Dibatalkan',
};

export const scheduleSessionSchema = z.strictObject({
  id: z.uuid(),
  practitionerId: z.uuid(),
  practitionerName: NAME,
  unitId: z.uuid(),
  poliCode: z.string().regex(POLI_CODE_PATTERN),
  poliName: NAME,
  room: z.string().min(1).max(60).nullable(),
  serviceDate: serviceDateSchema,
  start: timeOfDaySchema,
  end: timeOfDaySchema,
  status: z.enum(SCHEDULE_SESSION_STATUSES),
  /** Dokter pengganti saat cuti: pasien tetap di sesi ini dan memakai kuotanya. */
  substitute: z.strictObject({ practitionerId: z.uuid(), practitionerName: NAME }).nullable(),
  leaveReason: z.string().max(300).nullable(),
  quota: slotQuotaSchema,
  /** Jadwal RS dan HFIS sudah sama untuk sesi ini. */
  hfisSynced: z.boolean(),
});
export type ScheduleSession = z.infer<typeof scheduleSessionSchema>;

/** Daftar sesi dalam rentang tanggal (maks. 31 hari). */
export const scheduleSessionQuerySchema = z
  .strictObject({
    from: serviceDateSchema,
    to: serviceDateSchema,
    unitId: z.uuid().optional(),
    practitionerId: z.uuid().optional(),
    status: z.enum(SCHEDULE_SESSION_STATUSES).optional(),
  })
  .refine((v) => v.from <= v.to, { message: 'Tanggal akhir sebelum tanggal awal', path: ['to'] })
  .refine((v) => Date.parse(v.to) - Date.parse(v.from) <= 30 * 86_400_000, {
    message: 'Rentang maksimal 31 hari',
    path: ['to'],
  });

/** Grid minggu (model tampilan `weeklyScheduleSchema`): mulai Senin. */
export const scheduleWeekQuerySchema = z.strictObject({
  weekStart: serviceDateSchema.refine(isMonday, 'Minggu jadwal dimulai hari Senin'),
  unitId: z.uuid().optional(),
});

/** Kuota dokter hari ini di meja pendaftaran (model tampilan `practitionerQuotaSchema[]`). */
export const todayQuotaQuerySchema = z.strictObject({
  unitId: z.uuid().optional(),
  poliCode: z.string().regex(POLI_CODE_PATTERN).optional(),
});

/** Ubah kuota satu sesi. Di bawah jumlah booking → 409 `QUOTA_BELOW_BOOKED` (juga dijaga CHECK database). */
export const updateSessionQuotaSchema = z.strictObject({ quotaJkn: quotaCount, quotaNonJkn: quotaCount });
export type UpdateSessionQuotaInput = z.infer<typeof updateSessionQuotaSchema>;

/** Catat cuti pada sesi praktik; dokter pengganti (poli yang sama) opsional. */
export const recordLeaveSchema = z.strictObject({
  reason: changeReasonSchema,
  substitutePractitionerId: z.uuid().nullable(),
});
export type RecordLeaveInput = z.infer<typeof recordLeaveSchema>;

export const leaveResultSchema = z.strictObject({
  session: scheduleSessionSchema,
  /** Booking aktif di sesi ini yang perlu dialihkan atau diberi tahu. */
  affectedBookings: z.number().int().min(0),
});

/**
 * Alihkan booking dari sesi cuti: `substitute` = tetap di sesi ini dengan dokter pengganti (pasien diberi tahu),
 * `session` = pindah ke sesi lain (kuota tujuan tidak cukup → 409 `QUOTA_FULL`, tidak ada yang dipindah sebagian).
 * Pemberitahuan WhatsApp lewat outbox, tanpa isi klinis (keputusan fase 2 no. 8).
 */
export const transferBookingsSchema = z.strictObject({
  target: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('substitute') }),
    z.strictObject({ kind: z.literal('session'), sessionId: z.uuid() }),
  ]),
  notifyPatients: z.boolean().default(true),
});
export type TransferBookingsInput = z.infer<typeof transferBookingsSchema>;

export const transferResultSchema = z.strictObject({
  moved: z.number().int().min(0),
  notified: z.number().int().min(0),
});

// ---------------------------------------------------------------------------------------------------------------
// HFIS (operasi outbox `bpjs.hfis.update`; tarik HFIS lewat lookup baca-saja ADR-0025 atau job berkala)
// ---------------------------------------------------------------------------------------------------------------

/** Kirim jadwal ke HFIS: per dokter, per unit, atau semua yang berbeda (kosong). */
export const hfisPushSchema = z.strictObject({
  practitionerIds: z.array(z.uuid()).min(1).max(100).optional(),
  unitId: z.uuid().optional(),
});
export type HfisPushInput = z.infer<typeof hfisPushSchema>;

export const hfisPushResultSchema = z.strictObject({
  /** Pesan outbox yang diantrekan (per dokter × poli). */
  queued: z.number().int().min(0),
});
