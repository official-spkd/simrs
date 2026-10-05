'use server';

import { createDeviceSchema, createdDeviceSchema, formatJam } from '@simrs/shared';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { api } from '@/lib/server/api';
import { ApiError } from '@/lib/server/api-core';
import { okSchema } from '@/lib/server/schemas';
import { getSession } from '@/lib/server/session';
import { can, nextLoginStep } from '@/lib/session-view';

/**
 * ADR-0027 · Server Action perangkat anjungan/TV di layar Akses. Sesi + izin diperiksa di sini untuk pesan yang jelas;
 * API tetap penegak akhir (izin, unit milik RS, audit). Kode pendaftaran hanya dikembalikan sekali ke layar admin.
 */

const PATH = '/sistem/akses/perangkat';

export interface DeviceActionResult {
  ok?: boolean;
  error?: string;
  fields?: Record<string, string>;
  message?: string;
  created?: { name: string; code: string; expiresAt: string };
}

async function authorize(): Promise<string | null> {
  const s = await getSession();
  if (!s || nextLoginStep(s, false) !== 'selesai') redirect('/masuk');
  return can(s, 'iam.users', 'write') ? null : 'Peran Anda tidak berizin untuk aksi ini.';
}

function failure(err: unknown): DeviceActionResult {
  if (err instanceof ApiError) {
    if (err.status === 401) redirect('/masuk');
    if (err.status === 429) return { error: 'Terlalu banyak permintaan. Tunggu sebentar, lalu coba lagi.' };
    return { error: err.message };
  }
  return { error: 'Terjadi kesalahan. Coba lagi.' };
}

const text = (v: FormDataEntryValue | null) => (typeof v === 'string' ? v.trim() : '');

export async function createDeviceAction(
  _prev: DeviceActionResult,
  formData: FormData,
): Promise<DeviceActionResult> {
  const denied = await authorize();
  if (denied) return { error: denied };
  const parsed = createDeviceSchema.safeParse({
    kind: text(formData.get('kind')),
    name: text(formData.get('name')),
    unitId: text(formData.get('unitId')),
  });
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) fields[String(issue.path[0] ?? 'form')] ??= issue.message;
    return { fields };
  }
  try {
    const res = await api('/api/v1/iam/devices', {
      method: 'POST',
      body: parsed.data,
      schema: createdDeviceSchema,
    });
    revalidatePath(PATH);
    return {
      ok: true,
      created: { name: res.device.name, code: res.enrolmentCode, expiresAt: res.enrolmentExpiresAt },
    };
  } catch (err) {
    return failure(err);
  }
}

export async function revokeDeviceAction(
  _prev: DeviceActionResult,
  formData: FormData,
): Promise<DeviceActionResult> {
  const denied = await authorize();
  if (denied) return { error: denied };
  const id = text(formData.get('deviceId'));
  if (!z.uuid().safeParse(id).success) return { error: 'Perangkat tidak valid.' };
  try {
    await api(`/api/v1/iam/devices/${id}/revoke`, { method: 'POST', schema: okSchema });
    revalidatePath(PATH);
    return { ok: true, message: `Perangkat dicabut pukul ${formatJam(new Date())}.` };
  } catch (err) {
    return failure(err);
  }
}
