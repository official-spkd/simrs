'use server';

import { MERGE_ATTRIBUTES } from '@simrs/shared';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { api } from '@/lib/server/api';
import { ApiError } from '@/lib/server/api-core';
import { mergeResultSchema, undoResultSchema } from '@/lib/server/mpi';
import { okSchema } from '@/lib/server/schemas';
import { getSession } from '@/lib/server/session';
import { can, nextLoginStep } from '@/lib/session-view';

/**
 * Keputusan petugas rekam medis di layar MPI. Sesi dan izin diperiksa di sini (pesan jelas) dan ditegakkan API
 * (izin `patient.merge`, kunci baris, batas 30 hari). Setiap keputusan tercatat di jejak audit kedua pasien.
 */

const PATH = '/rekam-medis/mpi';

export interface DecisionResult {
  error?: string;
  message?: string;
}

const REASON = z
  .string()
  .trim()
  .min(10, 'Alasan minimal 10 karakter: sebutkan dasar verifikasi (mis. KTP, wawancara).')
  .max(500, 'Alasan maksimal 500 karakter.');

async function authorize(): Promise<string | null> {
  const s = await getSession();
  if (!s || nextLoginStep(s, false) !== 'selesai') redirect('/masuk');
  return can(s, 'patient', 'merge') ? null : 'Peran Anda tidak berizin meninjau rekam medis ganda.';
}

function failure(err: unknown): DecisionResult {
  if (err instanceof ApiError) {
    if (err.status === 401) redirect('/masuk');
    return { error: err.message };
  }
  return { error: 'Terjadi kesalahan. Coba lagi.' };
}

function readInput(formData: FormData) {
  const id = z.uuid().safeParse(formData.get('id'));
  const reason = REASON.safeParse(formData.get('reason'));
  if (!id.success) return { error: 'Pasangan tidak valid.' } as const;
  if (!reason.success) return { error: reason.error.issues[0]?.message ?? 'Alasan tidak valid.' } as const;
  return { id: id.data, reason: reason.data } as const;
}

export async function mergeAction(_prev: DecisionResult, formData: FormData): Promise<DecisionResult> {
  const denied = await authorize();
  if (denied) return { error: denied };
  const input = readInput(formData);
  if ('error' in input) return { error: input.error };
  const taken = z.array(z.enum(MERGE_ATTRIBUTES)).safeParse(formData.getAll('takeFromB'));
  if (!taken.success) return { error: 'Pilihan atribut tidak valid.' };
  try {
    await api(`/api/v1/mpi/candidates/${input.id}/merge`, {
      method: 'POST',
      body: { reason: input.reason, takeFromB: taken.data },
      schema: mergeResultSchema,
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath(PATH);
  return {};
}

export async function distinctAction(_prev: DecisionResult, formData: FormData): Promise<DecisionResult> {
  const denied = await authorize();
  if (denied) return { error: denied };
  const input = readInput(formData);
  if ('error' in input) return { error: input.error };
  try {
    await api(`/api/v1/mpi/candidates/${input.id}/distinct`, {
      method: 'POST',
      body: { reason: input.reason },
      schema: okSchema,
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath(PATH);
  return {};
}

/** Batalkan keputusan: penggabungan (`id` = jejak) atau "bukan orang yang sama" (`id` = pasangan). */
export async function undoAction(_prev: DecisionResult, formData: FormData): Promise<DecisionResult> {
  const denied = await authorize();
  if (denied) return { error: denied };
  const input = readInput(formData);
  if ('error' in input) return { error: input.error };
  const kind = formData.get('kind');
  try {
    if (kind === 'merge') {
      const res = await api(`/api/v1/mpi/links/${input.id}/undo`, {
        method: 'POST',
        body: { reason: input.reason },
        schema: undoResultSchema,
      });
      revalidatePath(PATH);
      return res.kept.length
        ? {
            message: 'Penggabungan dibatalkan. Sebagian data A sudah diubah sesudahnya dan tidak dipulihkan.',
          }
        : { message: 'Penggabungan dibatalkan.' };
    }
    await api(`/api/v1/mpi/candidates/${input.id}/reopen`, {
      method: 'POST',
      body: { reason: input.reason },
      schema: okSchema,
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath(PATH);
  return { message: 'Keputusan dibatalkan; pasangan kembali ke antrean.' };
}
