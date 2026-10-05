import { z } from 'zod';
import { BIRTH_DATE } from './patient';
import { APPOINTMENT_STATUSES, bookingCodeSchema } from './booking';
import { queueNoSchema, serviceDateSchema, timeOfDaySchema } from './front-office';
import { queueServiceCodeSchema } from './queue';

/**
 * F08 · Kontrak gateway informasi publik (`/api/v1/public`, rencana fase 2 potongan 8): tanpa login, tenant dari host,
 * dibatasi laju, TANPA PHI. Jadwal + sisa kuota, antrean berjalan, dan status booking (kode + tanggal lahir di body).
 * Ketersediaan bed dan tarif (katalog F08) menyusul setelah K05/U01.
 */

const isoDateTime = z.iso.datetime({ offset: true });
const NAME = z.string().min(1).max(160);
const count = z.number().int().min(0);

export const publicScheduleQuerySchema = z.strictObject({
  date: serviceDateSchema.optional(),
});

export const publicScheduleSchema = z.strictObject({
  date: serviceDateSchema,
  asOf: isoDateTime,
  sessions: z.array(
    z.strictObject({
      poliName: NAME,
      practitionerName: NAME,
      start: timeOfDaySchema,
      end: timeOfDaySchema,
      status: z.enum(['praktik', 'cuti']),
      substituteName: NAME.nullable(),
      remaining: z.strictObject({ jkn: count, nonJkn: count }),
    }),
  ),
});
export type PublicSchedule = z.infer<typeof publicScheduleSchema>;

/** Antrean berjalan per layanan (nomor saja). */
export const publicQueueSchema = z.strictObject({
  asOf: isoDateTime,
  services: z.array(
    z.strictObject({
      code: queueServiceCodeSchema,
      name: NAME,
      current: queueNoSchema.nullable(),
      waiting: count,
    }),
  ),
});
export type PublicQueue = z.infer<typeof publicQueueSchema>;

/**
 * Cek status booking. Kode dan tanggal lahir di body (bukan URL); tidak cocok → 404 `BOOKING_NOT_FOUND` yang sama
 * dengan kode tidak ada (tidak membedakan keduanya).
 */
export const publicBookingStatusQuerySchema = z.strictObject({
  bookingCode: bookingCodeSchema,
  birthDate: BIRTH_DATE,
});
export type PublicBookingStatusQuery = z.infer<typeof publicBookingStatusQuerySchema>;

export const publicBookingStatusSchema = z.strictObject({
  bookingCode: bookingCodeSchema,
  status: z.enum(APPOINTMENT_STATUSES),
  serviceDate: serviceDateSchema,
  start: timeOfDaySchema,
  poliName: NAME,
  practitionerName: NAME,
  queueNo: queueNoSchema,
  /** Nomor yang sedang dilayani di poli itu (hari layanan saja). */
  currentQueueNo: queueNoSchema.nullable(),
  estimatedAt: isoDateTime.nullable(),
});
export type PublicBookingStatus = z.infer<typeof publicBookingStatusSchema>;
