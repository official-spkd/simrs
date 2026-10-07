import type { Metadata } from 'next';
import { ScreenAccessDenied, ScreenNotConnected } from '@/components/screen-gate';
import { requireScreen } from '@/lib/server/screen-guard';
import { DemoGizi } from './demo-gizi';

export const metadata: Metadata = { title: 'Gizi' };

/**
 * S07 · Layar hibrida Gizi (rencana fase 4 potongan 4.0c, pola 3.0d klinis): mode presentasi memakai data dummy
 * (`demo-gizi.tsx` + `actions-demo.ts`, dibekukan); mode api untuk peran yang memegang izin layar, jalur API diisi
 * potongan 4.9 (sampai itu "Belum tersambung").
 */
export default async function GiziPage() {
  const access = await requireScreen('gizi');
  if (access.mode === 'demo') return <DemoGizi access={access} />;
  if (!access.allowed) return <ScreenAccessDenied screen={access.screen} />;
  return <ScreenNotConnected screen={access.screen} role={access.session.role?.code ?? null} />;
}
