'use server';

import {
  type DevicePrincipalKind,
  enrolDeviceSchema,
  enrolledDeviceSchema,
  normalizeEnrolmentCode,
} from '@simrs/shared';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { deviceLanding } from '@/lib/perangkat';
import { api } from '@/lib/server/api';
import { ApiError } from '@/lib/server/api-core';
import { writeDeviceCookie } from '@/lib/server/cookies';
import { webEnv } from '@/lib/server/web-env';

export interface EnrolState {
  error?: string;
  fields?: Record<string, string>;
  /** Hanya kode RS yang dikembalikan untuk mengisi ulang formulir (kode pendaftaran tidak). */
  values?: { tenantCode: string };
}

/**
 * ADR-0027 · Perangkat (anjungan/TV) menukar kode pendaftaran dari admin dengan kredensialnya. Tanpa login staf:
 * token `dv1` hanya disimpan di cookie httpOnly perangkat ini, lalu layar dialihkan ke halaman jenis perangkatnya.
 * Next menolak action lintas asal (Origin ≠ Host); API membatasi laju dan mencatat setiap percobaan.
 */
export async function enrolDeviceAction(_prev: EnrolState, formData: FormData): Promise<EnrolState> {
  const env = webEnv();
  const tenantCode = env.tenantCodeField ? String(formData.get('tenantCode') ?? '').trim() : '';
  const code = String(formData.get('code') ?? '');
  const values = { tenantCode };
  const fields: Record<string, string> = {};
  if (env.tenantCodeField && !tenantCode) fields.tenantCode = 'Kode RS wajib diisi.';
  if (!code.trim()) fields.code = 'Kode pendaftaran wajib diisi.';
  else if (!normalizeEnrolmentCode(code)) fields.code = 'Kode pendaftaran terdiri dari 10 huruf/angka.';
  if (Object.keys(fields).length > 0) return { fields, values };

  const parsed = enrolDeviceSchema.safeParse({ code, tenantCode: tenantCode || undefined });
  if (!parsed.success) return { fields: { tenantCode: 'Kode RS tidak valid.' }, values };

  let result: { token: string; expiresAt: string; device: { kind: DevicePrincipalKind } };
  try {
    result = await api('/api/v1/devices/enrol', {
      method: 'POST',
      auth: false,
      body: parsed.data,
      schema: enrolledDeviceSchema,
    });
  } catch (err) {
    if (err instanceof ApiError && err.status === 429) {
      return { error: 'Terlalu banyak percobaan. Tunggu satu menit, lalu coba lagi.', values };
    }
    return { error: err instanceof ApiError ? err.message : 'Terjadi kesalahan. Coba lagi.', values };
  }
  writeDeviceCookie(await cookies(), { token: result.token, expiresAt: result.expiresAt }, env.secureCookies);
  redirect(deviceLanding(result.device.kind, String(formData.get('lanjut') ?? '')));
}
