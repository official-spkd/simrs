'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { api } from '@/lib/server/api';
import { ApiError } from '@/lib/server/api-core';
import { okSchema } from '@/lib/server/schemas';
import { getSession } from '@/lib/server/session';
import { nextLoginStep } from '@/lib/session-view';

export interface PositionState {
  error?: string;
}

/**
 * Ganti posisi (penugasan) sesi ini. API memastikan penugasan milik pengguna dan masih berlaku, lalu mencatatnya
 * di jejak audit; menu dan izin mengikuti posisi baru mulai halaman berikutnya.
 */
export async function switchPositionAction(_prev: PositionState, formData: FormData): Promise<PositionState> {
  const s = await getSession();
  if (!s || nextLoginStep(s, false) !== 'selesai') redirect('/masuk');
  const id = z.uuid().safeParse(formData.get('assignmentId'));
  if (!id.success) return { error: 'Pilih salah satu posisi.' };
  try {
    await api('/api/v1/auth/assignment', {
      method: 'POST',
      body: { assignmentId: id.data },
      schema: okSchema,
    });
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect('/masuk');
    return { error: err instanceof ApiError ? err.message : 'Terjadi kesalahan. Coba lagi.' };
  }
  revalidatePath('/', 'layout');
  redirect('/');
}
