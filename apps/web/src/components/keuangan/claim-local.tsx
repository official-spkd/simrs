'use client';

import type { Claim } from '@simrs/shared';
import { Chip } from '@simrs/ui';
import { createContext, type ReactNode, useContext } from 'react';
import { type ClaimLocal, localClaimTag, levelTone } from '@/lib/keuangan-klaim';

const Ctx = createContext<Readonly<Record<string, ClaimLocal>>>({});
const EMPTY: ClaimLocal = {};

/**
 * Tindakan koder per klaim (mockup Klaim: `queries`, `docs`, `sent` per id) yang tersimpan di toko demo (domain
 * `klaim`, ADR-0085): pindah klaim, muat ulang, atau ganti perangkat tidak menghapus query, saran yang diterima,
 * centang berkas, atau status terkirim; chip di daftar ikut berubah.
 */
export function ClaimLocalProvider({
  locals,
  children,
}: {
  locals: Readonly<Record<string, ClaimLocal>>;
  children: ReactNode;
}) {
  return <Ctx.Provider value={locals}>{children}</Ctx.Provider>;
}

/** Tindakan tersimpan satu klaim (kosong bila belum ada). */
export function useClaimLocal(id: string): ClaimLocal {
  return useContext(Ctx)[id] ?? EMPTY;
}

/** Chip status klaim di daftar: mengikuti tindakan koder tersimpan (terkirim, saran diterima, menunggu DPJP). */
export function ClaimListTag({ claim }: { claim: Pick<Claim, 'id' | 'status' | 'tag'> }) {
  const tag = localClaimTag(claim, useClaimLocal(claim.id));
  return <Chip tone={levelTone(tag.level)}>{tag.label}</Chip>;
}
