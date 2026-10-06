import type { CSSProperties, ReactNode } from 'react';
import { cx } from './cx';
import { Icon } from './icons';
import type { DomainKey } from './tokens';

/** Tinggi header lengket (`stickyHeader`); elemen `sticky` di halaman memakai `var(--app-sticky-top)`. */
const STICKY_HEADER_HEIGHT = '4rem';

export type NavLayout = 'sidebar' | 'dock';

/**
 * Kerangka halaman staf Pelangi Klinis (ADR-0091, ADR-0092): kaca selebar layar (tanpa margin) berisi navigasi +
 * header + konten, sehingga isi layar memakai seluruh ruang.
 * - `layout="sidebar"`: sidebar 236 px; di bawah 768 px runtuh menjadi menu atas (details/summary, tanpa JS).
 * - `layout="dock"`: tanpa sidebar; `dock` (komponen `Dock`) melayang di bawah layar di semua lebar, konten diberi
 *   ruang bawah agar tidak tertutup dock.
 * `domain` memasang `data-domain` sehingga aksen `brand-*` seluruh layar mengikuti rona domain menu aktif; garis 3 px
 * di tepi atas bergradien rona itu, dan `domainLabel` tampil sebagai label di awal header.
 * `stickyHeader`: mulai 768 px header tetap di atas saat halaman digulir; `--app-sticky-top` = tingginya, 0 bila
 * tidak lengket. Di layar ponsel header boleh membungkus dua baris, jadi ikut tergulir agar tidak memakan layar.
 */
export function AppShell({
  sidebar,
  dock,
  layout = 'sidebar',
  header,
  children,
  tenantName,
  stickyHeader = false,
  domain,
  domainLabel,
}: {
  sidebar: ReactNode;
  dock?: ReactNode;
  layout?: NavLayout;
  header?: ReactNode;
  children: ReactNode;
  tenantName: string;
  stickyHeader?: boolean;
  domain?: DomainKey;
  domainLabel?: string;
}) {
  const sticky = stickyHeader && Boolean(header);
  const docked = layout === 'dock' && Boolean(dock);
  return (
    <div
      className="min-h-screen"
      data-domain={domain}
      data-nav-layout={docked ? 'dock' : 'sidebar'}
      data-sticky-header={sticky ? '' : undefined}
      style={{ '--app-sticky-top': sticky ? STICKY_HEADER_HEIGHT : '0px' } as CSSProperties}
    >
      <div className="glass relative min-h-screen animate-win-in overflow-x-clip md:flex">
        <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 z-40 h-[3px] bg-domain-bar" />
        {!docked && (
          <>
            <aside className="sticky top-0 hidden h-screen shrink-0 overflow-y-auto md:block">{sidebar}</aside>
            <details className="group border-b border-white/70 bg-white/80 md:hidden">
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
          </>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          {header && (
            <header
              className={cx(
                'flex min-h-16 flex-wrap items-center gap-x-3 gap-y-2 border-b border-white/70 px-4 py-2 backdrop-blur-xl md:px-6',
                sticky ? 'bg-white/85 md:sticky md:top-0 md:z-30' : 'bg-white/40',
              )}
            >
              {domainLabel && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-100 px-2.5 py-0.5 text-[10.5px] font-bold tracking-[0.07em] text-brand-800 uppercase">
                  <span aria-hidden="true" className="size-1.5 rounded-full bg-brand-600" />
                  {domainLabel}
                </span>
              )}
              {header}
            </header>
          )}
          <main className={cx('stagger-rise flex-1 px-4 py-6 md:px-8', docked && 'pb-28 md:pb-32')}>{children}</main>
        </div>
      </div>
      {/* Di luar kaca: backdrop-filter menjadi containing block bagi `fixed`, dock harus mengacu ke layar. */}
      {docked && dock}
    </div>
  );
}
