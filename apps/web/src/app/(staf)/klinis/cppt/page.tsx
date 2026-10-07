import type { Metadata } from 'next';
import { ScreenAccessDenied } from '@/components/screen-gate';
import { requireScreen } from '@/lib/server/screen-guard';
import { ApiCppt } from './api-cppt';
import { DemoCppt } from './demo-cppt';

export const metadata: Metadata = { title: 'CPPT & serah terima' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * CPPT & serah terima. Layar hibrida (`requireScreen`): mode presentasi = rekam fiktif + toko demo (`demo-cppt.tsx`, `?pasien=`); mode api
 * untuk peran berizin layar (`api-cppt.tsx`, data dan aksi dari API; `?kunjungan=<id>`).
 */
export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  const access = await requireScreen('cppt');
  const sp = await searchParams;
  if (access.mode === 'demo') return <DemoCppt access={access} pasien={sp.pasien} />;
  if (!access.allowed) return <ScreenAccessDenied screen={access.screen} />;
  return <ApiCppt session={access.session} searchParams={sp} />;
}
