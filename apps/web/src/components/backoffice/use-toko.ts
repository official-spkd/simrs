'use client';

import { useCallback, useState } from 'react';
import { useStoreAction } from '@/lib/demo/store/client';
import type { DomainName, EventOf } from '@/lib/demo/store/registry';
import { dispatchDemoEventAction } from '@/lib/server/demo/state-actions';
import type { Flash } from './kit';

export const STALE_TEXT = 'Data berubah di tempat lain; tampilan dimuat ulang. Ulangi aksi bila masih perlu.';

/**
 * Kirim kejadian domain back office (generik, ADR-0085) dan tampilkan umpan balik: berhasil = teks yang diberikan,
 * ditolak = pesan gerbang dari server. Hasil aksi datang dari server (`revalidatePath`), bukan dari `useState`.
 */
export function useTokoAction<N extends DomainName>(name: N, rev: number) {
  const { run, pending } = useStoreAction(rev, name);
  const [flash, setFlash] = useState<Flash | null>(null);
  const act = useCallback(
    (event: EventOf<N>, okText: string | null, onOk?: () => void) =>
      run(
        (r) => dispatchDemoEventAction(name, event, r),
        (res) => {
          if (res.ok) {
            setFlash(okText ? { ok: true, text: okText } : null);
            onOk?.();
          } else {
            setFlash({ ok: false, text: res.stale ? STALE_TEXT : (res.error ?? 'Aksi ditolak.') });
          }
        },
      ),
    [name, run],
  );
  return { act, pending, flash, setFlash };
}
