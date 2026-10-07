import type { Metadata } from 'next';
import { ScreenAccessDenied } from '@/components/screen-gate';
import { requireScreen } from '@/lib/server/screen-guard';
import { ApiAskep } from './api-asuhan-keperawatan';
import { DemoAskep } from './demo-asuhan-keperawatan';

export const metadata: Metadata = { title: 'Asuhan keperawatan' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Asuhan keperawatan. Layar hibrida (`requireScreen`): mode presentasi = rekam fiktif + toko demo (`demo-asuhan-keperawatan.tsx`, `?pasien=`); mode api
 * untuk peran berizin layar (`api-asuhan-keperawatan.tsx`, data dan aksi dari API; `?kunjungan=<id>`).
 */
export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  const access = await requireScreen('askep');
  const sp = await searchParams;
  if (access.mode === 'demo') return <DemoAskep access={access} pasien={sp.pasien} />;
  if (!access.allowed) return <ScreenAccessDenied screen={access.screen} />;
  return <ApiAskep session={access.session} searchParams={sp} />;
}
