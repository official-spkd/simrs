import type { Metadata } from 'next';
import { ScreenAccessDenied, ScreenNotConnected } from '@/components/screen-gate';
import { requireScreen } from '@/lib/server/screen-guard';
import { DemoJadwal } from './demo-jadwal';

export const metadata: Metadata = { title: 'Jadwal dokter' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * F01 · Jadwal dokter dan kuota (mockup `Jadwal.dc.html`). Layar hibrida (`requireScreen`): mode presentasi memakai
 * data dummy (`demo-jadwal.tsx`); mode api untuk peran ber-izin `schedule.read`, jalur API diisi fase 2 potongan 2.
 */
export default async function JadwalPage({ searchParams }: { searchParams: SearchParams }) {
  const access = await requireScreen('jadwal');
  if (access.mode === 'demo') {
    const sp = await searchParams;
    return <DemoJadwal access={access} pilih={typeof sp.pilih === 'string' ? sp.pilih : null} />;
  }
  if (!access.allowed) return <ScreenAccessDenied screen={access.screen} />;
  return <ScreenNotConnected screen={access.screen} role={access.session.role?.code ?? null} />;
}
