'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useLayoutEffect, useRef, useState, useTransition } from 'react';
import { announceDemoChange } from '@/components/demo-sync';
import { dispatchDemoEventAction } from '@/lib/server/demo/state-actions';
import type { DomainName, EventOf } from './registry';

/**
 * Sisi klien toko demo bersama (ADR-0085). Komponen menerima `rev` dari server component (`readDomain`) dan
 * mengirimnya bersama aksi; sesudah aksi berhasil, `revalidatePath` di server memperbarui halaman (beserta rev baru)
 * dan tab lain di peramban yang sama diberi tahu lewat `announceDemoChange()`.
 */

/** Hasil minimal Server Action yang menulis ke toko. */
export interface StoreActionResult {
  ok: boolean;
  /** Tampilan basi: halaman dimuat ulang otomatis. */
  stale?: boolean;
}

/**
 * Jalankan Server Action yang menulis ke toko dengan revisi terkini. Satu aksi sekaligus; `rev` diambil dari prop
 * terakhir (layout effect, agar aksi berantai tidak memakai rev lama). Basi → `router.refresh()`.
 */
export function useStoreAction(rev: number) {
  const router = useRouter();
  const revRef = useRef(rev);
  useLayoutEffect(() => {
    revRef.current = rev;
  }, [rev]);
  const busy = useRef(false);
  const [pending, startTransition] = useTransition();

  const run = useCallback(
    <R extends StoreActionResult>(action: (rev: number) => Promise<R>, onDone?: (r: R) => void) => {
      if (busy.current) return;
      busy.current = true;
      startTransition(async () => {
        try {
          const r = await action(revRef.current);
          if (r.ok) {
            announceDemoChange();
          } else if (r.stale) {
            router.refresh();
          }
          onDone?.(r);
        } finally {
          busy.current = false;
        }
      });
    },
    [router],
  );
  return { run, pending };
}

/**
 * Kirim kejadian lewat Server Action generik (hanya domain `generic: true`). Contoh:
 * `const { dispatch } = useDemoDispatch('antrean', rev); dispatch({ type: 'tiket.dipanggil', ticketId })`.
 */
export function useDemoDispatch<N extends DomainName>(name: N, rev: number) {
  const { run, pending } = useStoreAction(rev);
  const [error, setError] = useState<string | null>(null);
  const dispatch = useCallback(
    (event: EventOf<N>, onDone?: (ok: boolean) => void) =>
      run(
        (r) => dispatchDemoEventAction(name, event, r),
        (res) => {
          setError(res.ok ? null : (res.error ?? null));
          onDone?.(res.ok);
        },
      ),
    [name, run],
  );
  return { dispatch, pending, error };
}
