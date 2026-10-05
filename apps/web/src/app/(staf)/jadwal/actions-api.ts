'use server';

import {
  changeReasonSchema,
  formatJam,
  hfisPushResultSchema,
  leaveResultSchema,
  scheduleSessionSchema,
  transferResultSchema,
} from '@simrs/shared';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { api } from '@/lib/server/api';
import { ApiError } from '@/lib/server/api-core';
import { getSession } from '@/lib/server/session';
import { can, nextLoginStep } from '@/lib/session-view';

/**
 * Server Action layar Jadwal dokter mode api (F01): sesi + izin diperiksa di sini (pesan jelas) dan ditegakkan API
 * (`schedule.write` / `schedule.sync`, kuota tidak di bawah booking, versi sesi). Semua perubahan diaudit API.
 */

const PATH = '/jadwal';

export interface JadwalApiResult {
  ok: boolean;
  message: string;
}

async function authorize(action: 'write' | 'sync'): Promise<JadwalApiResult | null> {
  const s = await getSession();
  if (!s || nextLoginStep(s, false) !== 'selesai') redirect('/masuk');
  if (can(s, 'schedule', action)) return null;
  return {
    ok: false,
    message:
      action === 'sync'
        ? 'Peran Anda tidak berizin mengirim atau menarik jadwal HFIS.'
        : 'Peran Anda tidak berizin mengubah jadwal.',
  };
}

function failure(err: unknown): JadwalApiResult {
  if (err instanceof ApiError) {
    if (err.status === 401) redirect('/masuk');
    return { ok: false, message: err.message };
  }
  return { ok: false, message: 'Terjadi kesalahan. Coba lagi.' };
}

const at = () => formatJam(new Date());

const quotaInput = z.strictObject({
  sessionId: z.uuid(),
  quotaJkn: z.number().int().min(0).max(500),
  quotaNonJkn: z.number().int().min(0).max(500),
  baseUpdatedAt: z.iso.datetime({ offset: true }).optional(),
});

/** Simpan kuota satu sesi (tidak di bawah booking; ditolak bila sesi sudah diubah orang lain). */
export async function saveQuotaAction(input: unknown): Promise<JadwalApiResult> {
  const denied = await authorize('write');
  if (denied) return denied;
  const p = quotaInput.safeParse(input);
  if (!p.success) return { ok: false, message: 'Kuota tidak dikenali. Muat ulang halaman.' };
  const { sessionId, ...body } = p.data;
  try {
    await api(`/api/v1/scheduling/sessions/${sessionId}/quota`, {
      method: 'PATCH',
      body,
      schema: scheduleSessionSchema,
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath(PATH);
  return {
    ok: true,
    message: `Kuota tersimpan · ${at()}. Kapasitas di HFIS diubah lewat aplikasi HFIS bila berbeda.`,
  };
}

const leaveInput = z.strictObject({
  sessionId: z.uuid(),
  substituteId: z.uuid().nullable(),
  reason: changeReasonSchema,
});

/** Catat cuti pada sesi praktik, opsional dokter pengganti dari poli yang sama. */
export async function recordLeaveApiAction(input: unknown): Promise<JadwalApiResult> {
  const denied = await authorize('write');
  if (denied) return denied;
  const p = leaveInput.safeParse(input);
  if (!p.success) {
    return { ok: false, message: p.error.issues[0]?.message ?? 'Isian cuti tidak dikenali.' };
  }
  try {
    const r = await api(`/api/v1/scheduling/sessions/${p.data.sessionId}/leave`, {
      method: 'POST',
      body: { reason: p.data.reason, substitutePractitionerId: p.data.substituteId },
      schema: leaveResultSchema,
    });
    revalidatePath(PATH);
    return {
      ok: true,
      message: `Cuti tercatat · ${at()}; ${r.affectedBookings} pasien booking perlu dialihkan. Catat juga cuti ini di aplikasi HFIS.`,
    };
  } catch (err) {
    return failure(err);
  }
}

/** Alihkan pasien sesi cuti ke dokter pengganti + kirim WhatsApp (lewat outbox). */
export async function transferToSubstituteAction(sessionId: unknown): Promise<JadwalApiResult> {
  const denied = await authorize('write');
  if (denied) return denied;
  const id = z.uuid().safeParse(sessionId);
  if (!id.success) return { ok: false, message: 'Sesi cuti tidak dikenali.' };
  try {
    const r = await api(`/api/v1/scheduling/sessions/${id.data}/transfer`, {
      method: 'POST',
      body: { target: { kind: 'substitute' }, notifyPatients: true },
      schema: transferResultSchema,
    });
    revalidatePath(PATH);
    return {
      ok: true,
      message: `${r.moved} pasien dialihkan ke dokter pengganti; ${r.notified} notifikasi WhatsApp diantrekan · ${at()}`,
    };
  } catch (err) {
    return failure(err);
  }
}

/** Kirim templat jadwal semua dokter ke HFIS (202: dikirim worker lewat outbox). */
export async function pushHfisAction(): Promise<JadwalApiResult> {
  const denied = await authorize('sync');
  if (denied) return denied;
  try {
    const r = await api('/api/v1/scheduling/hfis/push', {
      method: 'POST',
      body: {},
      schema: hfisPushResultSchema,
    });
    revalidatePath(PATH);
    return {
      ok: true,
      message: `${r.queued} jadwal dokter diantrekan ke HFIS · ${at()}. Tarik ulang dari HFIS setelah terkirim untuk memeriksa perbedaan.`,
    };
  } catch (err) {
    return failure(err);
  }
}

/** Tarik jadwal HFIS 14 hari ke depan (202: dikirim worker lewat outbox). */
export async function pullHfisAction(): Promise<JadwalApiResult> {
  const denied = await authorize('sync');
  if (denied) return denied;
  try {
    const r = await api('/api/v1/scheduling/hfis/pull', {
      method: 'POST',
      body: {},
      schema: hfisPushResultSchema,
    });
    revalidatePath(PATH);
    return {
      ok: true,
      message: `${r.queued} permintaan jadwal HFIS diantrekan · ${at()}. Muat ulang sebentar lagi untuk melihat hasilnya.`,
    };
  } catch (err) {
    return failure(err);
  }
}
