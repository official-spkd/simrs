import type { Metadata } from 'next';
import { ScreenAccessDenied } from '@/components/screen-gate';
import { requireScreen } from '@/lib/server/screen-guard';
import { ApiRawatInapDetail } from './api-rawat-inap-detail';
import { DemoRawatInapDetail } from './demo-rawat-inap-detail';

export const metadata: Metadata = { title: 'Rawat inap' };

type Params = Promise<{ encounterId: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * K04/K07/K12 · Rekam rawat inap satu pasien (mockup `Ranap.dc.html`): CPPT, eMAR, EWS, askep, hasil. Layar hibrida
 * (`requireScreen`): mode presentasi memakai data fiktif (`demo-rawat-inap-detail.tsx`, dibekukan); mode api untuk
 * peran ber-izin `clinical.write` (`api-rawat-inap-detail.tsx`, layar W4). `?tab=` = tab awal.
 */
export default async function RawatInapDetailPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const access = await requireScreen('ranap');
  const [{ encounterId }, sp] = await Promise.all([params, searchParams]);
  const tab = typeof sp.tab === 'string' ? sp.tab : null;
  if (access.mode === 'demo') {
    return <DemoRawatInapDetail access={access} encounterId={encounterId} tab={tab} />;
  }
  if (!access.allowed) return <ScreenAccessDenied screen={access.screen} />;
  return <ApiRawatInapDetail session={access.session} encounterId={encounterId} tab={tab} />;
}
