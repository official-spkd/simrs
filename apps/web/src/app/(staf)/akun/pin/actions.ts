'use server';

import { pinProblem } from '@simrs/shared';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { api } from '@/lib/server/api';
import { ApiError } from '@/lib/server/api-core';
import {
  addPinToken,
  ALL_SESSION_COOKIES,
  clearCookies,
  cookieNames,
  parsePinTokens,
  pinTokenId,
  removePinTokens,
  writePinTokens,
} from '@/lib/server/cookies';
import { okSchema, pinDevicesSchema, pinRegisterResultSchema } from '@/lib/server/schemas';
import { getSession } from '@/lib/server/session';
import { webEnv } from '@/lib/server/web-env';
import { nextLoginStep } from '@/lib/session-view';

export interface PinFormState {
  error?: string;
  /** Galat per field (nama field → pesan). */
  fields?: Record<string, string>;
  message?: string;
}

async function requireFullSession() {
  const s = await getSession();
  if (!s || nextLoginStep(s, false) !== 'selesai') redirect('/masuk');
  return s;
}

/**
 * Daftarkan peramban ini untuk PIN masuk cepat (ADR-0024). API memeriksa ulang semuanya (sesi penuh, sandi saat ini,
 * peran layanan berunit, PIN tidak lemah); token perangkat dari API hanya masuk ke cookie httpOnly, tidak pernah ke
 * browser. PIN lama akun ini di peramban yang sama dicabut (daftar ulang = ganti PIN).
 */
export async function registerPinAction(_prev: PinFormState, formData: FormData): Promise<PinFormState> {
  const s = await requireFullSession();
  const name = String(formData.get('name') ?? '').trim();
  const pin = String(formData.get('pin') ?? '').trim();
  const pinConfirm = String(formData.get('pinConfirm') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const fields: Record<string, string> = {};
  if (name.length < 3 || name.length > 60) fields.name = 'Nama perangkat 3–60 karakter.';
  const weak = pinProblem(pin, { username: s.user.username });
  if (weak) fields.pin = weak;
  else if (pin !== pinConfirm) fields.pinConfirm = 'Ulangi PIN dengan persis sama.';
  if (!password) fields.password = 'Kata sandi saat ini wajib diisi.';
  if (Object.keys(fields).length > 0) return { fields };

  const env = webEnv();
  const store = await cookies();
  const tokens = parsePinTokens(store.get(cookieNames(env.secureCookies).pinDevices)?.value);
  let previous: string[];
  try {
    const here = new Set(tokens.map(pinTokenId));
    const mine = await api('/api/v1/auth/pin/devices', { schema: pinDevicesSchema });
    previous = mine.filter((d) => here.has(d.id)).map((d) => d.id);
    const r = await api('/api/v1/auth/pin/devices', {
      method: 'POST',
      body: { name, pin, password },
      schema: pinRegisterResultSchema,
    });
    writePinTokens(store, addPinToken(removePinTokens(tokens, previous), r.token), env.secureCookies);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect('/masuk');
    const field = err instanceof ApiError ? z.object({ field: z.string() }).safeParse(err.details) : null;
    const message = err instanceof ApiError ? err.message : 'Terjadi kesalahan. Coba lagi.';
    if (field?.success) return { fields: { [field.data.field]: message } };
    return {
      error:
        err instanceof ApiError && err.status === 429
          ? 'Terlalu banyak percobaan. Tunggu satu menit.'
          : message,
    };
  }
  for (const id of previous) {
    try {
      await api(`/api/v1/auth/pin/devices/${id}/revoke`, { method: 'POST', schema: okSchema });
    } catch {
      // PIN lama tetap tercantum di daftar dan bisa dihapus manual.
    }
  }
  revalidatePath('/akun/pin');
  return {
    message: previous.length
      ? 'PIN di perangkat ini sudah diganti.'
      : 'Perangkat ini terdaftar. Lain kali pilih nama Anda di layar masuk, lalu ketik PIN.',
  };
}

/** Hapus PIN di salah satu perangkat; bila itu perangkat sesi PIN ini, sesi berakhir dan kembali ke layar masuk. */
export async function removePinDeviceAction(_prev: PinFormState, formData: FormData): Promise<PinFormState> {
  await requireFullSession();
  const id = z.uuid().safeParse(formData.get('deviceId'));
  if (!id.success) return { error: 'Perangkat tidak dikenal.' };
  const env = webEnv();
  const store = await cookies();
  let current: boolean;
  try {
    const mine = await api('/api/v1/auth/pin/devices', { schema: pinDevicesSchema });
    const target = mine.find((d) => d.id === id.data);
    if (!target) return { error: 'Perangkat ber-PIN tidak ditemukan atau sudah dihapus.' };
    current = target.current;
    await api(`/api/v1/auth/pin/devices/${id.data}/revoke`, { method: 'POST', schema: okSchema });
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect('/masuk');
    return { error: err instanceof ApiError ? err.message : 'Terjadi kesalahan. Coba lagi.' };
  }
  const name = cookieNames(env.secureCookies).pinDevices;
  writePinTokens(
    store,
    removePinTokens(parsePinTokens(store.get(name)?.value), [id.data]),
    env.secureCookies,
  );
  if (current) {
    clearCookies(store, env.secureCookies, ALL_SESSION_COOKIES);
    redirect('/masuk');
  }
  revalidatePath('/akun/pin');
  return { message: 'PIN di perangkat itu sudah dihapus.' };
}
