import type { Metadata } from 'next';
import { ScreenAccessDenied } from '@/components/screen-gate';
import { requireScreen } from '@/lib/server/screen-guard';
import { ApiKelengkapan } from './api-kelengkapan';
import { DemoKelengkapan } from './demo-kelengkapan';

export const metadata: Metadata = { title: 'Kelengkapan rekam medis' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Kelengkapan rekam medis. Layar hibrida (`requireScreen`): mode presentasi = rekam fiktif + toko demo (`demo-kelengkapan.tsx`, `?pasien=`); mode api
 * untuk peran berizin layar (`api-kelengkapan.tsx`, data dan aksi dari API; `?kunjungan=<id>`).
 */
export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  const access = await requireScreen('kelengkapan');
  const sp = await searchParams;
  if (access.mode === 'demo') return <DemoKelengkapan access={access} pasien={sp.pasien} />;
  if (!access.allowed) return <ScreenAccessDenied screen={access.screen} />;
  return <ApiKelengkapan session={access.session} searchParams={sp} />;
}
