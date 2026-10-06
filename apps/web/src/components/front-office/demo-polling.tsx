'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/**
 * Mode presentasi (ADR-0085): muat ulang data server secara berkala tanpa memuat ulang halaman, untuk layar yang
 * dipasang di perangkat lain (papan TV, layar loket) agar aksi dari perangkat lain tampil sendiri. Hanya saat tab
 * terlihat; `router.refresh()` mempertahankan keadaan klien. Tab di peramban yang sama sudah tersinkron lewat
 * `DemoSync` (BroadcastChannel).
 */
export function DemoPolling({ intervalMs = 3000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh();
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [router, intervalMs]);
  return null;
}
