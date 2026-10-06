import { formatJam } from '@simrs/shared';
import { DemoAccessDenied } from '@/components/demo-access-denied';
import { ScenarioBanner } from '@/components/scenario-banner';
import { SCENARIO_BEDS } from '@/lib/demo/fixtures/rawat-inap';
import { screenById } from '@/lib/screens';
import { getBedBoard } from '@/lib/server/data/klinis/bed';
import { readDomain } from '@/lib/server/demo/state';
import { scenarioSteps } from '@/lib/server/data/klinis/shared';
import type { DemoScreenAccess } from '@/lib/server/demo-guard';
import { BedWorkspace } from './bed-workspace';

/**
 * K05 · Manajemen tempat tidur mode presentasi (mockup `BedManagement.dc.html`, data fiktif + toko demo
 * `tempat-tidur`, ADR-0023/0085; jalur api diisi layar W3 di `page.tsx`).
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
  const [board, bedStore] = await Promise.all([getBedBoard(session), readDomain('tempat-tidur')]);
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
      <BedWorkspace
        heading={
          <div className="flex flex-col gap-0.5">
            <span className="text-caption text-ink-500">
              Klinis / Rawat inap / Tempat tidur · {session.tenant.name}
            </span>
            <h1 className="m-0 text-h1 font-semibold">Manajemen tempat tidur</h1>
          </div>
        }
        syncNote={`Aplicare & SIRANAP diperbarui ${formatJam(board.asOf)}`}
        banner={<ScenarioBanner session={session} screen="bed" />}
        board={board}
        initialWard={initialWard}
        reserved={SCENARIO_BEDS}
        steps={{ 'igd-ranap': igd, 'elektif-btn': elektif }}
        rev={igd?.rev ?? 0}
        bedRev={bedStore.rev}
        ranapRoute={ranap && ranap.status !== 'belum' ? ranap.route : null}
      />
    </div>
  );
}
