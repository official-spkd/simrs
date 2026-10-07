import type { Metadata } from 'next';
import { ScreenAccessDenied } from '@/components/screen-gate';
import { requireScreen } from '@/lib/server/screen-guard';
import { ApiDiagnosis } from './api-diagnosis';
import { DemoDiagnosis } from './demo-diagnosis';

export const metadata: Metadata = { title: 'Diagnosis & problem list' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Diagnosis & problem list. Layar hibrida (`requireScreen`): mode presentasi = rekam fiktif + toko demo (`demo-diagnosis.tsx`, `?pasien=`); mode api
 * untuk peran berizin layar (`api-diagnosis.tsx`, data dan aksi dari API; `?kunjungan=<id>`).
 */
export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  const access = await requireScreen('diagnosis');
  const sp = await searchParams;
  if (access.mode === 'demo') return <DemoDiagnosis access={access} pasien={sp.pasien} />;
  if (!access.allowed) return <ScreenAccessDenied screen={access.screen} />;
  return <ApiDiagnosis session={access.session} searchParams={sp} />;
}
