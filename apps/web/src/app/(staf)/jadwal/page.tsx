import type { Metadata } from 'next';
import { ScreenAccessDenied } from '@/components/screen-gate';
import { requireScreen } from '@/lib/server/screen-guard';
import { ApiJadwal } from './api-jadwal';
import { DemoJadwal } from './demo-jadwal';

export const metadata: Metadata = { title: 'Jadwal dokter' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * F01 · Jadwal dokter dan kuota (mockup `Jadwal.dc.html`). Layar hibrida (`requireScreen`): mode presentasi memakai
 * data dummy (`demo-jadwal.tsx`, dibekukan); mode api untuk peran ber-izin `schedule.read` (`api-jadwal.tsx`).
 */
export default async function JadwalPage({ searchParams }: { searchParams: SearchParams }) {
  const access = await requireScreen('jadwal');
  const sp = await searchParams;
  const pilih = typeof sp.pilih === 'string' ? sp.pilih : null;
  if (access.mode === 'demo') return <DemoJadwal access={access} pilih={pilih} />;
  if (!access.allowed) return <ScreenAccessDenied screen={access.screen} />;
  return (
    <ApiJadwal
      session={access.session}
      minggu={typeof sp.minggu === 'string' ? sp.minggu : null}
      pilih={pilih}
    />
  );
}
