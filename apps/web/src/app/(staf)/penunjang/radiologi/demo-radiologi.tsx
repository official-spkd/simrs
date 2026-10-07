import { IncomingOrders } from '@/components/penunjang/incoming-orders';
import { DemoAccessDenied } from '@/components/demo-access-denied';
import { RadWorkspace } from '@/components/penunjang/rad-workspace';
import { ScenarioBanner } from '@/components/scenario-banner';
import { getRadiologyWorklist } from '@/lib/server/data/penunjang/radiologi';
import { penunjangScenario } from '@/lib/server/data/penunjang/shared';
import type { DemoScreenAccess } from '@/lib/server/demo-guard';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * S03 · Radiologi (tanpa mockup; gaya mengikuti Lab): papan modalitas dengan slot hari ini, worklist pemeriksaan
 * (terjadwal → berlangsung → ekspertise → ditandatangani), dosis CT, templat ekspertise, dan TTE radiolog.
 * Mode presentasi: data dummy fiktif (ADR-0023); dibekukan, jalur api di `page.tsx`.
 */
export async function DemoRadiologi({
  access,
  searchParams,
}: {
  access: DemoScreenAccess;
  searchParams: SearchParams;
}) {
  const { session, screen, allowed } = access;
  if (!allowed) return <DemoAccessDenied screen={screen} />;
  const sp = await searchParams;
  const { results } = await penunjangScenario(session, 'rad');
  const data = await getRadiologyWorklist(results);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-caption text-ink-500">
            Penunjang / Radiologi / Worklist · {session.tenant.name}
          </span>
          <h1 className="m-0 text-h1 font-bold tracking-[-0.02em]">Radiologi · pemeriksaan dan ekspertise</h1>
        </div>
        <ul aria-label="Koneksi sistem citra" className="m-0 flex list-none flex-wrap gap-2 p-0">
          <li className="rounded-full bg-zamrud-100 px-2.5 py-1.5 text-small font-semibold text-zamrud-700">
            <span aria-hidden="true">● </span>PACS terhubung (DICOM)
          </li>
          <li className="rounded-full bg-zamrud-100 px-2.5 py-1.5 text-small font-semibold text-zamrud-700">
            <span aria-hidden="true">● </span>Worklist modalitas (DICOM MWL) aktif
          </li>
        </ul>
      </header>
      <ScenarioBanner session={session} screen="rad" />
      <IncomingOrders orders={data.incoming} destination="radiologi" />
      <RadWorkspace
        role={session.role?.code ?? null}
        data={data}
        initialSelected={typeof sp.pilih === 'string' ? sp.pilih : null}
      />
    </div>
  );
}
