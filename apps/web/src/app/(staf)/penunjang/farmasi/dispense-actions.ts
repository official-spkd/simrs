'use server';

import {
  dispenseHandoverInputSchema,
  dispensePrepareInputSchema,
  dispenseReturnInputSchema,
  type DispenseView,
  dispenseViewSchema,
} from '@simrs/shared';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { api } from '@/lib/server/api';
import { ApiError } from '@/lib/server/api-core';
import { getSession } from '@/lib/server/session';
import { can, nextLoginStep } from '@/lib/session-view';

/**
 * S05 · Server Action dispensing layar Farmasi mode api (potongan 4.6b): BFF tipis ke `/api/v1/dispensing/*`. API
 * menegakkan ulang izin, lingkup depo, FEFO/kedaluwarsa, saldo, cek ganda apoteker lain, dan jumlah retur. Penyiapan
 * dan retur membawa Idempotency-Key per submit dari klien.
 */

type Fail = { ok: false; message: string };
type Done = { ok: true; dispense: DispenseView } | Fail;
type Action = 'prepare' | 'double_check' | 'handover' | 'return';

const DENIED: Record<Action, string> = {
  prepare: 'Peran Anda tidak berizin menyiapkan obat.',
  double_check: 'Peran Anda tidak berizin melakukan cek ganda.',
  handover: 'Peran Anda tidak berizin menyerahkan obat.',
  return: 'Peran Anda tidak berizin mencatat retur obat.',
};

async function authorize(action: Action): Promise<Fail | null> {
  const s = await getSession();
  if (!s || nextLoginStep(s, false) !== 'selesai') redirect('/masuk');
  return can(s, 'pharmacy.dispense', action) ? null : { ok: false, message: DENIED[action] };
}

async function post(url: string, body: unknown, idempotencyKey?: string): Promise<Done> {
  try {
    const dispense = await api(url, {
      method: 'POST',
      body,
      schema: dispenseViewSchema,
      ...(idempotencyKey ? { idempotencyKey } : {}),
    });
    revalidatePath('/penunjang/farmasi');
    return { ok: true, dispense };
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.status === 401) redirect('/masuk');
      return { ok: false, message: err.message };
    }
    return { ok: false, message: 'Terjadi kesalahan. Coba lagi.' };
  }
}

const id = z.uuid();
const BAD_KEY: Fail = { ok: false, message: 'Muat ulang halaman lalu ulangi.' };

/** Siapkan obat resep yang lolos telaah: FEFO otomatis, atau batch pilihan beralasan. */
export async function prepareDispenseAction(
  prescriptionId: unknown,
  input: unknown,
  idempotencyKey: unknown,
): Promise<Done> {
  const denied = await authorize('prepare');
  if (denied) return denied;
  const rx = id.safeParse(prescriptionId);
  const p = dispensePrepareInputSchema.safeParse(input);
  if (!rx.success || !p.success) {
    return {
      ok: false,
      message: p.success
        ? 'Resep tidak dikenali.'
        : (p.error.issues[0]?.message ?? 'Lengkapi jumlah setiap obat.'),
    };
  }
  const key = id.safeParse(idempotencyKey);
  if (!key.success) return BAD_KEY;
  return post(`/api/v1/dispensing/prescriptions/${rx.data}/prepare`, p.data, key.data);
}

/** Cek ganda apoteker kedua (bukan penyiap). */
export async function doubleCheckAction(dispenseId: unknown): Promise<Done> {
  const denied = await authorize('double_check');
  if (denied) return denied;
  const d = id.safeParse(dispenseId);
  if (!d.success) return { ok: false, message: 'Penyiapan tidak dikenali.' };
  return post(`/api/v1/dispensing/dispenses/${d.data}/double-check`, {});
}

/** Serah terima: penerima, nama, PIO. */
export async function handoverAction(dispenseId: unknown, input: unknown): Promise<Done> {
  const denied = await authorize('handover');
  if (denied) return denied;
  const d = id.safeParse(dispenseId);
  const p = dispenseHandoverInputSchema.safeParse(input);
  if (!d.success || !p.success) {
    return { ok: false, message: 'Pilih penerima, tulis namanya, dan centang PIO sudah diberikan.' };
  }
  return post(`/api/v1/dispensing/dispenses/${d.data}/handover`, p.data);
}

/** Retur obat yang sudah diserahkan (layak kembali ke stok; tidak layak dicatat). */
export async function returnDispenseAction(
  dispenseId: unknown,
  input: unknown,
  idempotencyKey: unknown,
): Promise<Done> {
  const denied = await authorize('return');
  if (denied) return denied;
  const d = id.safeParse(dispenseId);
  const p = dispenseReturnInputSchema.safeParse(input);
  if (!d.success || !p.success) {
    return { ok: false, message: 'Isi jumlah retur dan alasan minimal 10 karakter.' };
  }
  const key = id.safeParse(idempotencyKey);
  if (!key.success) return BAD_KEY;
  return post(`/api/v1/dispensing/dispenses/${d.data}/returns`, p.data, key.data);
}
