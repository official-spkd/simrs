import type { Metadata } from 'next';
import { ScreenAccessDenied, ScreenNotConnected } from '@/components/screen-gate';
import { requireScreen } from '@/lib/server/screen-guard';
import { DemoHasilKritis } from './demo-hasil-kritis';

export const metadata: Metadata = { title: 'Pusat hasil kritis' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * S09 · Layar hibrida Pusat hasil kritis (rencana fase 4 potongan 4.0c, pola 3.0d klinis): mode presentasi memakai data dummy
 * (`demo-hasil-kritis.tsx` + `actions-demo.ts`, dibekukan); mode api untuk peran yang memegang izin layar, jalur API diisi
 * potongan 4.3 (sampai itu "Belum tersambung").
 */
export default async function HasilKritisPage({ searchParams }: { searchParams: SearchParams }) {
  const access = await requireScreen('kritis');
  if (access.mode === 'demo') return <DemoHasilKritis access={access} searchParams={searchParams} />;
  if (!access.allowed) return <ScreenAccessDenied screen={access.screen} />;
  return <ScreenNotConnected screen={access.screen} role={access.session.role?.code ?? null} />;
}
