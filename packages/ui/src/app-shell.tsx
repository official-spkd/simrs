import type { ReactNode } from 'react';
import { Icon } from './icons';

/**
 * Kerangka halaman staf: sidebar 240 px + header + konten.
 * Di bawah 768 px sidebar runtuh menjadi menu atas yang bisa dibuka (details/summary, tanpa JS).
 */
export function AppShell({
  sidebar,
  header,
  children,
  tenantName,
}: {
  sidebar: ReactNode;
  header?: ReactNode;
  children: ReactNode;
  tenantName: string;
}) {
  return (
    <div className="min-h-screen md:flex">
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
          <header className="flex min-h-16 items-center gap-4 border-b border-line bg-white/80 px-6 backdrop-blur">
            {header}
          </header>
        )}
        <main className="flex-1 px-4 py-6 md:px-8">{children}</main>
      </div>
    </div>
  );
}
