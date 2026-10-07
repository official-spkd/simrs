import 'server-only';
import { errorBodySchema } from '@simrs/shared';
import { cookies, headers } from 'next/headers';
import type { z } from 'zod';
import { clientInfo } from '../client-info';
import { type ApiCall, ApiError, callApi } from './api-core';
import { cookieNames } from './cookies';
import { webEnv } from './web-env';

/**
 * Panggil API dari Server Component atau Server Action: token akses dari cookie httpOnly, info klien dari
 * header permintaan. Satu-satunya pintu web ke API (Data Access Layer); komponen klien tidak pernah memanggil
 * API langsung dan tidak pernah melihat token.
 */
export async function api<S extends z.ZodType>(
  path: string,
  call: Omit<ApiCall<S>, 'client' | 'accessToken'> & { auth?: boolean },
): Promise<z.infer<S>> {
  const env = webEnv();
  const token =
    call.auth === false
      ? null
      : ((await cookies()).get(cookieNames(env.secureCookies).access)?.value ?? null);
  // Tanpa cookie akses tidak perlu bertanya ke API: hasilnya pasti 401.
  if (call.auth !== false && !token) throw new ApiError(401, 'UNAUTHENTICATED', 'Belum login');
  return callApi(env.apiBaseUrl, path, { ...call, accessToken: token, client: clientInfo(await headers()) });
}

/**
 * Unduhan berkas dari API (mis. CSV paket bukti audit) untuk diteruskan Route Handler apa adanya. Galat API
 * dikembalikan sebagai `ApiError` (pesan untuk pengguna), bukan diteruskan mentah.
 */
export async function apiDownload(path: string): Promise<{ body: ArrayBuffer; contentType: string }> {
  const env = webEnv();
  const token = (await cookies()).get(cookieNames(env.secureCookies).access)?.value;
  if (!token) throw new ApiError(401, 'UNAUTHENTICATED', 'Belum login');
  const client = clientInfo(await headers());
  const h = new Headers({ authorization: `Bearer ${token}` });
  if (client.ip) h.set('x-forwarded-for', client.ip);
  if (client.host) h.set('x-forwarded-host', client.host);
  if (client.userAgent) h.set('user-agent', client.userAgent);
  let res: Response;
  try {
    res = await fetch(new URL(path, env.apiBaseUrl), {
      headers: h,
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw new ApiError(
      503,
      'SERVICE_UNAVAILABLE',
      'Layanan SIM RS sedang tidak terjangkau. Coba lagi beberapa saat lagi.',
    );
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { code?: string; message?: string } | null;
    throw new ApiError(res.status, body?.code ?? 'INTERNAL_ERROR', body?.message ?? 'Unduhan gagal');
  }
  return {
    body: await res.arrayBuffer(),
    contentType: res.headers.get('content-type') ?? 'application/octet-stream',
  };
}

/**
 * Unggahan berkas biner ke API (dokumen pasien P08, ADR-0020): isi berkas sebagai `application/octet-stream`,
 * metadata lewat header yang di-percent-encode. Jawaban divalidasi `schema` seperti `api()`.
 */
export async function apiUpload<S extends z.ZodType>(
  path: string,
  call: { bytes: Uint8Array<ArrayBuffer>; headers: Record<string, string>; schema: S },
): Promise<z.infer<S>> {
  const env = webEnv();
  const token = (await cookies()).get(cookieNames(env.secureCookies).access)?.value;
  if (!token) throw new ApiError(401, 'UNAUTHENTICATED', 'Belum login');
  const client = clientInfo(await headers());
  const h = new Headers({
    accept: 'application/json',
    authorization: `Bearer ${token}`,
    'content-type': 'application/octet-stream',
  });
  for (const [k, v] of Object.entries(call.headers)) h.set(k, encodeURIComponent(v));
  if (client.ip) h.set('x-forwarded-for', client.ip);
  if (client.host) h.set('x-forwarded-host', client.host);
  if (client.userAgent) h.set('user-agent', client.userAgent);
  let res: Response;
  try {
    res = await fetch(new URL(path, env.apiBaseUrl), {
      method: 'POST',
      headers: h,
      body: call.bytes,
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw new ApiError(
      503,
      'SERVICE_UNAVAILABLE',
      'Layanan SIM RS sedang tidak terjangkau. Coba lagi beberapa saat lagi.',
    );
  }
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const parsed = errorBodySchema.safeParse(body);
    if (parsed.success) {
      throw new ApiError(res.status, parsed.data.code, parsed.data.message, parsed.data.details);
    }
    throw new ApiError(res.status, 'INTERNAL_ERROR', 'Unggahan gagal');
  }
  const parsed = call.schema.safeParse(body);
  if (!parsed.success) throw new ApiError(502, 'INTERNAL_ERROR', 'Respons layanan tidak sesuai format');
  return parsed.data;
}
