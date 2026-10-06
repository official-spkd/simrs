import type { Metadata } from 'next';
import { DemoAccessDenied } from '@/components/demo-access-denied';
import { ScreenHeader } from '@/components/platform/parts';
import { RujukanBoard } from '@/components/rujukan/rujukan-board';
import { getReferralsOverview } from '@/lib/server/data/platform';
import { requireDemoScreen } from '@/lib/server/demo-guard';

export const metadata: Metadata = { title: 'Rujukan' };

/** F07 · Rujukan, surat kontrol, dan SPRI dengan status kirim BPJS (tanpa mockup). Mode presentasi (ADR-0023). */
export default async function RujukanPage() {
  const { screen, allowed } = await requireDemoScreen('rujukan');
  if (!allowed) return <DemoAccessDenied screen={screen} />;
  const d = await getReferralsOverview();
  return (
    <div className="flex flex-col gap-4">
      <ScreenHeader
        trail="Front office / Rujukan · F07 · BPJS VClaim lewat antrean kirim"
        title="Rujukan, surat kontrol, dan SPRI"
      />
      <RujukanBoard initial={d.referrals} planDates={d.planDates} />
    </div>
  );
}
