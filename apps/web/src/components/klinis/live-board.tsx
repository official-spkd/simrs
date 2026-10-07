'use client';

import { cx } from '@simrs/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { withBasePath } from '@/lib/base-path';
import { type BoardStreamStatus, connectBoardStream } from '@/lib/board-stream';

/**
 * Papan klinis real-time (W3, ADR-0104): berlangganan SSE lewat BFF `path`, lalu muat ulang data server halaman
 * (`router.refresh()`, dijeda 250 ms agar beberapa event beruntun cukup satu muat ulang). Keadaan klien (pasien
 * terpilih, isian) tetap.
 */
export function useLiveBoard(
  path: string,
  snapshotEvent: string,
  changeEvents: readonly string[],
): { status: BoardStreamStatus; refreshing: boolean } {
  const router = useRouter();
  const [status, setStatus] = useState<BoardStreamStatus>('menyambung');
  const [refreshing, startTransition] = useTransition();
  const events = changeEvents.join(',');
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const conn = connectBoardStream({
      url: withBasePath(path),
      snapshotEvent,
      changeEvents: events.split(','),
      onStatus: setStatus,
      onChange: () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => startTransition(() => router.refresh()), 250);
      },
    });
    return () => {
      conn.close();
      if (timer) clearTimeout(timer);
    };
  }, [path, snapshotEvent, events, router]);
  return { status, refreshing };
}

const LABEL: Record<BoardStreamStatus, string> = {
  menyambung: 'Menyambung…',
  tersambung: 'Langsung · tersambung',
  terputus: 'Terputus · menyambung ulang',
};

/** Penanda status aliran (teks + titik; status tidak hanya lewat warna). */
export function LiveIndicator({ status, asOf }: { status: BoardStreamStatus; asOf: string }) {
  return (
    <span
      role="status"
      aria-live="polite"
      data-live-status={status}
      className="inline-flex min-h-9 items-center gap-2 rounded-control border border-white/95 bg-white/90 px-3 text-small shadow-card"
    >
      <span
        aria-hidden="true"
        className={cx(
          'size-[7px] rounded-full',
          status === 'tersambung' ? 'bg-success' : status === 'terputus' ? 'bg-danger' : 'bg-warning',
        )}
      />
      {LABEL[status]} · data {asOf}
    </span>
  );
}
