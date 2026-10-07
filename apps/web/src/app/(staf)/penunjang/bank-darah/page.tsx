import type { Metadata } from 'next';
import { ScreenAccessDenied, ScreenNotConnected } from '@/components/screen-gate';
import { requireScreen } from '@/lib/server/screen-guard';
import { DemoBankDarah } from './demo-bank-darah';

export const metadata: Metadata = { title: 'Bank darah' };

/**
 * S08 · Layar hibrida Bank darah (rencana fase 4 potongan 4.0c, pola 3.0d klinis): mode presentasi memakai data dummy
 * (`demo-bank-darah.tsx` + `actions-demo.ts`, dibekukan); mode api untuk peran yang memegang izin layar, jalur API diisi
 * potongan 4.9 (sampai itu "Belum tersambung").
 */
export default async function BankDarahPage() {
  const access = await requireScreen('bank-darah');
  if (access.mode === 'demo') return <DemoBankDarah access={access} />;
  if (!access.allowed) return <ScreenAccessDenied screen={access.screen} />;
  return <ScreenNotConnected screen={access.screen} role={access.session.role?.code ?? null} />;
}
