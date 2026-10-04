import { z } from 'zod';

/**
 * F01–F08 · Kode galat front office (fase 2) beserta status HTTP dan pesan bawaannya. Dipisah agar modul domain
 * cukup memanggil `frontOfficeError(kode)`; pesan boleh dipertajam di pemanggil, kode dan status tetap.
 * Galat BPJS: `BPJS_UNAVAILABLE` = tidak terjangkau/timeout (coba lagi, pendaftaran jalan terus);
 * `BPJS_REJECTED` = BPJS menjawab dengan galat bisnis (`metaData.code` ≠ 200 walau HTTP 200).
 */
export const FRONT_OFFICE_ERRORS = {
  // F01 · Jadwal dan kuota
  QUOTA_FULL: { status: 409, message: 'Kuota sesi ini sudah penuh' },
  QUOTA_BELOW_BOOKED: {
    status: 409,
    message: 'Kuota tidak boleh di bawah jumlah pasien yang sudah booking',
  },
  SESSION_CLOSED: {
    status: 409,
    message: 'Sesi praktik ini tidak menerima pasien (cuti, batal, atau lewat)',
  },
  SCHEDULE_OVERLAP: { status: 409, message: 'Jadwal bentrok dengan jadwal lain dokter ini' },
  // F02 · Booking
  BOOKING_NOT_FOUND: { status: 404, message: 'Booking tidak ditemukan' },
  BOOKING_OUT_OF_RANGE: { status: 422, message: 'Tanggal booking di luar rentang yang diizinkan' },
  BOOKING_DUPLICATE: { status: 409, message: 'Pasien sudah punya booking di poli dan tanggal yang sama' },
  BOOKING_STATE_INVALID: { status: 409, message: 'Status booking tidak mengizinkan tindakan ini' },
  // F04 · Antrean
  QUEUE_EMPTY: { status: 409, message: 'Tidak ada antrean yang menunggu' },
  TICKET_STATE_INVALID: { status: 409, message: 'Status tiket antrean tidak mengizinkan tindakan ini' },
  // F03/F06 · Registrasi, penjaminan, SEP
  ENCOUNTER_DUPLICATE: {
    status: 409,
    message: 'Pasien sudah terdaftar di layanan yang sama dan masih aktif',
  },
  ENCOUNTER_STATE_INVALID: { status: 409, message: 'Status kunjungan tidak mengizinkan tindakan ini' },
  GENERAL_CONSENT_REQUIRED: { status: 422, message: 'Persetujuan umum belum ada' },
  IDEMPOTENCY_KEY_REQUIRED: { status: 400, message: 'Header Idempotency-Key wajib untuk permintaan ini' },
  IDEMPOTENCY_KEY_REUSED: {
    status: 409,
    message: 'Idempotency-Key sudah dipakai untuk permintaan dengan isi berbeda',
  },
  COVERAGE_LOCKED: { status: 409, message: 'Penjaminan terkunci karena SEP sudah terbit' },
  SEP_DUPLICATE: { status: 409, message: 'SEP untuk kunjungan ini sudah ada' },
  SEP_STATE_INVALID: { status: 409, message: 'Status SEP tidak mengizinkan tindakan ini' },
  REFERRAL_EXPIRED: { status: 422, message: 'Rujukan sudah tidak berlaku' },
  REFERRAL_STATE_INVALID: { status: 409, message: 'Status rujukan tidak mengizinkan tindakan ini' },
  BPJS_UNAVAILABLE: { status: 503, message: 'Layanan BPJS tidak dapat dihubungi. Coba lagi sebentar.' },
  BPJS_REJECTED: { status: 422, message: 'Permintaan ditolak BPJS' },
  BPJS_PARTICIPANT_NOT_FOUND: { status: 404, message: 'Peserta BPJS tidak ditemukan' },
  BPJS_PARTICIPANT_INACTIVE: { status: 422, message: 'Kepesertaan BPJS tidak aktif' },
  // F05 · Perangkat dan anjungan
  DEVICE_NOT_ALLOWED: { status: 403, message: 'Perangkat atau akun ini tidak berhak memakai layanan ini' },
  KIOSK_LOOKUP_EXPIRED: { status: 410, message: 'Sesi anjungan berakhir. Ulangi dari awal.' },
  KIOSK_NEEDS_COUNTER: { status: 422, message: 'Silakan ke loket pendaftaran untuk dibantu petugas' },
} as const satisfies Record<string, { status: number; message: string }>;

export type FrontOfficeErrorCode = keyof typeof FRONT_OFFICE_ERRORS;

/** Urutan tetap (bagian dari `ERROR_CODES`). */
export const FRONT_OFFICE_ERROR_CODES = [
  'QUOTA_FULL',
  'QUOTA_BELOW_BOOKED',
  'SESSION_CLOSED',
  'SCHEDULE_OVERLAP',
  'BOOKING_NOT_FOUND',
  'BOOKING_OUT_OF_RANGE',
  'BOOKING_DUPLICATE',
  'BOOKING_STATE_INVALID',
  'QUEUE_EMPTY',
  'TICKET_STATE_INVALID',
  'ENCOUNTER_DUPLICATE',
  'ENCOUNTER_STATE_INVALID',
  'GENERAL_CONSENT_REQUIRED',
  'IDEMPOTENCY_KEY_REQUIRED',
  'IDEMPOTENCY_KEY_REUSED',
  'COVERAGE_LOCKED',
  'SEP_DUPLICATE',
  'SEP_STATE_INVALID',
  'REFERRAL_EXPIRED',
  'REFERRAL_STATE_INVALID',
  'BPJS_UNAVAILABLE',
  'BPJS_REJECTED',
  'BPJS_PARTICIPANT_NOT_FOUND',
  'BPJS_PARTICIPANT_INACTIVE',
  'DEVICE_NOT_ALLOWED',
  'KIOSK_LOOKUP_EXPIRED',
  'KIOSK_NEEDS_COUNTER',
] as const satisfies readonly FrontOfficeErrorCode[];

/** Kode galat stabil. Klien boleh bergantung pada kode ini; pesan boleh berubah. */
export const ERROR_CODES = [
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'MFA_REQUIRED',
  'PASSWORD_CHANGE_REQUIRED',
  'PASSWORD_POLICY',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'DOCUMENT_INTEGRITY',
  'TENANT_REQUIRED',
  'TENANT_MISMATCH',
  'MODULE_DISABLED',
  'CDS_BLOCKED',
  'WEBHOOK_SIGNATURE_INVALID',
  'WEBHOOK_TIMESTAMP_EXPIRED',
  'INTEGRATION_UNAVAILABLE',
  'INTERNAL_ERROR',
  ...FRONT_OFFICE_ERROR_CODES,
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const errorBodySchema = z.object({
  code: z.enum(ERROR_CODES),
  message: z.string(),
  details: z.unknown().optional(),
  requestId: z.string().optional(),
});

export type ErrorBody = z.infer<typeof errorBodySchema>;

export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly status = 400,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

/** Galat front office dengan status dan pesan bawaan (`message` opsional untuk pesan yang lebih spesifik). */
export function frontOfficeError(code: FrontOfficeErrorCode, details?: unknown, message?: string): AppError {
  const def = FRONT_OFFICE_ERRORS[code];
  return new AppError(code, message ?? def.message, def.status, details);
}
