import {
  newId,
  type NotificationChannel,
  NOTIFY_EMAIL_OPERATION,
  NOTIFY_WHATSAPP_OPERATION,
  notificationLinkSchema,
} from '@simrs/shared';
import type { TenantTx } from './client';
import { enqueueOutbox } from './outbox';

export interface StaffNotificationInput {
  kind: string;
  /** Tanpa PHI: identitas pasien dan alasan klinis hanya di layar berizin yang dituju `link`. */
  title: string;
  body: string;
  /** Path internal web, mis. `/sistem/audit?tinjau=…`. */
  link?: string;
}

/**
 * P09 · Tulis notifikasi in-app untuk staf aktif di transaksi pemanggil dan antrekan salinan email/WhatsApp lewat
 * outbox (payload hanya ID; alamat dibaca/didekripsi worker saat mengirim). Dipakai API (`NotificationsService`) dan
 * job worker (eskalasi nilai kritis, peringatan stok). Mengembalikan id notifikasi per penerima yang aktif.
 */
export async function notifyStaff(
  tx: TenantTx,
  tenantId: string,
  recipientUserIds: readonly string[],
  input: StaffNotificationInput,
  channels: readonly NotificationChannel[] = ['in_app', 'email'],
): Promise<Array<{ userId: string; notificationId: string }>> {
  if (input.link !== undefined) notificationLinkSchema.parse(input.link);
  const ids = [...new Set(recipientUserIds)];
  if (ids.length === 0) return [];
  const users = await tx.user.findMany({
    where: { id: { in: ids }, status: 'active' },
    select: { id: true, email: true, phoneEnc: true },
    orderBy: { id: 'asc' },
  });
  const out: Array<{ userId: string; notificationId: string }> = [];
  for (const u of users) {
    const id = newId();
    await tx.notification.create({
      data: {
        id,
        tenantId,
        recipientUserId: u.id,
        kind: input.kind,
        title: input.title,
        body: input.body,
        link: input.link ?? null,
      },
    });
    if (channels.includes('email') && u.email) {
      await enqueueOutbox(tx, tenantId, {
        target: 'email',
        operation: NOTIFY_EMAIL_OPERATION,
        idempotencyKey: `notify-email:${id}`,
        payload: { notificationId: id },
      });
    }
    if (channels.includes('whatsapp') && u.phoneEnc) {
      await enqueueOutbox(tx, tenantId, {
        target: 'whatsapp',
        operation: NOTIFY_WHATSAPP_OPERATION,
        idempotencyKey: `notify-wa:${id}`,
        payload: { notificationId: id },
      });
    }
    out.push({ userId: u.id, notificationId: id });
  }
  return out;
}
