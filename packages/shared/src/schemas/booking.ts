import { z } from 'zod';
import { BOOKING_CODE_PATTERN } from '../numbering';
import {
  bpjsSyncSchema,
  changeReasonSchema,
  cursorPageQuerySchema,
  jknReferenceSchema,
  POLI_CODE_PATTERN,
  queueNoSchema,
  serviceDateSchema,
  timeOfDaySchema,
} from './front-office';
import { queueTicketSchema } from './queue';

/**
 * F02 · Kontrak API booking dan janji temu (`/api/v1/booking/appointments`, rencana fase 2 potongan 3).
 * Membuat booking = memesan kuota sesi secara atomik (`reserveQuota`), kode booking harian 10 digit
 * (`NUMBER_KINDS.booking_code`), nomor antrean poli dicadangkan, dan (JKN) operasi outbox `bpjs.antrean.add`.
 * Pendaftaran walk-in JKN di loket juga membuat booking kanal `loket`: kode booking dibutuhkan task ID BPJS.
 * Izin: `booking.read`, `booking.write` (buat, jadwal ulang, check-in), `booking.cancel`.
 */

const isoDateTime = z.iso.datetime({ offset: true });
const NAME = z.string().min(1).max(160);

/**
 * Kanal booking (`appointments.channel`). `mobile_jkn` lewat web service BPJS (fase 7), `aplikasi` = aplikasi pasien
 * (fase 9), `anjungan` lewat API perangkat; API staf selalu `loket` (booking telepon/WhatsApp dicatat petugas loket).
 */
export const BOOKING_CHANNELS = ['loket', 'anjungan', 'aplikasi', 'mobile_jkn'] as const;
export type BookingChannel = (typeof BOOKING_CHANNELS)[number];
export const BOOKING_CHANNEL_LABEL: Record<BookingChannel, string> = {
  loket: 'Loket',
  anjungan: 'Anjungan',
  aplikasi: 'Aplikasi pasien',
  mobile_jkn: 'Mobile JKN',
};

/**
 * Keranjang kuota sesi (`appointments.quota_bucket`, `reserveQuota`): JKN atau non-JKN (umum/asuransi). Hanya JKN yang
 * dikirim ke Antrean BPJS (mockup Registrasi).
 */
export const QUOTA_BUCKETS = ['jkn', 'non_jkn'] as const;
export type QuotaBucketKind = (typeof QUOTA_BUCKETS)[number];

/**
 * `booked` → `checked_in` (anjungan/loket, task 1) → `completed` (booking dipakai kunjungan/registrasi, task 3);
 * `cancelled` (kuota dilepas, task 99; jadwal ulang = batal + booking baru), `no_show` (job akhir hari).
 */
export const APPOINTMENT_STATUSES = ['booked', 'checked_in', 'completed', 'cancelled', 'no_show'] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];
export const APPOINTMENT_STATUS_LABEL: Record<AppointmentStatus, string> = {
  booked: 'Terjadwal',
  checked_in: 'Sudah check-in',
  completed: 'Terdaftar',
  cancelled: 'Dibatalkan',
  no_show: 'Tidak hadir',
};

export const bookingCodeSchema = z.string().trim().regex(BOOKING_CODE_PATTERN, 'Kode booking 10 digit angka');

export const createBookingSchema = z
  .strictObject({
    patientId: z.uuid(),
    sessionId: z.uuid(),
    quotaBucket: z.enum(QUOTA_BUCKETS),
    /** Wajib untuk JKN (Antrean BPJS: jenis kunjungan + nomor rujukan/surat kontrol); dilarang untuk non-JKN. */
    jkn: jknReferenceSchema.optional(),
  })
  .refine((v) => (v.quotaBucket === 'jkn') === (v.jkn !== undefined), {
    message: 'Booking JKN wajib menyertakan rujukan/surat kontrol; non-JKN tanpa rujukan',
    path: ['jkn'],
  });
export type CreateBookingInput = z.infer<typeof createBookingSchema>;

export const bookingSchema = z.strictObject({
  id: z.uuid(),
  bookingCode: bookingCodeSchema,
  status: z.enum(APPOINTMENT_STATUSES),
  channel: z.enum(BOOKING_CHANNELS),
  quotaBucket: z.enum(QUOTA_BUCKETS),
  patientId: z.uuid(),
  sessionId: z.uuid(),
  serviceDate: serviceDateSchema,
  start: timeOfDaySchema,
  end: timeOfDaySchema,
  practitionerId: z.uuid(),
  practitionerName: NAME,
  /** Layanan antrean poli. */
  serviceId: z.uuid(),
  poliCode: z.string().regex(POLI_CODE_PATTERN),
  poliName: NAME,
  /** Nomor antrean poli yang dicadangkan saat booking. */
  queueNo: queueNoSchema,
  /** Estimasi dilayani (dikirim ke Antrean BPJS). */
  estimatedAt: isoDateTime.nullable(),
  jkn: jknReferenceSchema.nullable(),
  checkedInAt: isoDateTime.nullable(),
  cancelledAt: isoDateTime.nullable(),
  cancelReason: z.string().max(300).nullable(),
  /** Status `bpjs.antrean.add` (non-JKN: `not_required`). */
  bpjs: bpjsSyncSchema,
  createdAt: isoDateTime,
});
export type Booking = z.infer<typeof bookingSchema>;

export const bookingListQuerySchema = z.strictObject({
  ...cursorPageQuerySchema.shape,
  serviceDate: serviceDateSchema.optional(),
  sessionId: z.uuid().optional(),
  patientId: z.uuid().optional(),
  status: z.enum(APPOINTMENT_STATUSES).optional(),
});
export type BookingListQuery = z.infer<typeof bookingListQuerySchema>;

/** Batal: kuota dilepas (`releaseQuota`), task 99. Hanya `booked`/`checked_in`, selain itu 409 `BOOKING_STATE_INVALID`. */
export const cancelBookingSchema = z.strictObject({ reason: changeReasonSchema });
export type CancelBookingInput = z.infer<typeof cancelBookingSchema>;

/** Jadwal ulang = booking lama `cancelled` (alasan dicatat, kuota dilepas) + booking baru (kode baru) di sesi lain. */
export const rescheduleBookingSchema = z.strictObject({ sessionId: z.uuid(), reason: changeReasonSchema });
export const rescheduleResultSchema = z.strictObject({ cancelled: bookingSchema, booking: bookingSchema });
export type RescheduleBookingInput = z.infer<typeof rescheduleBookingSchema>;

/**
 * Hasil check-in (hari layanan saja, selain itu 409 `BOOKING_STATE_INVALID`): task 1. Pasien JKN mendapat tiket
 * loket pendaftaran untuk SEP; null bila langsung ke poli.
 */
export const checkInResultSchema = z.strictObject({
  booking: bookingSchema,
  counterTicket: queueTicketSchema.nullable(),
});
export type CheckInResult = z.infer<typeof checkInResultSchema>;
