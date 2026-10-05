import type { Metadata } from 'next';
import { ScreenAccessDenied, ScreenNotConnected } from '@/components/screen-gate';
import { requireScreen } from '@/lib/server/screen-guard';
import { DemoIgd } from './demo-igd';

export const metadata: Metadata = { title: 'IGD' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * K03 · IGD: papan pelacakan + triase 5 level (mockup `IGD.dc.html`). Layar hibrida (`requireScreen`): mode presentasi
 * memakai data fiktif (`demo-igd.tsx`, dibekukan); mode api untuk peran ber-izin `clinical.write`, jalur API diisi
 * layar W3 (sampai itu "Belum tersambung"). `?pilih=<id>` = pasien yang dibuka di panel triase.
 */
export default async function IgdPage({ searchParams }: { searchParams: SearchParams }) {
  const access = await requireScreen('igd');
  if (access.mode === 'demo') {
    const sp = await searchParams;
    return <DemoIgd access={access} pilih={typeof sp.pilih === 'string' ? sp.pilih : null} />;
  }
  if (!access.allowed) return <ScreenAccessDenied screen={access.screen} />;
  return <ScreenNotConnected screen={access.screen} role={access.session.role?.code ?? null} />;
}
