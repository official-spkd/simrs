import type { Metadata } from 'next';
import { ScreenAccessDenied } from '@/components/screen-gate';
import { requireScreen } from '@/lib/server/screen-guard';
import { ApiResumeList } from './api-resume-list';
import { DemoResumeList } from './demo-resume-list';

export const metadata: Metadata = { title: 'Resume medis' };

/**
 * K13 · Pintu resume medis. Layar hibrida (`requireScreen`): mode presentasi memakai data fiktif
 * (`demo-resume-list.tsx`, dibekukan); mode api untuk peran ber-izin `clinical.write` (TTE resume tetap
 * `clinical.sign` di API): daftar pasien yang saya rawat (W5b, `api-resume-list.tsx`).
 */
export default async function ResumeIndexPage() {
  const access = await requireScreen('resume');
  if (access.mode === 'demo') return <DemoResumeList access={access} />;
  if (!access.allowed) return <ScreenAccessDenied screen={access.screen} />;
  return <ApiResumeList session={access.session} />;
}
