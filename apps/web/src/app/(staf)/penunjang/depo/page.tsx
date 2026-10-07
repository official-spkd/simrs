import type { Metadata } from 'next';
import { ScreenAccessDenied } from '@/components/screen-gate';
import { requireScreen } from '@/lib/server/screen-guard';
import { ApiDepo } from './api-depo';
import { DemoDepo } from './demo-depo';

export const metadata: Metadata = { title: 'Depo & stok farmasi' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * S05 · Layar hibrida Depo & stok farmasi: mode presentasi memakai data dummy (`demo-depo.tsx` + `actions-demo.ts`,
 * dibekukan); mode api (potongan 4.6a, `api-depo.tsx` + `actions.ts`) untuk peran ber-izin `stock.read`.
 * `?depo=<id lokasi>` = depo/gudang yang dibuka.
 */
export default async function DepoPage({ searchParams }: { searchParams: SearchParams }) {
  const access = await requireScreen('depo');
  if (access.mode === 'demo') return <DemoDepo access={access} />;
  if (!access.allowed) return <ScreenAccessDenied screen={access.screen} />;
  const { depo } = await searchParams;
  return <ApiDepo session={access.session} depo={typeof depo === 'string' ? depo : null} />;
}
