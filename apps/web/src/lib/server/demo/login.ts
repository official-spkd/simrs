import 'server-only';
import { base32Decode, totpCode, totpStep } from '@simrs/shared/node';
import { cookies } from 'next/headers';
import { api } from '../api';
import { ApiError } from '../api-core';
import { ALL_SESSION_COOKIES, clearCookies, writeSessionCookies } from '../cookies';
import { assertDemo } from '../demo-guard';
import { loginResultSchema, mfaVerifyResultSchema, okSchema } from '../schemas';
import { webEnv } from '../web-env';
import type { PresentationAccount } from './accounts';

/**
 * Masuk sebagai akun presentasi (ADR-0023) lewat alur login BIASA: kata sandi → kode TOTP dari rahasia lokal →
 * sesi. Tidak ada jalan pintas di API: kunci akun, batas laju, MFA, dan jejak audit `login` tetap berlaku.
 * Sesi yang sedang aktif diakhiri lebih dulu agar sesi tidak menumpuk.
 */
export async function presentationLogin(
  tenantCode: string,
  account: PresentationAccount,
): Promise<{ error?: string }> {
  assertDemo();
  const env = webEnv();
  const store = await cookies();
  try {
    await api('/api/v1/auth/logout', { method: 'POST', schema: okSchema });
  } catch {
    // Belum ada sesi atau sudah berakhir.
  }
  clearCookies(store, env.secureCookies, ALL_SESSION_COOKIES);

  const friendly = (err: unknown) =>
    err instanceof ApiError
      ? err.status === 429
        ? 'Terlalu banyak percobaan masuk. Tunggu satu menit, lalu coba lagi.'
        : err.message
      : 'API tidak dapat dihubungi. Pastikan `pnpm dev:demo` berjalan.';

  let result;
  try {
    result = await api('/api/v1/auth/login', {
      method: 'POST',
      auth: false,
      body: { tenantCode, username: account.username, password: account.password },
      schema: loginResultSchema,
    });
  } catch (err) {
    return {
      error:
        err instanceof ApiError && err.status === 401
          ? 'Akun presentasi ditolak (sandi berubah atau akun nonaktif). Jalankan ulang `pnpm db:akun-presentasi`.'
          : friendly(err),
    };
  }
  if (result.status !== 'mfa_required') {
    writeSessionCookies(store, result, env.secureCookies);
    return {};
  }
  // Kode langkah sekarang; bila sudah terpakai (masuk dua kali dalam 30 detik), kode langkah berikutnya.
  const secret = base32Decode(account.totpSecret);
  const now = totpStep();
  for (const step of [now, now + 1]) {
    try {
      const tokens = await api('/api/v1/auth/mfa/verify', {
        method: 'POST',
        auth: false,
        body: { challengeToken: result.challengeToken, code: totpCode(secret, step) },
        schema: mfaVerifyResultSchema,
      });
      writeSessionCookies(store, tokens, env.secureCookies);
      return {};
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 401)) return { error: friendly(err) };
    }
  }
  return { error: 'Kode verifikasi akun presentasi ditolak. Jalankan ulang `pnpm db:akun-presentasi`.' };
}
