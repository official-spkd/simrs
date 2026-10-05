import type { Metadata } from 'next';
import { ScreenAccessDenied, ScreenNotConnected } from '@/components/screen-gate';
import { requireScreen } from '@/lib/server/screen-guard';
import { DemoOrderIndex } from './demo-order';

export const metadata: Metadata = { title: 'Order & resep (CPOE)' };

/**
 * K09 · Pilih kunjungan untuk dibuka di CPOE. Layar hibrida (`requireScreen`): mode presentasi memakai data dummy
 * (`demo-order.tsx`, dibekukan); mode api untuk peran ber-izin `order.write`, jalur API diisi layar W2 (sampai itu
 * "Belum tersambung").
 */
export default async function CpoeIndexPage() {
  const access = await requireScreen('order');
  if (access.mode === 'demo') return <DemoOrderIndex access={access} />;
  if (!access.allowed) return <ScreenAccessDenied screen={access.screen} />;
  return <ScreenNotConnected screen={access.screen} role={access.session.role?.code ?? null} />;
}
