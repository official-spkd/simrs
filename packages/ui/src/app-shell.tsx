import type { CSSProperties, ReactNode } from 'react';
import { cx } from './cx';
import { Icon } from './icons';

/** Tinggi header lengket (`stickyHeader`); elemen `sticky` di halaman memakai `var(--app-sticky-top)`. */
const STICKY_HEADER_HEIGHT = '4rem';

/**
 * Kerangka halaman staf: sidebar 240 px + header + konten.
 * Di bawah 768 px sidebar runtuh menjadi menu atas yang bisa dibuka (details/summary, tanpa JS).
 * `stickyHeader`: mulai 768 px header tetap di atas saat halaman digulir (kontrol di header, mis. panduan presentasi,
 * selalu terjangkau tanpa melayang di atas isi); `--app-sticky-top` = tingginya, 0 bila tidak lengket. Di layar
 * ponsel header boleh membungkus dua baris, jadi ikut tergulir agar tidak memakan layar.
 */
export function AppShell({
  sidebar,
  header,
  children,
  tenantName,
  stickyHeader = false,
}: {
  sidebar: ReactNode;
  header?: ReactNode;
  children: ReactNode;
  tenantName: string;
  stickyHeader?: boolean;
}) {
  const sticky = stickyHeader && Boolean(header);
  return (
    <div
      className="min-h-screen md:flex"
      data-sticky-header={sticky ? '' : undefined}
      style={{ '--app-sticky-top': sticky ? STICKY_HEADER_HEIGHT : '0px' } as CSSProperties}
    >
      <aside className="sticky top-0 hidden h-screen shrink-0 overflow-y-auto md:block">{sidebar}</aside>

      <details className="group border-b border-line bg-white md:hidden">
        <summary className="flex h-14 cursor-pointer list-none items-center gap-2 px-4 font-semibold">
          <Icon name="menu" size={20} />
          {tenantName}
          <span className="ml-auto text-caption font-normal text-ink-500 group-open:hidden">Buka menu</span>
          <span className="ml-auto hidden text-caption font-normal text-ink-500 group-open:inline">
            Tutup menu
          </span>
        </summary>
        <div className="max-h-[70vh] overflow-y-auto">{sidebar}</div>
      </details>

      <div className="flex min-w-0 flex-1 flex-col">
        {header && (
          <header
            className={cx(
              'flex min-h-16 flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-6 py-2 backdrop-blur',
              sticky ? 'bg-white/95 md:sticky md:top-0 md:z-30' : 'bg-white/80',
            )}
          >
            {header}
          </header>
        )}
        <main className="flex-1 px-4 py-6 md:px-8">{children}</main>
      </div>
    </div>
  );
}
