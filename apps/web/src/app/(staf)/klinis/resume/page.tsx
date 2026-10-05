import type { Metadata } from 'next';
import { ScreenAccessDenied, ScreenNotConnected } from '@/components/screen-gate';
import { requireScreen } from '@/lib/server/screen-guard';
import { DemoResumeList } from './demo-resume-list';

export const metadata: Metadata = { title: 'Resume medis' };

/**
 * K13 · Pintu resume medis. Layar hibrida (`requireScreen`): mode presentasi memakai data fiktif
 * (`demo-resume-list.tsx`, dibekukan); mode api untuk peran ber-izin `clinical.write` (TTE resume tetap
 * `clinical.sign` di API), jalur API diisi layar W5b (sampai itu "Belum tersambung").
 */
export default async function ResumeIndexPage() {
  const access = await requireScreen('resume');
  if (access.mode === 'demo') return <DemoResumeList access={access} />;
  if (!access.allowed) return <ScreenAccessDenied screen={access.screen} />;
  return <ScreenNotConnected screen={access.screen} role={access.session.role?.code ?? null} />;
}
