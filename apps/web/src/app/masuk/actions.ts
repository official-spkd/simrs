'use server';

import { loginSchema } from '@simrs/shared';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { renderSVG } from 'uqr';
import { z } from 'zod';
import { safeNextPath } from '@/lib/safe-path';
import { api } from '@/lib/server/api';
import { ApiError } from '@/lib/server/api-core';
import {
  ALL_SESSION_COOKIES,
  clearCookies,
  cookieNames,
  writeChallengeCookies,
  writeSessionCookies,
} from '@/lib/server/cookies';
import { enrollStartSchema, loginResultSchema, mfaVerifyResultSchema, okSchema } from '@/lib/server/schemas';
import { getSession } from '@/lib/server/session';
import { webEnv } from '@/lib/server/web-env';

/**
 * Server Action alur masuk. Setiap action adalah endpoint POST publik: input divalidasi ulang di sini, token
 * hanya berpindah antara cookie httpOnly dan API, dan yang dikembalikan ke browser hanya pesan untuk UI.
 * Next menolak action lintas asal (Origin ≠ Host), sehingga CSRF tertutup bersama cookie SameSite=Lax.
 */

export interface FormState {
  error?: string;
  /** Galat per field (nama field → pesan). */
  fields?: Record<string, string>;
  /** Nilai yang aman dikembalikan untuk mengisi ulang formulir (tidak pernah kata sandi). */
  values?: Record<string, string>;
}

/** /masuk dengan tujuan akhir yang sama (dibawa lewat input tersembunyi `lanjut`). */
function stepUrl(formData: FormData): string {
  const next = safeNextPath(String(formData.get('lanjut') ?? ''));
  return next === '/' ? '/masuk' : `/masuk?lanjut=${encodeURIComponent(next)}`;
}

function friendly(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 429) return 'Terlalu banyak percobaan. Tunggu satu menit, lalu coba lagi.';
    return err.message;
  }
  return 'Terjadi kesalahan. Coba lagi.';
}

function sixDigits(value: FormDataEntryValue | null): { code?: string; error?: string } {
  const code = String(value ?? '').replace(/\D/g, '');
  if (code.length === 6) return { code };
  return {
    error:
      code.length === 0
        ? 'Kode verifikasi wajib diisi (6 digit).'
        : `Kode harus 6 digit. Baru terisi ${code.length} digit.`,
  };
}

/** Langkah 1: NIP/email + kata sandi (+ kode RS di lokal/staging). */
export async function loginAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const env = webEnv();
  const username = String(formData.get('username') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const tenantCode = env.tenantCodeField ? String(formData.get('tenantCode') ?? '').trim() : '';
  const values = { username, tenantCode };
  const fields: Record<string, string> = {};
  if (env.tenantCodeField && !tenantCode) fields.tenantCode = 'Kode RS wajib diisi.';
  if (!username) fields.username = 'NIP atau email RS wajib diisi.';
  if (!password) fields.password = 'Kata sandi wajib diisi.';
  if (Object.keys(fields).length > 0) return { fields, values };

  const parsed = loginSchema.safeParse({ username, password, tenantCode: tenantCode || undefined });
  if (!parsed.success) {
    return { error: 'NIP/email atau kata sandi salah, atau akun terkunci sementara.', values };
  }
  let result: z.infer<typeof loginResultSchema>;
  try {
    result = await api('/api/v1/auth/login', {
      method: 'POST',
      auth: false,
      body: parsed.data,
      schema: loginResultSchema,
    });
  } catch (err) {
    return { error: friendly(err), values };
  }

  const store = await cookies();
  clearCookies(store, env.secureCookies, ALL_SESSION_COOKIES);
  if (result.status === 'mfa_required') {
    writeChallengeCookies(
      store,
      { token: result.challengeToken, expiresAt: result.challengeExpiresAt, username: parsed.data.username },
      env.secureCookies,
    );
  } else {
    // Belum punya MFA: sesi terbatas, hanya boleh mendaftarkan MFA dan mengganti sandi (ADR-0011).
    writeSessionCookies(store, result, env.secureCookies);
  }
  redirect(stepUrl(formData));
}

/** Langkah 2: kode TOTP 6 digit untuk tantangan MFA. */
export async function verifyMfaAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const env = webEnv();
  const names = cookieNames(env.secureCookies);
  const store = await cookies();
  const challengeToken = store.get(names.challenge)?.value;
  // Tantangan sudah kedaluwarsa (5 menit): kembali ke langkah 1.
  if (!challengeToken) redirect(stepUrl(formData));
  const { code, error } = sixDigits(formData.get('code'));
  if (!code) return { fields: { code: error ?? '' } };
  let tokens: z.infer<typeof mfaVerifyResultSchema>;
  try {
    tokens = await api('/api/v1/auth/mfa/verify', {
      method: 'POST',
      auth: false,
      body: { challengeToken, code },
      schema: mfaVerifyResultSchema,
    });
  } catch (err) {
    return { fields: { code: friendly(err) } };
  }
  clearCookies(store, env.secureCookies, ['challenge', 'challengeUser']);
  writeSessionCookies(store, tokens, env.secureCookies);
  redirect(stepUrl(formData));
}

export interface EnrollmentState {
  error?: string;
  /** Rahasia TOTP dalam kelompok 4 huruf untuk diketik manual; hanya ditampilkan saat pendaftaran. */
  secret?: string;
  /** Kode QR sebagai data URI SVG (gambar, bukan markup yang disisipkan). */
  qr?: string;
}

/** Langkah 2 (akun tanpa MFA): buat rahasia TOTP baru dan tampilkan QR-nya. */
export async function startEnrollmentAction(): Promise<EnrollmentState> {
  try {
    const r = await api('/api/v1/auth/mfa/enroll', { method: 'POST', schema: enrollStartSchema });
    return {
      secret: r.secret.match(/.{1,4}/g)?.join(' ') ?? r.secret,
      qr: `data:image/svg+xml;utf8,${encodeURIComponent(renderSVG(r.otpauthUri, { border: 2 }))}`,
    };
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect('/masuk');
    return { error: friendly(err) };
  }
}

export async function confirmEnrollmentAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { code, error } = sixDigits(formData.get('code'));
  if (!code) return { fields: { code: error ?? '' } };
  try {
    await api('/api/v1/auth/mfa/enroll/confirm', { method: 'POST', body: { code }, schema: okSchema });
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect('/masuk');
    return { fields: { code: friendly(err) } };
  }
  redirect(stepUrl(formData));
}

/** Kata sandi sementara (dari admin) wajib diganti sebelum memakai sistem. */
export async function changePasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const currentPassword = String(formData.get('currentPassword') ?? '');
  const newPassword = String(formData.get('newPassword') ?? '');
  const confirmPassword = String(formData.get('confirmPassword') ?? '');
  const fields: Record<string, string> = {};
  if (!currentPassword) fields.currentPassword = 'Kata sandi saat ini wajib diisi.';
  if (!newPassword) fields.newPassword = 'Kata sandi baru wajib diisi.';
  else if (newPassword !== confirmPassword)
    fields.confirmPassword = 'Ulangi kata sandi baru dengan persis sama.';
  if (Object.keys(fields).length > 0) return { fields };
  try {
    await api('/api/v1/auth/password', {
      method: 'POST',
      body: { currentPassword, newPassword },
      schema: okSchema,
    });
  } catch (err) {
    if (err instanceof ApiError && err.code === 'PASSWORD_POLICY') {
      const messages = z.object({ messages: z.array(z.string()) }).safeParse(err.details);
      return { fields: { newPassword: messages.success ? messages.data.messages.join(' ') : err.message } };
    }
    if (err instanceof ApiError && err.status === 401) {
      // 401 di sini berarti kata sandi saat ini salah, ATAU sesi sudah berakhir.
      if (!(await getSession())) redirect('/masuk');
      return { fields: { currentPassword: 'Kata sandi saat ini salah.' } };
    }
    return { error: friendly(err) };
  }
  redirect(stepUrl(formData));
}

/** Langkah 3: pilih penugasan (peran × unit) untuk sesi ini. */
export async function selectUnitAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const assignmentId = z.uuid().safeParse(formData.get('assignmentId'));
  if (!assignmentId.success) return { error: 'Pilih salah satu unit untuk melanjutkan.' };
  try {
    await api('/api/v1/auth/assignment', {
      method: 'POST',
      body: { assignmentId: assignmentId.data },
      schema: okSchema,
    });
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect('/masuk');
    return { error: friendly(err) };
  }
  redirect(safeNextPath(String(formData.get('lanjut') ?? '')));
}

/** Keluar: cabut sesi di API (bila masih ada), hapus semua cookie sesi. */
export async function logoutAction(): Promise<void> {
  const env = webEnv();
  try {
    await api('/api/v1/auth/logout', { method: 'POST', schema: okSchema });
  } catch {
    // Sesi mungkin sudah berakhir; cookie tetap dihapus.
  }
  clearCookies(await cookies(), env.secureCookies, ALL_SESSION_COOKIES);
  redirect('/masuk');
}

/** "Kembali ke halaman masuk": batalkan tantangan MFA atau sesi setengah jadi, mulai lagi dari langkah 1. */
export async function restartLoginAction(formData: FormData): Promise<void> {
  const env = webEnv();
  try {
    await api('/api/v1/auth/logout', { method: 'POST', schema: okSchema });
  } catch {
    // Tidak ada sesi (hanya tantangan MFA) atau sudah berakhir.
  }
  clearCookies(await cookies(), env.secureCookies, ALL_SESSION_COOKIES);
  redirect(stepUrl(formData));
}
