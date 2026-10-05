import { DemoAccessDenied } from '@/components/demo-access-denied';
import { ScenarioBanner } from '@/components/scenario-banner';
import { DEMO_VCLAIM_LATENCY_MS, SCENARIO_RJ } from '@/lib/demo/fixtures/front-office';
import { DEMO_TODAY } from '@/lib/demo/fixtures/waktu';
import { simClock, taskDoneAt } from '@/lib/front-office';
import {
  getDemoDeskPatients,
  getRegistrationDesk,
  getScenarioRegistrationPatient,
} from '@/lib/server/data/front-office/pendaftaran';
import {
  activeStepId,
  milestone,
  scenarioRuns,
  scenariosHere,
  stepReached,
} from '@/lib/server/demo/scenario-context';
import type { DemoScreenAccess } from '@/lib/server/demo-guard';
import { PendaftaranClient } from './pendaftaran-client';
import type { RegScenarioView } from './use-registration';

/**
 * F03/F06 · Pendaftaran rawat jalan + SEP mode presentasi (mockup `Registrasi.dc.html`, data dummy fiktif, ADR-0023)
 * dengan proyeksi skenario rawat jalan. Jalur demo dibekukan dan tetap diuji E2E demo (keputusan fase 2 #4); jalur api
 * diisi potongan 5b di `page.tsx`.
 */
export async function DemoPendaftaran({ access }: { access: DemoScreenAccess }) {
  const { session, screen, allowed } = access;
  if (!allowed) return <DemoAccessDenied screen={screen} />;
  const [desk, deskPatients, suryo, runs] = await Promise.all([
    getRegistrationDesk(session),
    getDemoDeskPatients(),
    getScenarioRegistrationPatient(),
    scenarioRuns(session),
  ]);
  const rj = runs.results['rawat-jalan'];
  const here = scenariosHere(runs, 'daftar').find((h) => h.scenario === 'rawat-jalan');
  const enabled = (id: string) => here?.step.tasks.some((t) => t.id === id && t.enabled) ?? false;
  const arrival = activeStepId(rj) === 'kedatangan';
  const scenario: RegScenarioView = {
    rev: runs.rev,
    stepIndex: here ? here.step.index : null,
    arrivalPending: arrival && milestone(rj, 'kedatangan', 'tiket'),
    callable: milestone(rj, 'kedatangan', 'tiket') && !milestone(rj, 'pendaftaran', 'panggil'),
    atCounter: milestone(rj, 'pendaftaran', 'panggil') && !stepReached(rj, 'asesmen-perawat'),
    checked: milestone(rj, 'pendaftaran', 'cek'),
    sepIssued: milestone(rj, 'pendaftaran', 'sep'),
    sepAt: taskDoneAt(rj, 'pendaftaran', 'sep'),
    clock: simClock(rj.clock),
    enabled: { panggil: enabled('panggil'), cek: enabled('cek'), sep: enabled('sep') },
  };
  return (
    <div className="flex flex-col gap-4">
      <ScenarioBanner session={session} screen="daftar" />
      <PendaftaranClient
        key={scenario.atCounter ? 'skenario' : 'lokal'}
        desk={desk}
        deskPatients={deskPatients}
        vclaimLatencyMs={DEMO_VCLAIM_LATENCY_MS}
        scenarioPatient={suryo}
        scenario={scenario}
        fixed={{
          ticket: SCENARIO_RJ.ticket,
          sep: SCENARIO_RJ.sep,
          queueNo: SCENARIO_RJ.poliQueue,
          diagnosis: SCENARIO_RJ.diagnosis,
          patientId: SCENARIO_RJ.patientId,
        }}
        today={DEMO_TODAY}
      />
    </div>
  );
}
