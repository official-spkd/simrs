'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { safeNextPath } from '@/lib/safe-path';
import { api } from '@/lib/server/api';
import { ApiError } from '@/lib/server/api-core';
import { notificationSchema } from '@/lib/server/notifications';
import { getSession } from '@/lib/server/session';
import { nextLoginStep } from '@/lib/session-view';

/** Notifikasi milik pengguna yang login (P09). API menegakkan kepemilikan; tautan hanya path internal. */

async function requireLogin(): Promise<void> {
  const s = await getSession();
  if (!s || nextLoginStep(s, false) !== 'selesai') redirect('/masuk');
}

/** Tandai dibaca lalu buka tautannya (atau kembali ke daftar bila tidak ada tautan). */
export async function openNotificationAction(formData: FormData): Promise<void> {
  await requireLogin();
  const id = z.uuid().safeParse(formData.get('id'));
  if (!id.success) redirect('/notifikasi');
  let link: string | null = null;
  try {
    await api(`/api/v1/notifications/${id.data}/read`, {
      method: 'POST',
      schema: z.object({ id: z.uuid(), readAt: z.string() }),
    });
    const list = await api('/api/v1/notifications?limit=100', {
      schema: z.object({ items: z.array(notificationSchema) }),
    });
    link = list.items.find((n) => n.id === id.data)?.link ?? null;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect('/masuk');
  }
  revalidatePath('/', 'layout');
  redirect(link ? safeNextPath(link, '/notifikasi') : '/notifikasi');
}

export async function readAllAction(): Promise<void> {
  await requireLogin();
  try {
    await api('/api/v1/notifications/read-all', {
      method: 'POST',
      schema: z.object({ updated: z.number() }),
    });
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect('/masuk');
  }
  revalidatePath('/', 'layout');
}
