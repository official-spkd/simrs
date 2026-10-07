import type { Metadata } from 'next';
import { ScreenAccessDenied, ScreenNotConnected } from '@/components/screen-gate';
import { requireScreen } from '@/lib/server/screen-guard';
import { DemoFarmasi } from './demo-farmasi';

export const metadata: Metadata = { title: 'Farmasi' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * S04/S05 · Layar hibrida Farmasi (rencana fase 4 potongan 4.0c, pola 3.0d klinis): mode presentasi memakai data dummy
 * (`demo-farmasi.tsx` + `actions-demo.ts`, dibekukan); mode api untuk peran yang memegang izin layar, jalur API diisi
 * potongan 4.5 dan 4.6b (sampai itu "Belum tersambung").
 */
export default async function FarmasiPage({ searchParams }: { searchParams: SearchParams }) {
  const access = await requireScreen('farmasi');
  if (access.mode === 'demo') return <DemoFarmasi access={access} searchParams={searchParams} />;
  if (!access.allowed) return <ScreenAccessDenied screen={access.screen} />;
  return <ScreenNotConnected screen={access.screen} role={access.session.role?.code ?? null} />;
}
