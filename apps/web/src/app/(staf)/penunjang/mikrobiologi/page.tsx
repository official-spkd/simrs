import type { Metadata } from 'next';
import { ScreenAccessDenied, ScreenNotConnected } from '@/components/screen-gate';
import { requireScreen } from '@/lib/server/screen-guard';
import { DemoMikrobiologi } from './demo-mikrobiologi';

export const metadata: Metadata = { title: 'Mikrobiologi & PA' };

/**
 * S02 · Layar hibrida Mikrobiologi & PA (rencana fase 4 potongan 4.0c, pola 3.0d klinis): mode presentasi memakai data dummy
 * (`demo-mikrobiologi.tsx` + `actions-demo.ts`, dibekukan); mode api untuk peran yang memegang izin layar, jalur API diisi
 * potongan 4.8 (sampai itu "Belum tersambung").
 */
export default async function MikrobiologiPage() {
  const access = await requireScreen('mikro');
  if (access.mode === 'demo') return <DemoMikrobiologi access={access} />;
  if (!access.allowed) return <ScreenAccessDenied screen={access.screen} />;
  return <ScreenNotConnected screen={access.screen} role={access.session.role?.code ?? null} />;
}
