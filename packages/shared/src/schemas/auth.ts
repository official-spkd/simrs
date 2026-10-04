import { z } from 'zod';
import { PASSWORD_MAX_LENGTH } from '../security/password-policy';
import { PIN_MAX_ACCOUNTS_PER_BROWSER } from '../security/pin-policy';

/** P02 · Skema permintaan login dan sesi (dipakai API dan web). */
export const USERNAME = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9._@-]{2,99}$/, 'NIP atau email RS tidak valid');

export const loginSchema = z.strictObject({
  /** Wajib di lokal/staging; di produksi RS ditentukan dari subdomain. */
  tenantCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9][A-Z0-9-]{1,29}$/)
    .optional(),
  username: USERNAME,
  // Batas panjang mencegah DoS lewat hashing input raksasa.
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  /** Token "percayai perangkat ini" (cookie httpOnly di web): bila sah untuk akun ini, langkah MFA dilewati. */
  trustedDeviceToken: z.string().min(20).max(300).optional(),
});

export const mfaVerifySchema = z.strictObject({
  challengeToken: z.string().min(20).max(300),
  code: z.string().regex(/^\d{6}$/, 'Kode 6 digit'),
  /** Percayai perangkat ini selama `TRUSTED_DEVICE_HOURS` jam (hanya komputer milik RS). */
  trustDevice: z.boolean().optional(),
});

/** Lama "percayai perangkat ini" (mockup Login). */
export const TRUSTED_DEVICE_HOURS = 12;

/** Kanal kode cadangan saat tidak punya akses aplikasi autentikator (mockup Login: WhatsApp). */
export const BACKUP_CODE_CHANNELS = ['whatsapp', 'email'] as const;
export type BackupCodeChannel = (typeof BACKUP_CODE_CHANNELS)[number];
/** Maks. kiriman kode cadangan per tantangan login. */
export const BACKUP_CODE_MAX_SENDS = 3;
export const AUTH_BACKUP_CODE_OPERATION = 'auth.backup_code';

export const mfaBackupCodeSchema = z.strictObject({
  challengeToken: z.string().min(20).max(300),
  channel: z.enum(BACKUP_CODE_CHANNELS),
});

export const refreshSchema = z.strictObject({ refreshToken: z.string().min(20).max(300) });

export const mfaConfirmSchema = z.strictObject({ code: z.string().regex(/^\d{6}$/, 'Kode 6 digit') });

export const changePasswordSchema = z.strictObject({
  currentPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  newPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});

// ---------------------------------------------------------------------------------------------------------
// PIN masuk cepat di perangkat terdaftar (docs/05 §1, ADR-0024)
// ---------------------------------------------------------------------------------------------------------

const PIN = z.string().regex(/^\d{6}$/, 'PIN harus 6 digit angka');
/** Token perangkat PIN (`sd1`) dari cookie httpOnly peramban; memuat tenant dan ID pendaftaran. */
const PIN_DEVICE_TOKEN = z.string().min(20).max(300);

/** Daftarkan perangkat ini untuk PIN (dari login penuh, untuk posisi sesi saat ini). */
export const pinRegisterSchema = z.strictObject({
  name: z
    .string()
    .trim()
    .min(3, 'Nama perangkat minimal 3 karakter')
    .max(60, 'Nama perangkat maksimal 60 karakter'),
  pin: PIN,
  /** Sandi akun saat ini: sesi yang tertinggal terbuka saja tidak cukup untuk memasang PIN. */
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});

/** RS dan akun ditentukan oleh token perangkat, jadi tanpa kode RS dan NIP. */
export const pinLoginSchema = z.strictObject({ deviceToken: PIN_DEVICE_TOKEN, pin: PIN });

/** Akun ber-PIN yang diingat peramban ini (untuk pilihan di layar masuk). */
export const pinAccountsSchema = z.strictObject({
  deviceTokens: z.array(PIN_DEVICE_TOKEN).min(1).max(PIN_MAX_ACCOUNTS_PER_BROWSER),
});

/** `details.pin` pada 401 masuk dengan PIN: web menghapus token dari cookie bila bukan `wrong`. */
export const PIN_LOGIN_FAILURES = ['wrong', 'revoked', 'unknown', 'not_allowed'] as const;
export type PinLoginFailure = (typeof PIN_LOGIN_FAILURES)[number];

/** Alasan PIN perangkat dicabut (CHECK `pin_devices_revoked_reason`). */
export const PIN_REVOKE_REASONS = [
  'user_removed',
  'admin_revoked',
  'too_many_attempts',
  'password_changed',
  'password_reset',
  'mfa_reset',
  'user_disabled',
  'assignment_ended',
] as const;
export type PinRevokeReason = (typeof PIN_REVOKE_REASONS)[number];

export type LoginInput = z.infer<typeof loginSchema>;
export type MfaVerifyInput = z.infer<typeof mfaVerifySchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type PinRegisterInput = z.infer<typeof pinRegisterSchema>;
export type PinLoginInput = z.infer<typeof pinLoginSchema>;

/** Token sesi yang dikembalikan API. */
export interface SessionTokens {
  accessToken: string;
  accessExpiresAt: string;
  refreshToken: string;
  refreshExpiresAt: string;
}
