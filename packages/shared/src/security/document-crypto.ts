import { createHash, randomBytes } from 'node:crypto';

/** P08 · Hash isi berkas dan kode verifikasi TTE (hanya sisi server). */

export const sha256Hex = (bytes: Uint8Array | string): string =>
  createHash('sha256').update(bytes).digest('hex');

/**
 * Kode verifikasi baru untuk QR (`sv1.<tenant>.<acak 256 bit>`). Disimpan apa adanya agar QR bisa dicetak
 * ulang: kode hanya membuka info non-PHI (penanda tangan, waktu, hash), acaknya mencegah penelusuran berurutan.
 */
export const newVerifyCode = (tenantId: string): string =>
  `sv1.${tenantId}.${randomBytes(32).toString('base64url')}`;
