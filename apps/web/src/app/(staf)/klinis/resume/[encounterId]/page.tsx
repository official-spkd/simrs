import type { Metadata } from 'next';
import { ScreenAccessDenied, ScreenNotConnected } from '@/components/screen-gate';
import { requireScreen } from '@/lib/server/screen-guard';
import { DemoResume } from './demo-resume';

export const metadata: Metadata = { title: 'Resume medis' };

type Params = Promise<{ encounterId: string }>;

/**
 * K13 · Resume medis pulang (mockup `Resume.dc.html`). Layar hibrida (`requireScreen`): mode presentasi memakai data
 * fiktif (`demo-resume.tsx`, dibekukan); mode api untuk peran ber-izin `clinical.write`, jalur API diisi layar W5b
 * (sampai itu "Belum tersambung").
 */
export default async function ResumePage({ params }: { params: Params }) {
  const access = await requireScreen('resume');
  if (access.mode === 'demo') return <DemoResume access={access} encounterId={(await params).encounterId} />;
  if (!access.allowed) return <ScreenAccessDenied screen={access.screen} />;
  return <ScreenNotConnected screen={access.screen} role={access.session.role?.code ?? null} />;
}
