import type { Metadata } from 'next';
import { DemoAccessDenied } from '@/components/demo-access-denied';
import { CadanganBoard } from '@/components/operasional/cadangan-board';
import { ScreenHeader } from '@/components/platform/parts';
import { getBackupOverview } from '@/lib/server/data/platform';
import { requireDemoScreen } from '@/lib/server/demo-guard';

export const metadata: Metadata = { title: 'Cadangan & pemulihan' };

/** Fase 10 · Cadangan tiga lokasi, retensi, dan uji restore (ADR-0071; tanpa mockup). Mode presentasi (ADR-0023). */
export default async function CadanganPage() {
  const { screen, allowed } = await requireDemoScreen('cadangan');
  if (!allowed) return <DemoAccessDenied screen={screen} />;
  const d = await getBackupOverview();
  return (
    <div className="flex flex-col gap-4">
      <ScreenHeader trail="Sistem / Cadangan & pemulihan · ADR-0071" title="Cadangan dan pemulihan" />
      <CadanganBoard locations={d.locations} runs={d.runs} lastTest={d.lastTest} manifest={d.manifest} />
    </div>
  );
}
