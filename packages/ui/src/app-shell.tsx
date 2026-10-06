import type { CSSProperties, ReactNode } from 'react';
import { cx } from './cx';
import { Icon } from './icons';
import type { DomainKey } from './tokens';

/** Tinggi header lengket (`stickyHeader`); elemen `sticky` di halaman memakai `var(--app-sticky-top)`. */
const STICKY_HEADER_HEIGHT = '4rem';

/**
 * Kerangka halaman staf Pelangi Klinis (ADR-0086): jendela kaca berisi sidebar 236 px + header + konten. Mulai
 * 1024 px jendela melayang di atas latar (radius 20, bayangan); di bawahnya memenuhi layar.
 * `domain` memasang `data-domain` sehingga aksen `brand-*` seluruh layar mengikuti rona domain menu aktif; garis 3 px
 * di tepi atas jendela bergradien rona itu, dan `domainLabel` tampil sebagai label di awal header.
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
  domain,
  domainLabel,
}: {
  sidebar: ReactNode;
  header?: ReactNode;
  children: ReactNode;
  tenantName: string;
  stickyHeader?: boolean;
  domain?: DomainKey;
  domainLabel?: string;
}) {
  const sticky = stickyHeader && Boolean(header);
  return (
    <div
      className="min-h-screen lg:p-4"
      data-domain={domain}
      data-sticky-header={sticky ? '' : undefined}
      style={{ '--app-sticky-top': sticky ? STICKY_HEADER_HEIGHT : '0px' } as CSSProperties}
    >
      <div className="glass relative min-h-screen md:flex lg:min-h-[calc(100vh-2rem)] lg:animate-win-in lg:overflow-clip lg:rounded-window lg:border lg:border-white/85 lg:shadow-window">
        <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 z-40 h-[3px] bg-domain-bar" />
        <aside className="sticky top-0 hidden h-screen shrink-0 overflow-y-auto md:block lg:top-4 lg:h-[calc(100vh-2rem)]">
          {sidebar}
        </aside>

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

        <div className="flex min-w-0 flex-1 flex-col">
          {header && (
            <header
              className={cx(
                'flex min-h-16 flex-wrap items-center gap-x-3 gap-y-2 border-b border-white/70 px-6 py-2 backdrop-blur-xl',
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
          <main className="stagger-rise flex-1 px-4 py-6 md:px-8">{children}</main>
        </div>
      </div>
    </div>
  );
}
