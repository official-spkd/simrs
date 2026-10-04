import 'server-only';
import { z } from 'zod';
import { api } from './api';

/** Bentuk respons API notifikasi (P09) yang diterima web. */

export const notificationSchema = z.object({
  id: z.uuid(),
  kind: z.string(),
  title: z.string(),
  body: z.string(),
  link: z.string().nullable(),
  createdAt: z.string(),
  readAt: z.string().nullable(),
});
export type NotificationItem = z.infer<typeof notificationSchema>;

export const notificationListSchema = z.object({
  unread: z.number().int(),
  items: z.array(notificationSchema),
});

/** Jumlah belum dibaca untuk lonceng di header; gangguan API tidak boleh merusak kerangka halaman. */
export async function unreadNotifications(): Promise<number> {
  try {
    const r = await api('/api/v1/notifications/unread-count', {
      schema: z.object({ unread: z.number().int() }),
    });
    return r.unread;
  } catch {
    return 0;
  }
}
