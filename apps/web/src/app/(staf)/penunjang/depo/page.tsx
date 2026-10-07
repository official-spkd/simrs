import type { Metadata } from 'next';
import { ScreenAccessDenied, ScreenNotConnected } from '@/components/screen-gate';
import { requireScreen } from '@/lib/server/screen-guard';
import { DemoDepo } from './demo-depo';

export const metadata: Metadata = { title: 'Depo & stok farmasi' };

/**
 * S05 · Layar hibrida Depo & stok farmasi (rencana fase 4 potongan 4.0c, pola 3.0d klinis): mode presentasi memakai data dummy
 * (`demo-depo.tsx` + `actions-demo.ts`, dibekukan); mode api untuk peran yang memegang izin layar, jalur API diisi
 * potongan 4.6a (sampai itu "Belum tersambung").
 */
export default async function DepoPage() {
  const access = await requireScreen('depo');
  if (access.mode === 'demo') return <DemoDepo access={access} />;
  if (!access.allowed) return <ScreenAccessDenied screen={access.screen} />;
  return <ScreenNotConnected screen={access.screen} role={access.session.role?.code ?? null} />;
}
