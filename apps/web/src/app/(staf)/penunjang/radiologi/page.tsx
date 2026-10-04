import type { Metadata } from 'next';
import { DemoAccessDenied } from '@/components/demo-access-denied';
import { RadWorkspace } from '@/components/penunjang/rad-workspace';
import { ScenarioBanner } from '@/components/scenario-banner';
import { getRadiologyWorklist, penunjangScenario } from '@/lib/server/data/penunjang';
import { requireDemoScreen } from '@/lib/server/demo-guard';

export const metadata: Metadata = { title: 'Radiologi' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * S03 · Radiologi (tanpa mockup; gaya mengikuti Lab): papan modalitas dengan slot hari ini, worklist pemeriksaan
 * (terjadwal → berlangsung → ekspertise → ditandatangani), dosis CT, templat ekspertise, dan TTE radiolog.
 * Mode presentasi: data dummy fiktif (ADR-0023).
 */
export default async function RadiologiPage({ searchParams }: { searchParams: SearchParams }) {
  const { session, screen, allowed } = await requireDemoScreen('rad');
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
          <h1 className="m-0 text-h1 font-semibold">Radiologi · pemeriksaan dan ekspertise</h1>
        </div>
        <ul aria-label="Koneksi sistem citra" className="m-0 flex list-none flex-wrap gap-2 p-0">
          <li className="rounded-full bg-success-bg px-2.5 py-1.5 text-small font-medium text-success">
            <span aria-hidden="true">● </span>PACS terhubung (DICOM)
          </li>
          <li className="rounded-full bg-success-bg px-2.5 py-1.5 text-small font-medium text-success">
            <span aria-hidden="true">● </span>Worklist modalitas (DICOM MWL) aktif
          </li>
        </ul>
      </header>
      <ScenarioBanner session={session} screen="rad" />
      <RadWorkspace data={data} initialSelected={typeof sp.pilih === 'string' ? sp.pilih : null} />
    </div>
  );
}
