'use client';

import type { PharmacyPrescription } from '@simrs/shared';
import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { liveRxLocal, parseStoredRxLocal, patchStoredRxLocal, type RxLocal } from '@/lib/penunjang-farmasi';

/** Kunci sessionStorage kemajuan lokal farmasi per pengguna (per tab; hanya kenyamanan, tidak ke server). */
const keyOf = (scope: string) => `simrs-farmasi-lokal:${scope}`;
const memory = new Map<string, string>();
const listeners = new Set<() => void>();

function read(key: string): string | null {
  try {
    return sessionStorage.getItem(key) ?? memory.get(key) ?? null;
  } catch {
    return memory.get(key) ?? null;
  }
}

function write(key: string, value: string): void {
  memory.set(key, value);
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // Tanpa sessionStorage: kemajuan hanya diingat selama skrip halaman hidup.
  }
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Kemajuan lokal tiap resep (centang penyiapan/serah terima, penerima, tindak lanjut CDS, tahanan, cek ganda).
 * Disimpan per resep bersama tahap server-nya, sehingga tetap ada saat data halaman divalidasi ulang atau halaman
 * dibuat ulang oleh router setelah simulasi maju, dan dibuang bila resep itu berpindah tahap di server. Saat
 * hidrasi dipakai keadaan kosong (sama dengan render server), lalu isi tersimpan.
 */
export function useRxLocal(
  prescriptions: readonly Pick<PharmacyPrescription, 'id' | 'stage'>[],
  scope: string,
): [Record<string, RxLocal>, (id: string, fn: (cur: RxLocal) => RxLocal) => void] {
  const key = keyOf(scope);
  const raw = useSyncExternalStore(
    subscribe,
    () => read(key),
    () => null,
  );
  const local = useMemo(() => {
    const live = liveRxLocal(parseStoredRxLocal(raw), prescriptions);
    return Object.fromEntries(Object.entries(live).map(([id, e]) => [id, e.local]));
  }, [raw, prescriptions]);
  const patch = useCallback(
    (id: string, fn: (cur: RxLocal) => RxLocal) =>
      write(key, JSON.stringify(patchStoredRxLocal(parseStoredRxLocal(read(key)), prescriptions, id, fn))),
    [key, prescriptions],
  );
  return [local, patch];
}
