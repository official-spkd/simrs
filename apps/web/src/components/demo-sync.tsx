'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useTransition } from 'react';
import { type DemoCommandInput, demoCommandAction } from '@/app/(staf)/simulasi/actions';

/** Kanal antar-tab di browser yang sama: tab lain memuat ulang tampilannya saat simulasi berubah. */
const DEMO_CHANNEL = 'simrs-demo';

export function announceDemoChange(): void {
  try {
    const ch = new BroadcastChannel(DEMO_CHANNEL);
    ch.postMessage('berubah');
    ch.close();
  } catch {
    // BroadcastChannel tidak tersedia: tab lain tersinkron saat dimuat ulang.
  }
}

/**
 * Pasang sekali di layout mode presentasi. Layout tidak dirender ulang saat navigasi, jadi perubahan simulasi dari
 * tab lain (atau kembali lewat tombol Back) memicu `router.refresh()`.
 */
export function DemoSync() {
  const router = useRouter();
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), 250);
    };
    let ch: BroadcastChannel | undefined;
    try {
      ch = new BroadcastChannel(DEMO_CHANNEL);
      ch.onmessage = refresh;
    } catch {
      ch = undefined;
    }
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) refresh();
    };
    window.addEventListener('pageshow', onShow);
    return () => {
      clearTimeout(timer);
      ch?.close();
      window.removeEventListener('pageshow', onShow);
    };
  }, [router]);
  return null;
}

export interface DemoRunnerError {
  message: string;
  task?: string;
}

/**
 * Jalankan perintah presenter ke server. Satu perintah sekaligus; `rev` terkini diambil dari prop terakhir
 * (setelah action, Next memperbarui halaman beserta rev barunya dalam transisi yang sama).
 */
export function useDemoRunner(rev: number) {
  const router = useRouter();
  const revRef = useRef(rev);
  // Layout effect: rev baru sudah terpasang sebelum efek biasa di komponen anak berjalan, sehingga tugas berantai
  // (mis. `lapor` lalu `readback`) yang dipicu dari efek anak tidak memakai rev lama dan ditolak sebagai basi.
  useLayoutEffect(() => {
    revRef.current = rev;
  }, [rev]);
  const busy = useRef(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<DemoRunnerError | null>(null);

  const run = useCallback(
    (cmd: DemoCommandInput, onDone?: (ok: boolean) => void) => {
      if (busy.current) return;
      busy.current = true;
      startTransition(async () => {
        try {
          const r = await demoCommandAction(revRef.current, cmd);
          if (r.error) {
            setError({ message: r.error, task: r.task });
            if (r.stale) router.refresh();
            onDone?.(false);
          } else {
            setError(null);
            announceDemoChange();
            onDone?.(true);
          }
        } finally {
          busy.current = false;
        }
      });
    },
    [router],
  );
  return { run, pending, error, clearError: () => setError(null) };
}
