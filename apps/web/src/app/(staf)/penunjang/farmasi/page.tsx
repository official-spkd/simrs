import type { Metadata } from 'next';
import { ScreenAccessDenied } from '@/components/screen-gate';
import { requireScreen } from '@/lib/server/screen-guard';
import { ApiFarmasi } from './api-farmasi';
import { DemoFarmasi } from './demo-farmasi';

export const metadata: Metadata = { title: 'Farmasi' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * S04/S05 · Layar hibrida Farmasi (rencana fase 4 potongan 4.0c, pola 3.0d klinis): mode presentasi memakai data dummy
 * (`demo-farmasi.tsx` + `actions-demo.ts`, dibekukan); mode api (`api-farmasi.tsx` + `actions.ts`) untuk peran ber-izin
 * `pharmacy.review.read`: telaah klinis potongan 4.5; penyiapan dan serah terima menyusul 4.6b. `?resep=<id>` = resep
 * yang dibuka.
 */
export default async function FarmasiPage({ searchParams }: { searchParams: SearchParams }) {
  const access = await requireScreen('farmasi');
  if (access.mode === 'demo') return <DemoFarmasi access={access} searchParams={searchParams} />;
  if (!access.allowed) return <ScreenAccessDenied screen={access.screen} />;
  const { resep } = await searchParams;
  return <ApiFarmasi session={access.session} resep={typeof resep === 'string' ? resep : null} />;
}
