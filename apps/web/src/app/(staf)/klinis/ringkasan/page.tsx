import type { Metadata } from 'next';
import { ScreenAccessDenied } from '@/components/screen-gate';
import { requireScreen } from '@/lib/server/screen-guard';
import { ApiRingkasan } from './api-ringkasan';
import { DemoRingkasan } from './demo-ringkasan';

export const metadata: Metadata = { title: 'Ringkasan pasien' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Ringkasan pasien. Layar hibrida (`requireScreen`): mode presentasi = rekam fiktif + toko demo (`demo-ringkasan.tsx`, `?pasien=`); mode api
 * untuk peran berizin layar (`api-ringkasan.tsx`, data dan aksi dari API; `?kunjungan=<id>`).
 */
export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  const access = await requireScreen('ringkasan');
  const sp = await searchParams;
  if (access.mode === 'demo') return <DemoRingkasan access={access} pasien={sp.pasien} />;
  if (!access.allowed) return <ScreenAccessDenied screen={access.screen} />;
  return <ApiRingkasan session={access.session} searchParams={sp} />;
}
