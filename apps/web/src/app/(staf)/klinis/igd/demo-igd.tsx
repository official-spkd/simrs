import { DemoAccessDenied } from '@/components/demo-access-denied';
import { ScenarioBanner } from '@/components/scenario-banner';
import { patientByScenario } from '@/lib/demo/fixtures/pasien';
import { canTriage } from '@/lib/rawat-inap';
import { screenById } from '@/lib/screens';
import { getIgdView } from '@/lib/server/data/klinis/igd';
import { scenarioSteps } from '@/lib/server/data/klinis/shared';
import type { DemoScreenAccess } from '@/lib/server/demo-guard';
import { IgdWorkspace, WalkInButtons } from './igd-workspace';

/** Rute layar lain bila sudah tersedia di presentasi (tautan tidak mengarah ke layar `belum`). */
function routeOf(id: string): string | null {
  const s = screenById(id);
  return s && s.status !== 'belum' ? s.route : null;
}

/**
 * K03 · IGD mode presentasi: papan pelacakan + triase 5 level + disposisi (mockup `IGD.dc.html`, data fiktif + toko
 * demo `klinis-igd`/`tempat-tidur`, ADR-0023/0085; jalur api diisi layar W3 di `page.tsx`).
 */
export async function DemoIgd({ access, pilih }: { access: DemoScreenAccess; pilih: string | null }) {
  const { session, screen, allowed } = access;
  if (!allowed) return <DemoAccessDenied screen={screen} />;
  const view = await getIgdView(session);
  const board = view.board;
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
          <h1 className="m-0 text-h1 font-bold tracking-[-0.02em]">Instalasi Gawat Darurat</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-small text-ink-500">
            Kapasitas {used} / {board.capacity} bed · {board.ambulancesIncoming} ambulans menuju (SISRUTE)
          </span>
          <WalkInButtons rev={view.rev} />
        </div>
      </header>
      <ScenarioBanner session={session} screen="igd" />
      <IgdWorkspace
        board={board}
        initialSelected={initial}
        kd={kd}
        tr={tr}
        rev={kd?.rev ?? 0}
        igdRev={view.rev}
        stored={view.state.triage}
        dispositions={view.dispositions}
        deaths={view.deaths}
        history={patientByScenario('igd-ranap')?.riwayat ?? ''}
        links={{ bed: routeOf('bed'), ranap: routeOf('ranap') }}
        canTriage={canTriage(session.role?.code)}
        role={session.role?.code ?? null}
        user={session.user.displayName}
      />
    </div>
  );
}
