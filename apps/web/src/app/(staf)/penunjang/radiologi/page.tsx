import type { Metadata } from 'next';
import { ScreenAccessDenied, ScreenNotConnected } from '@/components/screen-gate';
import { requireScreen } from '@/lib/server/screen-guard';
import { DemoRadiologi } from './demo-radiologi';

export const metadata: Metadata = { title: 'Radiologi' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * S03 · Layar hibrida Radiologi (rencana fase 4 potongan 4.0c, pola 3.0d klinis): mode presentasi memakai data dummy
 * (`demo-radiologi.tsx` + `actions-demo.ts`, dibekukan); mode api untuk peran yang memegang izin layar, jalur API diisi
 * potongan 4.4 (sampai itu "Belum tersambung").
 */
export default async function RadiologiPage({ searchParams }: { searchParams: SearchParams }) {
  const access = await requireScreen('rad');
  if (access.mode === 'demo') return <DemoRadiologi access={access} searchParams={searchParams} />;
  if (!access.allowed) return <ScreenAccessDenied screen={access.screen} />;
  return <ScreenNotConnected screen={access.screen} role={access.session.role?.code ?? null} />;
}
