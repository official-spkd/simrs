import type { ReactNode } from 'react';
import Link from 'next/link';
import { DemoSync } from '@/components/demo-sync';
import { DowntimeBanner } from '@/components/operasional/downtime-banner';
import { requireSession } from '@/lib/server/session';
import { webEnv } from '@/lib/server/web-env';

/**
 * Layar perangkat layar penuh (anjungan, TV antrean, tablet persetujuan, pratinjau aplikasi): tanpa sidebar staf.
 * Mode presentasi: di balik login staf (setiap halaman juga memanggil `requireScreen`/`requireDemoScreen`). Tombol "Kembali" hanya untuk presenter di mode presentasi, di baris
 * sendiri di atas kanvas: kanvas (`ScaleToFit`) mengisi sisa tinggi sehingga judulnya tidak tertutup di tablet.
 */
export default async function PerangkatLayout({ children }: { children: ReactNode }) {
  const demo = webEnv().dataSource === 'demo';
  // Mode api: tanpa sesi staf di layout. Anjungan dan TV dibuka perangkat terdaftar (ADR-0027, `requireDevice` di
  // halamannya); tablet persetujuan memakai sesi staf (`requireScreen`, keputusan fase 3 #20); layar perangkat lain
  // hanya ada di mode presentasi (404 di mode api).
  if (demo) await requireSession();
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-line text-ink-900">
      {demo && (
        <nav aria-label="Presenter" className="flex shrink-0 items-center px-3 pt-2">
          <Link
            href="/simulasi"
            className="inline-flex min-h-11 items-center rounded-full border border-line-strong bg-white/90 px-4 text-caption font-semibold text-ink-700 no-underline shadow-sm"
          >
            ← Kembali ke SIM RS
          </Link>
        </nav>
      )}
      {demo && (
        <div className="shrink-0 px-3 pt-2">
          <DowntimeBanner />
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col overflow-auto">{children}</div>
      {demo && <DemoSync />}
    </div>
  );
}
