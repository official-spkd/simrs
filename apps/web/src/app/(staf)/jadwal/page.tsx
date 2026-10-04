import type { Metadata } from 'next';
import { DemoAccessDenied } from '@/components/demo-access-denied';
import { getWeeklySchedule } from '@/lib/server/data/front-office/jadwal';
import { requireDemoScreen } from '@/lib/server/demo-guard';
import { JadwalClient } from './jadwal-client';

export const metadata: Metadata = { title: 'Jadwal dokter' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** F01 · Jadwal dokter dan kuota (mockup `Jadwal.dc.html`). Mode presentasi: data dummy fiktif (ADR-0023). */
export default async function JadwalPage({ searchParams }: { searchParams: SearchParams }) {
  const { session, screen, allowed } = await requireDemoScreen('jadwal');
  if (!allowed) return <DemoAccessDenied screen={screen} />;
  const sp = await searchParams;
  const schedule = await getWeeklySchedule(session);
  const pilih = typeof sp.pilih === 'string' ? sp.pilih : null;
  return <JadwalClient schedule={schedule} initialSlot={pilih} />;
}
