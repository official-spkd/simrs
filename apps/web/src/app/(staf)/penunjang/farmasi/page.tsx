import { IncomingOrders } from '@/components/penunjang/incoming-orders';
import type { Metadata } from 'next';
import { z } from 'zod';
import { DemoAccessDenied } from '@/components/demo-access-denied';
import { FarmasiWorkspace } from '@/components/penunjang/farmasi-workspace';
import { ScenarioBanner } from '@/components/scenario-banner';
import { getPharmacyQueue, penunjangScenario } from '@/lib/server/data/penunjang';
import { requireDemoScreen } from '@/lib/server/demo-guard';

export const metadata: Metadata = { title: 'Farmasi' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * S04/S05 · Farmasi: telaah resep dengan CDS (interaksi, dosis ginjal), penyiapan dengan cek ganda high alert,
 * serah terima yang mengurangi stok depo (mockup `Farmasi.dc.html`). Mode presentasi: data dummy (ADR-0023).
 */
export default async function FarmasiPage({ searchParams }: { searchParams: SearchParams }) {
  const { session, screen, allowed } = await requireDemoScreen('farmasi');
  if (!allowed) return <DemoAccessDenied screen={screen} />;
  const sp = await searchParams;
  const tab = z.enum(['telaah', 'siap', 'serah']).catch('telaah').parse(sp.tab);
  const { results, hook } = await penunjangScenario(session, 'farmasi');
  const data = await getPharmacyQueue(results);

  return (
    <div className="flex flex-col gap-4">
      <IncomingOrders orders={data.incoming} destination="farmasi" />
      <FarmasiWorkspace
        role={session.role?.code ?? null}
        heading={
          <div className="flex flex-col gap-0.5">
            <span className="text-caption text-ink-500">
              Penunjang / Farmasi / Telaah resep · {session.tenant.name}
            </span>
            <h1 className="m-0 text-h1 font-bold tracking-[-0.02em]">Farmasi · verifikasi dan penyiapan</h1>
          </div>
        }
        banner={<ScenarioBanner session={session} screen="farmasi" />}
        data={data}
        hook={hook}
        userName={session.user.displayName}
        initialTab={tab}
        initialSelected={typeof sp.pilih === 'string' ? sp.pilih : null}
      />
    </div>
  );
}
