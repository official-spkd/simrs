import type { Metadata } from 'next';
import { ScreenAccessDenied } from '@/components/screen-gate';
import { requireScreen } from '@/lib/server/screen-guard';
import { ApiWorklist } from './api-worklist';
import { DemoWorklist } from './demo-worklist';

export const metadata: Metadata = { title: 'Worklist klinis' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Worklist klinis. Layar hibrida (`requireScreen`): mode presentasi = rekam fiktif + toko demo (`demo-worklist.tsx`, `?pasien=`); mode api
 * untuk peran berizin layar (`api-worklist.tsx`, data dan aksi dari API; `?kunjungan=<id>`).
 */
export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  const access = await requireScreen('worklist');
  const sp = await searchParams;
  if (access.mode === 'demo') return <DemoWorklist access={access} pasien={sp.pasien} />;
  if (!access.allowed) return <ScreenAccessDenied screen={access.screen} />;
  return <ApiWorklist session={access.session} searchParams={sp} />;
}
