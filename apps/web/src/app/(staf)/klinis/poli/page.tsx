import type { Metadata } from 'next';
import { ScreenAccessDenied, ScreenNotConnected } from '@/components/screen-gate';
import { requireScreen } from '@/lib/server/screen-guard';
import { DemoPoli } from './demo-poli';

export const metadata: Metadata = { title: 'Pemeriksaan poli' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * K01/K02 · Pemeriksaan poli + CPPT/SOAP (mockup `Main.dc.html`). Layar hibrida (`requireScreen`): mode presentasi
 * memakai data dummy (`demo-poli.tsx`, dibekukan); mode api untuk peran ber-izin `clinical.write`, jalur API diisi
 * layar W1 (sampai itu "Belum tersambung"). `?pasien=<id>` = kunjungan yang dibuka.
 */
export default async function PoliPage({ searchParams }: { searchParams: SearchParams }) {
  const access = await requireScreen('poli');
  if (access.mode === 'demo') {
    const sp = await searchParams;
    return <DemoPoli access={access} pasien={typeof sp.pasien === 'string' ? sp.pasien : null} />;
  }
  if (!access.allowed) return <ScreenAccessDenied screen={access.screen} />;
  return <ScreenNotConnected screen={access.screen} role={access.session.role?.code ?? null} />;
}
