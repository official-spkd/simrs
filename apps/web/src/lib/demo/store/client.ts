'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useLayoutEffect, useRef, useState, useTransition } from 'react';
import { announceDemoChange } from '@/components/demo-sync';
import { dispatchDemoEventAction } from '@/lib/server/demo/state-actions';
import type { DomainName, EventOf } from './registry';
import { DomainRevisions, revAfterAction } from './rev';

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
  /** Revisi toko setelah aksi berhasil (bila Server Action mengembalikannya); dipakai aksi berikutnya. */
  rev?: number;
}

/**
 * Jalankan Server Action yang menulis ke toko dengan revisi terkini. Satu aksi sekaligus; `rev` diambil dari prop
 * terakhir (layout effect) atau dari hasil aksi berhasil sebelumnya (`revAfterAction`), agar aksi berantai tidak
 * memakai rev lama sebelum halaman yang dimuat ulang tiba. Aksi yang hasilnya tidak membawa revisi: aksi berikutnya
 * menunggu prop `rev` baru (paling lama `FRESH_REV_WAIT_MS`). `domain` (opsional) berbagi revisi aksi terakhir dengan
 * komponen lain domain yang sama di halaman ini (`DomainRevisions`). Basi → `router.refresh()`.
 */
const DOMAIN_REVISIONS = new DomainRevisions();
const FRESH_REV_WAIT_MS = 4_000;

export function useStoreAction(rev: number, domain?: DomainName) {
  const router = useRouter();
  const revRef = useRef(rev);
  /** Revisi yang dikirim aksi berhasil tanpa revisi di hasilnya: prop yang masih sama dengan ini = basi. */
  const awaitingNewerThan = useRef<number | null>(null);
  const waiters = useRef<Array<() => void>>([]);
  useLayoutEffect(() => {
    revRef.current = rev;
    if (awaitingNewerThan.current !== null && rev !== awaitingNewerThan.current) {
      awaitingNewerThan.current = null;
      for (const wake of waiters.current.splice(0)) wake();
    }
  }, [rev]);
  const busy = useRef(false);
  const [pending, startTransition] = useTransition();

  const run = useCallback(
    <R extends StoreActionResult>(action: (rev: number) => Promise<R>, onDone?: (r: R) => void) => {
      if (busy.current) return;
      busy.current = true;
      startTransition(async () => {
        try {
          if (awaitingNewerThan.current !== null && revRef.current === awaitingNewerThan.current) {
            await new Promise<void>((resolve) => {
              waiters.current.push(resolve);
              setTimeout(resolve, FRESH_REV_WAIT_MS);
            });
          }
          awaitingNewerThan.current = null;
          const sent = domain ? DOMAIN_REVISIONS.toSend(domain, revRef.current) : revRef.current;
          const r = await action(sent);
          const carriesRev = revAfterAction(-1, r) >= 0;
          revRef.current = revAfterAction(revRef.current, r);
          // Berhasil tanpa revisi di hasilnya dan prop belum berganti: aksi berikutnya menunggu prop baru.
          if (r.ok && !carriesRev && revRef.current === sent) awaitingNewerThan.current = sent;
          if (domain) DOMAIN_REVISIONS.record(domain, r);
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
    [router, domain],
  );
  return { run, pending };
}

/**
 * Kirim kejadian lewat Server Action generik (hanya domain `generic: true`). Contoh:
 * `const { dispatch } = useDemoDispatch('antrean', rev); dispatch({ type: 'tiket.dipanggil', ticketId })`.
 */
export function useDemoDispatch<N extends DomainName>(name: N, rev: number) {
  const { run, pending } = useStoreAction(rev, name);
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
