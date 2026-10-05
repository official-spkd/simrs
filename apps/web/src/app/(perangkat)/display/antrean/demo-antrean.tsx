import { DemoAccessDenied } from '@/components/demo-access-denied';
import { ScaleToFit } from '@/components/scale-to-fit';
import { DEMO_NOW, DEMO_TODAY } from '@/lib/demo/fixtures/waktu';
import { dateFull } from '@/lib/front-office';
import { getQueueBoard } from '@/lib/server/data/front-office/antrean';
import type { DemoScreenAccess } from '@/lib/server/demo-guard';
import { AntreanClient } from './antrean-client';

/**
 * F04 · Display antrean ruang tunggu mode presentasi (mockup `DisplayAntrean.dc.html`, kanvas TV 1920×1080, data
 * dummy fiktif, ADR-0023). Jalur demo dibekukan dan tetap diuji E2E demo (keputusan fase 2 #4); jalur api (SSE lewat
 * BFF, sesi perangkat) diisi potongan 4b di `page.tsx`.
 */
export async function DemoAntrean({ access }: { access: DemoScreenAccess }) {
  const { session, screen, allowed } = access;
  if (!allowed) {
    return (
      <div className="p-6 pt-16">
        <DemoAccessDenied screen={screen} />
      </div>
    );
  }
  const loaded = await getQueueBoard(session);
  const { calling } = loaded;
  // Fixture demo selalu punya panggilan berjalan; kontrak API mengizinkan null (belum ada panggilan hari ini).
  if (!calling) throw new Error('Papan demo tanpa panggilan berjalan');
  const board = { ...loaded, calling };
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
