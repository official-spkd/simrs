import type { ReactNode } from 'react';
import { ScaleToFit } from '@/components/scale-to-fit';

/** Latar kanvas tablet persetujuan (sama dengan mode presentasi, mockup Consent). */
export const TABLET_BG =
  'bg-canvas bg-[radial-gradient(600px_400px_at_0%_0%,var(--color-samudra-100)_0%,transparent_60%),radial-gradient(600px_400px_at_100%_100%,var(--color-samudra-50)_0%,transparent_60%)]';

/** Kartu Pelangi Klinis di tablet. */
export const TABLET_CARD = 'rounded-card border border-white/95 bg-white/90 shadow-card';

/**
 * Kanvas tablet persetujuan mode api (834×1194, mockup Consent): kepala kaca (konteks + judul), isi yang bisa digulir,
 * dan kaki opsional untuk tombol langkah.
 */
export function TabletShell({
  context,
  title,
  badge,
  aside,
  footer,
  children,
}: {
  context: string;
  title: string;
  badge?: ReactNode;
  aside?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <ScaleToFit
      width={834}
      height={1194}
      label="Tablet persetujuan tindakan"
      className="overflow-hidden rounded-[24px] shadow-[0_12px_40px_rgba(23,32,46,0.18)]"
    >
      <div className={`flex h-full flex-col text-ink-900 ${TABLET_BG}`}>
        <header className="glass flex items-center justify-between gap-3 border-b border-white/70 px-7 py-[18px]">
          <div className="flex min-w-0 flex-col">
            <span className="text-[13px] text-ink-500">{context}</span>
            <h1 className="m-0 text-[24px] font-bold tracking-[-0.02em]">{title}</h1>
            {badge}
          </div>
          {aside}
        </header>
        <main className="flex flex-1 flex-col gap-4 overflow-y-auto px-7 py-5 text-[16px]">{children}</main>
        {footer && (
          <footer className="glass flex items-center gap-3 border-t border-white/70 px-7 py-4">
            {footer}
          </footer>
        )}
      </div>
    </ScaleToFit>
  );
}
