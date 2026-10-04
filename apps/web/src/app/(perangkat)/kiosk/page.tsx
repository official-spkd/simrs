import type { Metadata } from 'next';
import { DemoAccessDenied } from '@/components/demo-access-denied';
import { KioskPresenterHint, type KioskScenarioView } from '@/components/front-office/kiosk-hint';
import { ScaleToFit } from '@/components/scale-to-fit';
import { kioskTickets, LOCAL_SEP, SCENARIO_RJ } from '@/lib/demo/fixtures/front-office';
import { DEMO_NOW, DEMO_TODAY } from '@/lib/demo/fixtures/waktu';
import { dateFull, frontOfficeProgress } from '@/lib/front-office';
import {
  getKioskDefaultPatient,
  getRegistrationDesk,
  getScenarioRegistrationPatient,
} from '@/lib/server/data/front-office';
import { milestone, milestoneValue, scenarioRuns, scenariosHere } from '@/lib/server/demo/scenario-context';
import { requireDemoScreen } from '@/lib/server/demo-guard';
import { KioskClient } from './kiosk-client';

export const metadata: Metadata = { title: 'Anjungan mandiri' };

/** F05 · Anjungan pendaftaran mandiri (mockup `Anjungan.dc.html`), kanvas potret 1080×1920. Mode presentasi. */
export default async function KioskPage() {
  const { session, screen, allowed } = await requireDemoScreen('kiosk');
  if (!allowed) {
    return (
      <div className="p-6 pt-16">
        <DemoAccessDenied screen={screen} />
      </div>
    );
  }
  const runs = await scenarioRuns(session);
  const rj = runs.results['rawat-jalan'];
  const here = scenariosHere(runs, 'kiosk').find((h) => h.scenario === 'rawat-jalan') ?? null;
  const [local, suryo, desk] = await Promise.all([
    getKioskDefaultPatient(),
    getScenarioRegistrationPatient(),
    getRegistrationDesk(session),
  ]);
  const bio = milestoneValue(rj, 'kedatangan', 'bio');
  const scenario: KioskScenarioView = {
    rev: runs.rev,
    step: here ? here.step.index : null,
    label: rj.def.label,
    patientName: rj.rec.nama,
    tasks: (here?.step.tasks ?? []).map((t) => ({
      id: t.id,
      label: t.label,
      done: t.status === 'selesai',
      enabled: t.enabled,
    })),
    bioValue: typeof bio === 'string' ? bio : null,
    canNext: here?.step.canNext ?? false,
    nextLabel: here?.step.nextLabel ?? '',
    ticketDone: milestone(rj, 'kedatangan', 'tiket'),
  };
  const andini = desk.quotas.find((q) => q.doctorId === SCENARIO_RJ.doctorId);
  return (
    <>
      <ScaleToFit width={1080} height={1920} label="Anjungan pendaftaran mandiri">
        <KioskClient
          tenantName={session.tenant.name}
          nowIso={DEMO_NOW}
          dateLabel={dateFull(DEMO_TODAY)}
          local={local}
          scenarioPatient={suryo}
          doctor={{
            name: andini?.doctorName ?? '',
            time: andini ? `${andini.start}–${andini.end}` : '',
          }}
          localSep={LOCAL_SEP}
          tickets={kioskTickets(frontOfficeProgress(rj))}
          bookingCode={SCENARIO_RJ.bookingCode}
          scenario={scenario}
        />
      </ScaleToFit>
      {(here || (scenario.ticketDone && !milestone(rj, 'pendaftaran', 'panggil'))) && (
        <KioskPresenterHint
          scenario={scenario}
          bookingCode={SCENARIO_RJ.bookingCode}
          ticketNo={SCENARIO_RJ.ticket}
        />
      )}
    </>
  );
}
