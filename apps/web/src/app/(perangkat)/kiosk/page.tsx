import type { Metadata } from 'next';
import { ScreenAccessDenied, ScreenNotConnected } from '@/components/screen-gate';
import { requireScreen } from '@/lib/server/screen-guard';
import { DemoKiosk } from './demo-kiosk';

export const metadata: Metadata = { title: 'Anjungan mandiri' };

/**
 * F05 · Anjungan pendaftaran mandiri (mockup `Anjungan.dc.html`). Layar hibrida (`requireScreen`): mode presentasi
 * memakai data dummy (`demo-kiosk.tsx`); mode api untuk pemegang izin `kiosk.use` (kelak prinsipal perangkat,
 * ADR-0027), jalur API diisi fase 2 potongan 6.
 */
export default async function KioskPage() {
  const access = await requireScreen('kiosk');
  if (access.mode === 'demo') return <DemoKiosk access={access} />;
  if (!access.allowed) return <ScreenAccessDenied screen={access.screen} />;
  return <ScreenNotConnected screen={access.screen} role={access.session.role?.code ?? null} />;
}
