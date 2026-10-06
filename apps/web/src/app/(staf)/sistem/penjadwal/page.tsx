import type { Metadata } from 'next';
import { DemoAccessDenied } from '@/components/demo-access-denied';
import { ScreenHeader } from '@/components/platform/parts';
import { PenjadwalBoard } from '@/components/platform/penjadwal-board';
import { getScheduledJobs } from '@/lib/server/data/platform';
import { requireDemoScreen } from '@/lib/server/demo-guard';

export const metadata: Metadata = { title: 'Penjadwal pekerjaan' };

/** P11 · Penjadwal pekerjaan berkala (tanpa mockup). Mode presentasi: data fiktif (ADR-0023). */
export default async function PenjadwalPage() {
  const { screen, allowed } = await requireDemoScreen('penjadwal');
  if (!allowed) return <DemoAccessDenied screen={screen} />;
  const jobs = await getScheduledJobs();
  return (
    <div className="flex flex-col gap-4">
      <ScreenHeader trail="Sistem / Penjadwal pekerjaan · P11" title="Penjadwal pekerjaan · job berkala" />
      <PenjadwalBoard initial={jobs} />
    </div>
  );
}
