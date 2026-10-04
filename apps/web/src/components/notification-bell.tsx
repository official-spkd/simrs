import { Icon } from '@simrs/ui';
import Link from 'next/link';

/** Lonceng notifikasi di header (design/mockups/Main.dc.html): jumlah baru dibacakan, titik merah bila ada. */
export function NotificationBell({ unread }: { unread: number }) {
  const label = unread > 0 ? `Notifikasi, ${unread} baru` : 'Notifikasi, tidak ada yang baru';
  return (
    <Link
      href="/notifikasi"
      aria-label={label}
      title={label}
      className="relative ml-auto flex size-11 items-center justify-center rounded-control border border-line bg-white text-ink-700"
    >
      <Icon name="bell" size={18} />
      {unread > 0 && (
        <span
          aria-hidden="true"
          className="absolute top-1 right-1 flex min-w-[18px] items-center justify-center rounded-full border-2 border-white bg-danger px-1 text-[11px] leading-[14px] font-bold text-white"
        >
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </Link>
  );
}
