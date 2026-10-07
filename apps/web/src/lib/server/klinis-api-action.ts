import 'server-only';
import { redirect } from 'next/navigation';
import { ApiError } from './api-core';
import { getSession } from './session';
import { can, nextLoginStep } from '../session-view';
import type { SessionView } from '../session-view';

/**
 * Bantuan Server Action layar klinis mode api (W3, pola Pendaftaran fase 2): sesi + izin diperiksa di sini agar pesannya
 * jelas, lalu ditegakkan ulang API (izin, ABAC, gerbang keselamatan). Galat API diteruskan sebagai pesan untuk pengguna
 * (kode stabil ikut), tidak pernah sebagai 500 di layar.
 */

export type ApiActionResult<T> = { ok: true; data: T } | { ok: false; message: string; code?: string };

/** Sesi lengkap pemegang izin `perm` (`resource.action`); selain itu hasil gagal berpesan. Belum login → /masuk. */
export async function authorizeApi(
  perm: string,
  denied: string,
): Promise<{ ok: true; session: SessionView } | { ok: false; message: string }> {
  const s = await getSession();
  if (!s || nextLoginStep(s, false) !== 'selesai') redirect('/masuk');
  const [resource, action] = perm.split('.') as [string, string];
  return can(s, resource, action) ? { ok: true, session: s } : { ok: false, message: denied };
}

export function apiFailure(err: unknown): { ok: false; message: string; code?: string } {
  if (err instanceof ApiError) {
    if (err.status === 401) redirect('/masuk');
    return { ok: false, code: err.code, message: err.message };
  }
  return { ok: false, message: 'Terjadi kesalahan. Coba lagi.' };
}

/** Jalankan panggilan API dan bungkus hasil/galatnya. */
export async function attempt<T>(fn: () => Promise<T>): Promise<ApiActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    return apiFailure(err);
  }
}
