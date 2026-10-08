import type { Metadata } from 'next';
import { ScreenAccessDenied } from '@/components/screen-gate';
import { requireScreen } from '@/lib/server/screen-guard';
import { ApiMikrobiologi } from './api-mikrobiologi';
import { DemoMikrobiologi } from './demo-mikrobiologi';

export const metadata: Metadata = { title: 'Mikrobiologi & PA' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);

/**
 * S02 · Layar hibrida Mikrobiologi & PA (rencana fase 4 potongan 4.0c, pola 3.0d klinis): mode presentasi memakai data
 * dummy (`demo-mikrobiologi.tsx` + `actions-demo.ts`, dibekukan); mode api (potongan 4.8, ADR-0120) untuk peran ber-izin
 * `lab.worklist.read`: kultur per tahap + rilis ber-TTE, antibiogram, PA dari spesimen kamar operasi.
 */
export default async function MikrobiologiPage({ searchParams }: { searchParams: SearchParams }) {
  const access = await requireScreen('mikro');
  if (access.mode === 'demo') return <DemoMikrobiologi access={access} />;
  if (!access.allowed) return <ScreenAccessDenied screen={access.screen} />;
  const sp = await searchParams;
  return <ApiMikrobiologi session={access.session} from={one(sp.dari)} to={one(sp.sampai)} />;
}
