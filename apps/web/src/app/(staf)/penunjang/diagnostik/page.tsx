import type { Metadata } from 'next';
import { ScreenAccessDenied, ScreenNotConnected } from '@/components/screen-gate';
import { requireScreen } from '@/lib/server/screen-guard';
import { DemoDiagnostik } from './demo-diagnostik';

export const metadata: Metadata = { title: 'Diagnostik lain' };

/**
 * S10 · Layar hibrida Diagnostik lain (rencana fase 4 potongan 4.0c, pola 3.0d klinis): mode presentasi memakai data dummy
 * (`demo-diagnostik.tsx` + `actions-demo.ts`, dibekukan); mode api untuk peran yang memegang izin layar, jalur API diisi
 * potongan 4.8 (sampai itu "Belum tersambung").
 */
export default async function DiagnostikPage() {
  const access = await requireScreen('diagnostik');
  if (access.mode === 'demo') return <DemoDiagnostik access={access} />;
  if (!access.allowed) return <ScreenAccessDenied screen={access.screen} />;
  return <ScreenNotConnected screen={access.screen} role={access.session.role?.code ?? null} />;
}
