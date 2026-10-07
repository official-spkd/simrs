import type { Metadata } from 'next';
import { ScreenAccessDenied, ScreenNotConnected } from '@/components/screen-gate';
import { requireScreen } from '@/lib/server/screen-guard';
import { DemoLab } from './demo-lab';

export const metadata: Metadata = { title: 'Laboratorium' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * S01/S09 · Layar hibrida Laboratorium (rencana fase 4 potongan 4.0c, pola 3.0d klinis): mode presentasi memakai data dummy
 * (`demo-lab.tsx` + `actions-demo.ts`, dibekukan); mode api untuk peran yang memegang izin layar, jalur API diisi
 * potongan 4.2 (sampai itu "Belum tersambung").
 */
export default async function LabPage({ searchParams }: { searchParams: SearchParams }) {
  const access = await requireScreen('lab');
  if (access.mode === 'demo') return <DemoLab access={access} searchParams={searchParams} />;
  if (!access.allowed) return <ScreenAccessDenied screen={access.screen} />;
  return <ScreenNotConnected screen={access.screen} role={access.session.role?.code ?? null} />;
}
