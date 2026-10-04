import type { ReactNode } from 'react';
import Link from 'next/link';
import { DemoSync } from '@/components/demo-sync';
import { requireSession } from '@/lib/server/session';
import { webEnv } from '@/lib/server/web-env';

/**
 * Layar perangkat layar penuh (anjungan, TV antrean, tablet persetujuan, pratinjau aplikasi): tanpa sidebar staf.
 * Saat mode presentasi tetap di balik login staf (setiap halaman juga memanggil `requireDemoScreen`); token
 * perangkat sungguhan menyusul bersama backend. Tombol "Kembali" hanya untuk presenter di mode presentasi.
 */
export default async function PerangkatLayout({ children }: { children: ReactNode }) {
  await requireSession();
  const demo = webEnv().dataSource === 'demo';
  return (
    <div className="relative min-h-screen bg-[#E9EEF2] text-ink-900">
      {children}
      {demo && (
        <>
          <Link
            href="/simulasi"
            className="fixed top-3 left-3 z-50 rounded-full border border-line-strong bg-white/90 px-3 py-1.5 text-caption font-semibold text-ink-700 no-underline shadow-sm"
          >
            ← Kembali ke SIM RS
          </Link>
          <DemoSync />
        </>
      )}
    </div>
  );
}
