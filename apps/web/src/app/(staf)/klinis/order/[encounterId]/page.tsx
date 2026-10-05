import type { Metadata } from 'next';
import { ScreenAccessDenied, ScreenNotConnected } from '@/components/screen-gate';
import { requireScreen } from '@/lib/server/screen-guard';
import { DemoCpoe } from './demo-cpoe';

export const metadata: Metadata = { title: 'Order & resep (CPOE)' };

/**
 * K09 · CPOE + CDS satu kunjungan (mockup `CPOE.dc.html`). Layar hibrida (`requireScreen`): mode presentasi memakai
 * data dummy (`demo-cpoe.tsx`, dibekukan); mode api untuk peran ber-izin `order.write`, jalur API diisi layar W2
 * (sampai itu "Belum tersambung").
 */
export default async function CpoePage({ params }: { params: Promise<{ encounterId: string }> }) {
  const access = await requireScreen('order');
  if (access.mode === 'demo') return <DemoCpoe access={access} encounterId={(await params).encounterId} />;
  if (!access.allowed) return <ScreenAccessDenied screen={access.screen} />;
  return <ScreenNotConnected screen={access.screen} role={access.session.role?.code ?? null} />;
}
