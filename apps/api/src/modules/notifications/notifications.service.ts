import { Injectable } from '@nestjs/common';
import { notifyStaff } from '@simrs/db';
import { AppError, type NotificationChannel } from '@simrs/shared';
import { TenantDb } from '../../infra/tenant-db';

export interface NotifyInput {
  kind: string;
  /** Tanpa PHI: identitas pasien dan alasan klinis hanya di layar berizin yang dituju `link`. */
  title: string;
  body: string;
  /** Path internal web, mis. `/sistem/audit?tinjau=…`. */
  link?: string;
}

const READ_SELECT = {
  id: true,
  kind: true,
  title: true,
  body: true,
  link: true,
  createdAt: true,
  readAt: true,
} as const;

/**
 * P09 · Notifikasi staf. `notify` menulis notifikasi in-app di transaksi pemanggil dan mengantrekan salinan
 * email/WhatsApp lewat outbox (inti di `@simrs/db` `notifyStaff`, dipakai juga job worker). Endpoint baca hanya untuk
 * notifikasi milik pengguna yang login.
 */
@Injectable()
export class NotificationsService {
  constructor(private readonly db: TenantDb) {}

  async notify(
    recipientUserIds: string[],
    input: NotifyInput,
    channels: NotificationChannel[] = ['in_app', 'email'],
  ): Promise<number> {
    const sent = await notifyStaff(this.db.tx(), this.db.tenantId(), recipientUserIds, input, channels);
    return sent.length;
  }

  private me(): string {
    const id = this.db.actorUserId();
    if (!id) throw new AppError('UNAUTHENTICATED', 'Belum login', 401);
    return id;
  }

  async list(q: { unreadOnly: boolean; limit: number }) {
    const rows = await this.db.tx().notification.findMany({
      where: { recipientUserId: this.me(), ...(q.unreadOnly ? { readAt: null } : {}) },
      orderBy: { createdAt: 'desc' },
      take: q.limit,
      select: READ_SELECT,
    });
    const unread = await this.unreadCount();
    return {
      unread,
      items: rows.map((r) => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
        readAt: r.readAt?.toISOString() ?? null,
      })),
    };
  }

  unreadCount(): Promise<number> {
    return this.db.tx().notification.count({ where: { recipientUserId: this.me(), readAt: null } });
  }

  async markRead(id: string): Promise<{ id: string; readAt: string }> {
    const res = await this.db.tx().notification.updateManyAndReturn({
      where: { id, recipientUserId: this.me() },
      data: { readAt: new Date() },
      select: { id: true, readAt: true },
    });
    const row = res[0];
    if (!row) throw new AppError('NOT_FOUND', 'Notifikasi tidak ditemukan', 404);
    return { id: row.id, readAt: (row.readAt as Date).toISOString() };
  }

  async markAllRead(): Promise<{ updated: number }> {
    const res = await this.db.tx().notification.updateMany({
      where: { recipientUserId: this.me(), readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: res.count };
  }
}
