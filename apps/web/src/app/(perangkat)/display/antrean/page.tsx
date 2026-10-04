import type { Metadata } from 'next';
import { DemoAccessDenied } from '@/components/demo-access-denied';
import { ScaleToFit } from '@/components/scale-to-fit';
import { DEMO_NOW, DEMO_TODAY } from '@/lib/demo/fixtures/waktu';
import { dateFull } from '@/lib/front-office';
import { getQueueBoard } from '@/lib/server/data/front-office/antrean';
import { requireDemoScreen } from '@/lib/server/demo-guard';
import { AntreanClient } from './antrean-client';

export const metadata: Metadata = { title: 'Display antrean' };

/** F04 · Display antrean ruang tunggu (mockup `DisplayAntrean.dc.html`), kanvas TV 1920×1080. Mode presentasi. */
export default async function DisplayAntreanPage() {
  const { session, screen, allowed } = await requireDemoScreen('antrean');
  if (!allowed) {
    return (
      <div className="p-6 pt-16">
        <DemoAccessDenied screen={screen} />
      </div>
    );
  }
  const board = await getQueueBoard(session);
  // Papan dimulai ulang bila data berubah (mis. SEP Tn. Suryo terbit atau DPJP memanggil PD-027 di tab lain).
  const version = [
    board.calling.queueNo,
    ...board.clinics.map((c) => `${c.current}:${c.waiting.join(',')}`),
  ].join('|');
  return (
    <ScaleToFit width={1920} height={1080} label="Display antrean ruang tunggu">
      <AntreanClient
        key={version}
        tenantName={session.tenant.name}
        nowIso={DEMO_NOW}
        dateLabel={dateFull(DEMO_TODAY)}
        board={board}
      />
    </ScaleToFit>
  );
}
