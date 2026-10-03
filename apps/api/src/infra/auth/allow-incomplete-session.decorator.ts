import { SetMetadata } from '@nestjs/common';

export const ALLOW_INCOMPLETE_SESSION_KEY = 'simrs:allow-incomplete-session';

/**
 * Endpoint boleh dipakai sesi yang belum lengkap: MFA belum diverifikasi/didaftarkan atau kata sandi wajib diganti.
 * Hanya untuk endpoint penyelesaian akun (profil, daftar MFA, ganti kata sandi, logout). Semua endpoint lain
 * menolak sesi seperti itu (403 MFA_REQUIRED / PASSWORD_CHANGE_REQUIRED).
 */
export const AllowIncompleteSession = () => SetMetadata(ALLOW_INCOMPLETE_SESSION_KEY, true);
