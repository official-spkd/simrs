import { DemoAccessDenied } from '@/components/demo-access-denied';
import { ScenarioBanner } from '@/components/scenario-banner';
import { patientByScenario } from '@/lib/demo/fixtures/pasien';
import { canTriage } from '@/lib/rawat-inap';
import { screenById } from '@/lib/screens';
import { getEdBoard } from '@/lib/server/data/klinis/igd';
import { scenarioSteps } from '@/lib/server/data/klinis/shared';
import type { DemoScreenAccess } from '@/lib/server/demo-guard';
import { IgdWorkspace, WalkInButtons } from './igd-workspace';

/** Rute layar lain bila sudah tersedia di presentasi (tautan tidak mengarah ke layar `belum`). */
function routeOf(id: string): string | null {
  const s = screenById(id);
  return s && s.status !== 'belum' ? s.route : null;
}

/**
 * K03 · IGD mode presentasi: papan pelacakan + triase 5 level (mockup `IGD.dc.html`, data fiktif, ADR-0023;
 * dibekukan, jalur api diisi layar W3 di `page.tsx`).
 */
export async function DemoIgd({ access, pilih }: { access: DemoScreenAccess; pilih: string | null }) {
  const { session, screen, allowed } = access;
  if (!allowed) return <DemoAccessDenied screen={screen} />;
  const board = await getEdBoard(session);
  const [kd, tr] = await scenarioSteps(session, [
    ['igd-ranap', 'kedatangan'],
    ['igd-ranap', 'triase'],
  ]);
  const scenarioItem = board.items.find((p) => p.scenario);
  const initial =
    board.items.find((p) => p.encounterId === pilih)?.encounterId ??
    scenarioItem?.encounterId ??
    board.items[0]?.encounterId ??
    '';
  const used = board.items.filter((p) => p.bed !== null).length;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-caption text-ink-500">
            Klinis / IGD / Papan pelacakan · {session.tenant.name}
          </span>
          <h1 className="m-0 text-h1 font-semibold">Instalasi Gawat Darurat</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-small text-ink-700">
            Bed terpakai {used} / {board.capacity} · {board.ambulancesIncoming} ambulans menuju (rujukan)
          </span>
          <WalkInButtons />
        </div>
      </header>
      <ScenarioBanner session={session} screen="igd" />
      <IgdWorkspace
        board={board}
        initialSelected={initial}
        kd={kd}
        tr={tr}
        rev={kd?.rev ?? 0}
        history={patientByScenario('igd-ranap')?.riwayat ?? ''}
        links={{ bed: routeOf('bed'), ranap: routeOf('ranap') }}
        canTriage={canTriage(session.role?.code)}
      />
    </div>
  );
}
