import type { Metadata } from 'next';
import { ScreenAccessDenied } from '@/components/screen-gate';
import { requireScreen } from '@/lib/server/screen-guard';
import { ApiDiagnostik } from './api-diagnostik';
import { DemoDiagnostik } from './demo-diagnostik';

export const metadata: Metadata = { title: 'Diagnostik lain' };

/**
 * S10 · Layar hibrida Diagnostik lain (rencana fase 4 potongan 4.0c, pola 3.0d klinis): mode presentasi memakai data
 * dummy (`demo-diagnostik.tsx` + `actions-demo.ts`, dibekukan); mode api (potongan 4.8, ADR-0120) untuk peran ber-izin
 * `diagnostics.write`: order EKG/USG/echo/endoskopi/treadmill → isian P07 + kesimpulan → TTE → panel hasil.
 */
export default async function DiagnostikPage() {
  const access = await requireScreen('diagnostik');
  if (access.mode === 'demo') return <DemoDiagnostik access={access} />;
  if (!access.allowed) return <ScreenAccessDenied screen={access.screen} />;
  return <ApiDiagnostik session={access.session} />;
}
