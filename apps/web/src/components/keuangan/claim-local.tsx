'use client';

import type { Claim } from '@simrs/shared';
import { Chip } from '@simrs/ui';
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';
import { type ClaimLocal, localClaimTag, levelTone } from '@/lib/keuangan-klaim';

interface Store {
  get: (id: string) => ClaimLocal;
  patch: (id: string, p: Partial<ClaimLocal>) => void;
}

const Ctx = createContext<Store | null>(null);
const EMPTY: ClaimLocal = {};

/**
 * Keadaan kerja koder per klaim selama layar terbuka (mockup Klaim: `queries`, `docs`, `sent` per id): pindah ke
 * klaim lain lalu kembali tidak menghapus query, saran yang diterima, centang berkas, atau status terkirim, dan chip
 * di daftar ikut berubah. Simulasi (tidak disimpan); provider berada di halaman sehingga bertahan saat `?pilih=`
 * berganti.
 */
export function ClaimLocalProvider({ children }: { children: ReactNode }) {
  const [map, setMap] = useState<Record<string, ClaimLocal>>({});
  const patch = useCallback(
    (id: string, p: Partial<ClaimLocal>) => setMap((m) => ({ ...m, [id]: { ...m[id], ...p } })),
    [],
  );
  const store = useMemo<Store>(() => ({ get: (id) => map[id] ?? EMPTY, patch }), [map, patch]);
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

/** Keadaan lokal satu klaim + pengubahnya; tanpa provider (mis. tes) jatuh ke keadaan komponen biasa. */
export function useClaimLocal(id: string): [ClaimLocal, (p: Partial<ClaimLocal>) => void] {
  const store = useContext(Ctx);
  const [own, setOwn] = useState<ClaimLocal>(EMPTY);
  const ownPatch = useCallback((p: Partial<ClaimLocal>) => setOwn((s) => ({ ...s, ...p })), []);
  if (!store) return [own, ownPatch];
  return [store.get(id), (p) => store.patch(id, p)];
}

/** Chip status klaim di daftar: mengikuti tindakan koder di layar (terkirim, saran diterima, menunggu DPJP). */
export function ClaimListTag({ claim }: { claim: Pick<Claim, 'id' | 'status' | 'tag'> }) {
  const store = useContext(Ctx);
  const tag = localClaimTag(claim, store?.get(claim.id) ?? EMPTY);
  return <Chip tone={levelTone(tag.level)}>{tag.label}</Chip>;
}
