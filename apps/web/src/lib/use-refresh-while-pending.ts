'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';

/**
 * Selama ada dokumen yang TTE-nya masih diproses worker (outbox `tte.sign`), muat ulang data server berkala agar status
 * berubah sendiri menjadi sah/gagal tanpa muat ulang manual. Berhenti setelah ±1 menit (20 × 3 detik); keadaan klien
 * (isian yang sedang diketik) tetap karena `router.refresh` hanya memuat ulang Server Component.
 */
export function useRefreshWhilePending(pending: boolean) {
  const router = useRouter();
  const rounds = useRef(0);
  useEffect(() => {
    if (!pending) {
      rounds.current = 0;
      return;
    }
    if (rounds.current >= 20) return;
    const t = setTimeout(() => {
      rounds.current += 1;
      router.refresh();
    }, 3_000);
    return () => clearTimeout(t);
  });
}
