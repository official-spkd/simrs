import type { Metadata } from 'next';
import { ScreenAccessDenied } from '@/components/screen-gate';
import { requireScreen } from '@/lib/server/screen-guard';
import { ApiAsesmen } from './api-asesmen';
import { DemoAsesmen } from './demo-asesmen';

export const metadata: Metadata = { title: 'Asesmen & skrining' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Asesmen & skrining. Layar hibrida (`requireScreen`): mode presentasi = rekam fiktif + toko demo (`demo-asesmen.tsx`, `?pasien=`); mode api
 * untuk peran berizin layar (`api-asesmen.tsx`, data dan aksi dari API; `?kunjungan=<id>`).
 */
export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  const access = await requireScreen('asesmen');
  const sp = await searchParams;
  if (access.mode === 'demo') return <DemoAsesmen access={access} pasien={sp.pasien} />;
  if (!access.allowed) return <ScreenAccessDenied screen={access.screen} />;
  return <ApiAsesmen session={access.session} searchParams={sp} />;
}
