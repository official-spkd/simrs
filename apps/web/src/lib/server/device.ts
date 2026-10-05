import 'server-only';
import { type DevicePrincipalKind, type DeviceSelf, deviceSelfSchema } from '@simrs/shared';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { clientInfo } from '../client-info';
import { enrolUrl } from '../perangkat';
import { PATH_HEADER } from '../request-path';
import { ApiError, callApi } from './api-core';
import { cookieNames, parseDeviceToken } from './cookies';
import { webEnv } from './web-env';

/**
 * ADR-0027 · Perangkat terdaftar yang membuka layar ini (anjungan/TV), menurut API (`/devices/me`), sekali per render.
 * Token `dv1` hanya dibaca server dari cookie httpOnly. `null` bila tidak ada cookie, kredensial dicabut/kedaluwarsa,
 * atau token bukan token perangkat. API tidak terjangkau dilempar ke error boundary.
 */
export const getDevice = cache(async (): Promise<DeviceSelf | null> => {
  const env = webEnv();
  const token = parseDeviceToken((await cookies()).get(cookieNames(env.secureCookies).device)?.value);
  if (!token) return null;
  try {
    return await callApi(env.apiBaseUrl, '/api/v1/devices/me', {
      schema: deviceSelfSchema,
      accessToken: token,
      client: clientInfo(await headers()),
    });
  } catch (err) {
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) return null;
    throw err;
  }
});

export type DeviceAccess =
  | { ok: true; device: DeviceSelf }
  /** Perangkat sah tetapi jenisnya lain (mis. TV membuka /kiosk): halaman menjelaskan, tidak mengalihkan. */
  | { ok: false; device: DeviceSelf };

/**
 * Wajib dipanggil di setiap layar perangkat mode api. Tanpa perangkat terdaftar → halaman pendaftaran perangkat
 * (bukan /masuk: layar ini tidak pernah memakai login staf).
 */
export async function requireDevice(kind: DevicePrincipalKind): Promise<DeviceAccess> {
  const device = await getDevice();
  if (!device) redirect(enrolUrl((await headers()).get(PATH_HEADER)));
  return device.kind === kind ? { ok: true, device } : { ok: false, device };
}
