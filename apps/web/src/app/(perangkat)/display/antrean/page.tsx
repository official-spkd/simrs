import type { Metadata } from 'next';
import { ScreenAccessDenied, ScreenNotConnected } from '@/components/screen-gate';
import { requireScreen } from '@/lib/server/screen-guard';
import { DemoAntrean } from './demo-antrean';

export const metadata: Metadata = { title: 'Display antrean' };

/**
 * F04 · Display antrean ruang tunggu (mockup `DisplayAntrean.dc.html`). Layar hibrida (`requireScreen`): mode
 * presentasi memakai data dummy (`demo-antrean.tsx`); mode api untuk pemegang izin `queue.display.read` (kelak
 * prinsipal perangkat, ADR-0027), jalur API (SSE lewat BFF) diisi fase 2 potongan 4b.
 */
export default async function DisplayAntreanPage() {
  const access = await requireScreen('antrean');
  if (access.mode === 'demo') return <DemoAntrean access={access} />;
  if (!access.allowed) return <ScreenAccessDenied screen={access.screen} />;
  return <ScreenNotConnected screen={access.screen} role={access.session.role?.code ?? null} />;
}
