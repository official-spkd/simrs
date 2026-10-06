import type { Metadata } from 'next';
import { DemoAccessDenied } from '@/components/demo-access-denied';
import { CadanganBoard } from '@/components/operasional/cadangan-board';
import { ScreenHeader } from '@/components/platform/parts';
import { getBackupOverview } from '@/lib/server/data/platform';
import { requireDemoScreen } from '@/lib/server/demo-guard';

export const metadata: Metadata = { title: 'Cadangan & pemulihan' };

/**
 * Fase 10 · Cadangan tiga lokasi, retensi, dan uji restore (ADR-0071; tanpa mockup). Mode presentasi (ADR-0023);
 * backup manual dan uji restore tersimpan di toko demo bersama (domain `cadangan`, ADR-0085).
 */
export default async function CadanganPage() {
  const { screen, allowed } = await requireDemoScreen('cadangan');
  if (!allowed) return <DemoAccessDenied screen={screen} />;
  const d = await getBackupOverview();
  return (
    <div className="flex flex-col gap-4">
      <ScreenHeader trail="Sistem / Cadangan & pemulihan · ADR-0071" title="Cadangan dan pemulihan" />
      <CadanganBoard state={d.store.state} rev={d.store.rev} manifest={d.manifest} />
    </div>
  );
}
