import type { Metadata } from 'next';
import { DemoAccessDenied } from '@/components/demo-access-denied';
import { DowntimeBoard } from '@/components/operasional/downtime-board';
import { ScreenHeader } from '@/components/platform/parts';
import { getDowntimeDrill } from '@/lib/server/data/platform';
import { requireDemoScreen } from '@/lib/server/demo-guard';

export const metadata: Metadata = { title: 'Mode downtime' };

/** P13 · Mode downtime, cetak darurat, entri susulan, dan sinkron edge (tanpa mockup). Mode presentasi (ADR-0023). */
export default async function DowntimePage() {
  const { session, screen, allowed } = await requireDemoScreen('downtime');
  if (!allowed) return <DemoAccessDenied screen={screen} />;
  const d = await getDowntimeDrill();
  return (
    <div className="flex flex-col gap-4">
      <ScreenHeader
        trail="Sistem / Mode downtime · P13 · server edge dan sinkron"
        title="Mode downtime dan sinkron edge"
      />
      <DowntimeBoard forms={d.forms} pack={d.pack} operator={session.user.displayName} />
    </div>
  );
}
