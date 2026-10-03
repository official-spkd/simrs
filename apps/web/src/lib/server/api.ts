import 'server-only';
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
