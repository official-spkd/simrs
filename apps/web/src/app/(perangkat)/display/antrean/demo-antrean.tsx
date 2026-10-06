import { queueBoardSchema } from '@simrs/shared';
import { DemoAccessDenied } from '@/components/demo-access-denied';
import { DemoPolling } from '@/components/front-office/demo-polling';
import { ScaleToFit } from '@/components/scale-to-fit';
import { DEMO_NOW, DEMO_TODAY } from '@/lib/demo/fixtures/waktu';
import { dateFull } from '@/lib/front-office';
import { displayOf, frontOfficeStore } from '@/lib/server/data/front-office/toko';
import type { DemoScreenAccess } from '@/lib/server/demo-guard';
import { AntreanClient } from './antrean-client';

/**
 * F04 · Display antrean ruang tunggu mode presentasi (mockup `DisplayAntrean.dc.html`, kanvas TV 1920×1080, data
 * dummy fiktif, ADR-0023) di atas toko demo bersama (ADR-0085): tiket anjungan, panggilan loket, kunjungan baru, dan
 * panggilan poli dari layar mana pun tampil tanpa muat ulang (polling ringan 3 detik). Jalur api (SSE lewat BFF, sesi
 * perangkat) diisi potongan 4b di `page.tsx` dan tidak membaca toko.
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
  const d = displayOf(await frontOfficeStore(session));
  return (
    <>
      <DemoPolling intervalMs={3000} />
      <ScaleToFit width={1920} height={1080} label="Display antrean ruang tunggu">
        <AntreanClient
          tenantName={session.tenant.name}
          nowIso={DEMO_NOW}
          dateLabel={dateFull(DEMO_TODAY)}
          board={queueBoardSchema.parse(d.board)}
          calling={d.calling}
          history={d.history}
          loket={d.loket}
        />
      </ScaleToFit>
    </>
  );
}
