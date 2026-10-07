import type { Metadata } from 'next';
import { ScreenAccessDenied } from '@/components/screen-gate';
import { requireScreen } from '@/lib/server/screen-guard';
import { ApiTempatTidur } from './api-tempat-tidur';
import { DemoTempatTidur } from './demo-tempat-tidur';

export const metadata: Metadata = { title: 'Tempat tidur' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * K05 · Manajemen tempat tidur (mockup `BedManagement.dc.html`). Layar hibrida (`requireScreen`): mode presentasi
 * memakai data fiktif (`demo-tempat-tidur.tsx`, dibekukan); mode api (layar W3, `api-tempat-tidur.tsx`) untuk peran
 * ber-izin `bed.read`. `?bangsal=<kode>` = ruang yang dibuka.
 */
export default async function TempatTidurPage({ searchParams }: { searchParams: SearchParams }) {
  const access = await requireScreen('bed');
  if (access.mode === 'demo') {
    const sp = await searchParams;
    return <DemoTempatTidur access={access} bangsal={typeof sp.bangsal === 'string' ? sp.bangsal : null} />;
  }
  if (!access.allowed) return <ScreenAccessDenied screen={access.screen} />;
  const sp = await searchParams;
  return (
    <ApiTempatTidur session={access.session} bangsal={typeof sp.bangsal === 'string' ? sp.bangsal : null} />
  );
}
