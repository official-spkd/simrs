import { formatTanggalWaktu } from '@simrs/shared';
import { Button, cx } from '@simrs/ui';
import type { Metadata } from 'next';
import { api } from '@/lib/server/api';
import { notificationListSchema } from '@/lib/server/notifications';
import { requireSession } from '@/lib/server/session';
import { openNotificationAction, readAllAction } from './actions';

export const metadata: Metadata = { title: 'Notifikasi' };

/**
 * P09 · Notifikasi milik pengguna. Isinya tanpa data pasien; detail dibuka lewat tautan ke layar yang berizin.
 * Salinan notifikasi mendesak juga dikirim ke email/WhatsApp yang terdaftar di akun.
 */
export default async function NotifikasiPage() {
  await requireSession();
  const data = await api('/api/v1/notifications?limit=50', { schema: notificationListSchema });

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h1 className="m-0 text-h1 font-bold tracking-[-0.02em]">Notifikasi</h1>
          <span className="text-small text-ink-700">
            {data.unread > 0 ? `${data.unread} belum dibaca` : 'Semua sudah dibaca'}
          </span>
        </div>
        {data.unread > 0 && (
          <form action={readAllAction}>
            <Button type="submit" size="sm">
              Tandai semua dibaca
            </Button>
          </form>
        )}
      </header>

      {data.items.length === 0 ? (
        <p className="m-0 rounded-card border border-white/95 bg-white/90 shadow-card px-4 py-6 text-small text-ink-500">
          Belum ada notifikasi.
        </p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {data.items.map((n) => {
            const unread = n.readAt === null;
            return (
              <li key={n.id}>
                <form action={openNotificationAction}>
                  <input type="hidden" name="id" value={n.id} />
                  <button
                    type="submit"
                    className={cx(
                      'flex w-full cursor-pointer flex-col gap-1 rounded-card border px-4 py-3 text-left font-[inherit] text-ink-900',
                      unread
                        ? 'border-brand-200 bg-[linear-gradient(120deg,var(--color-brand-50),#FFFFFF_70%)] shadow-card'
                        : 'border-white/95 bg-white/90 shadow-card',
                    )}
                  >
                    <span className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className={cx(unread ? 'font-bold' : 'font-semibold')}>
                        {unread && <span className="sr-only">Belum dibaca: </span>}
                        {n.title}
                      </span>
                      <span className="text-caption text-ink-500">{formatTanggalWaktu(n.createdAt)}</span>
                    </span>
                    <span className="text-small text-ink-700">{n.body}</span>
                    {n.link && <span className="text-caption font-semibold text-brand-700">Buka →</span>}
                  </button>
                </form>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
