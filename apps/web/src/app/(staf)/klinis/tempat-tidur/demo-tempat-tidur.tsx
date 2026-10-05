import { formatJam } from '@simrs/shared';
import { DemoAccessDenied } from '@/components/demo-access-denied';
import { ScenarioBanner } from '@/components/scenario-banner';
import { SCENARIO_BEDS } from '@/lib/demo/fixtures/rawat-inap';
import { screenById } from '@/lib/screens';
import { getBedBoard } from '@/lib/server/data/klinis/bed';
import { scenarioSteps } from '@/lib/server/data/klinis/shared';
import type { DemoScreenAccess } from '@/lib/server/demo-guard';
import { BedWorkspace } from './bed-workspace';

/**
 * K05 · Manajemen tempat tidur mode presentasi (mockup `BedManagement.dc.html`, data fiktif, ADR-0023; dibekukan,
 * jalur api diisi layar W3 di `page.tsx`).
 */
export async function DemoTempatTidur({
  access,
  bangsal,
}: {
  access: DemoScreenAccess;
  bangsal: string | null;
}) {
  const { session, screen, allowed } = access;
  if (!allowed) return <DemoAccessDenied screen={screen} />;
  const board = await getBedBoard(session);
  const [igd, elektif] = await scenarioSteps(session, [
    ['igd-ranap', 'admisi'],
    ['elektif-btn', 'admisi'],
  ]);
  // Ruang awal: ?bangsal=, lalu ruang kandidat permintaan pasien skenario, lalu Melati.
  const scenarioReq = board.requests.find((r) => r.scenario && r.candidates.length > 0);
  const firstCandidate = scenarioReq?.candidates[0]?.bedCode;
  const scenarioWard = board.beds.find((b) => b.code === firstCandidate)?.wardCode;
  const asked = bangsal ? bangsal.toUpperCase() : '';
  const initialWard = board.wards.some((w) => w.code === asked)
    ? asked
    : asked === 'SEMUA'
      ? 'semua'
      : (scenarioWard ?? 'MELATI');
  const ranap = screenById('ranap');

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-caption text-ink-500">
            Klinis / Rawat inap / Tempat tidur · {session.tenant.name}
          </span>
          <h1 className="m-0 text-h1 font-semibold">Manajemen tempat tidur</h1>
        </div>
        <span className="inline-flex min-h-9 items-center gap-2 rounded-control border border-line bg-white px-3 text-small">
          <span aria-hidden="true" className="size-[7px] rounded-full bg-success" />
          Ketersediaan bed terkirim ke BPJS dan Kemenkes · {formatJam(board.asOf)}
        </span>
      </header>
      <ScenarioBanner session={session} screen="bed" />
      <BedWorkspace
        board={board}
        initialWard={initialWard}
        reserved={SCENARIO_BEDS}
        steps={{ 'igd-ranap': igd, 'elektif-btn': elektif }}
        rev={igd?.rev ?? 0}
        ranapRoute={ranap && ranap.status !== 'belum' ? ranap.route : null}
      />
    </div>
  );
}
