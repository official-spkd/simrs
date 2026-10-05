import type { Metadata } from 'next';
import { ScreenAccessDenied, ScreenNotConnected } from '@/components/screen-gate';
import { requireScreen } from '@/lib/server/screen-guard';
import { DemoRawatInap } from './demo-rawat-inap';

export const metadata: Metadata = { title: 'Rawat inap' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * K04 · Daftar pasien rawat inap. Layar hibrida (`requireScreen`): mode presentasi memakai data fiktif
 * (`demo-rawat-inap.tsx`, dibekukan); mode api untuk peran ber-izin `clinical.write`, jalur API diisi layar W4
 * (sampai itu "Belum tersambung"). `?bangsal=<kode>` = filter ruang.
 */
export default async function RawatInapPage({ searchParams }: { searchParams: SearchParams }) {
  const access = await requireScreen('ranap');
  if (access.mode === 'demo') {
    const sp = await searchParams;
    return <DemoRawatInap access={access} bangsal={typeof sp.bangsal === 'string' ? sp.bangsal : null} />;
  }
  if (!access.allowed) return <ScreenAccessDenied screen={access.screen} />;
  return <ScreenNotConnected screen={access.screen} role={access.session.role?.code ?? null} />;
}
