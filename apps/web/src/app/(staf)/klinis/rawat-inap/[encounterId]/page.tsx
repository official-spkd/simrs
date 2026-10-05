import type { Metadata } from 'next';
import { ScreenAccessDenied, ScreenNotConnected } from '@/components/screen-gate';
import { requireScreen } from '@/lib/server/screen-guard';
import { DemoRawatInapDetail } from './demo-rawat-inap-detail';

export const metadata: Metadata = { title: 'Rawat inap' };

type Params = Promise<{ encounterId: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * K04/K07/K12 · Rekam rawat inap satu pasien (mockup `Ranap.dc.html`): CPPT, eMAR, EWS, askep, hasil. Layar hibrida
 * (`requireScreen`): mode presentasi memakai data fiktif (`demo-rawat-inap-detail.tsx`, dibekukan); mode api untuk
 * peran ber-izin `clinical.write`, jalur API diisi layar W4 (sampai itu "Belum tersambung"). `?tab=` = tab awal.
 */
export default async function RawatInapDetailPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const access = await requireScreen('ranap');
  if (access.mode === 'demo') {
    const [{ encounterId }, sp] = await Promise.all([params, searchParams]);
    return (
      <DemoRawatInapDetail
        access={access}
        encounterId={encounterId}
        tab={typeof sp.tab === 'string' ? sp.tab : null}
      />
    );
  }
  if (!access.allowed) return <ScreenAccessDenied screen={access.screen} />;
  return <ScreenNotConnected screen={access.screen} role={access.session.role?.code ?? null} />;
}
