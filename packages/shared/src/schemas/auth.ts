import { z } from 'zod';
import { PASSWORD_MAX_LENGTH } from '../security/password-policy';

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
});

export const mfaVerifySchema = z.strictObject({
  challengeToken: z.string().min(20).max(300),
  code: z.string().regex(/^\d{6}$/, 'Kode 6 digit'),
});

export const refreshSchema = z.strictObject({ refreshToken: z.string().min(20).max(300) });

export const mfaConfirmSchema = z.strictObject({ code: z.string().regex(/^\d{6}$/, 'Kode 6 digit') });

export const changePasswordSchema = z.strictObject({
  currentPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  newPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type MfaVerifyInput = z.infer<typeof mfaVerifySchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

/** Token sesi yang dikembalikan API. */
export interface SessionTokens {
  accessToken: string;
  accessExpiresAt: string;
  refreshToken: string;
  refreshExpiresAt: string;
}
