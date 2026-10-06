import { DemoAccessDenied } from '@/components/demo-access-denied';
import { DowntimeBanner } from '@/components/operasional/downtime-banner';
import { ScenarioBanner } from '@/components/scenario-banner';
import { DEMO_VCLAIM_LATENCY_MS, SCENARIO_RJ } from '@/lib/demo/fixtures/front-office';
import { DEMO_TODAY } from '@/lib/demo/fixtures/waktu';
import { simClock, taskDoneAt } from '@/lib/front-office';
import {
  getDemoDeskPatients,
  getRegistrationDesk,
  getScenarioRegistrationPatient,
} from '@/lib/server/data/front-office/pendaftaran';
import { frontOfficeStore, loketOf } from '@/lib/server/data/front-office/toko';
import {
  activeStepId,
  milestone,
  scenarioRuns,
  scenariosHere,
  stepReached,
} from '@/lib/server/demo/scenario-context';
import type { DemoScreenAccess } from '@/lib/server/demo-guard';
import { PendaftaranClient, type RegStoreView } from './pendaftaran-client';
import type { RegScenarioView, RegStored } from './use-registration';

/**
 * F03/F06 · Pendaftaran rawat jalan + SEP mode presentasi (mockup `Registrasi.dc.html`, data dummy fiktif, ADR-0023)
 * dengan proyeksi skenario rawat jalan dan toko demo bersama (ADR-0085: SEP, kunjungan, cetak, antrean loket). Jalur
 * api diisi potongan 5b di `page.tsx` dan tidak membaca toko.
 */
export async function DemoPendaftaran({ access }: { access: DemoScreenAccess }) {
  const { session, screen, allowed } = access;
  if (!allowed) return <DemoAccessDenied screen={screen} />;
  const [desk, deskPatients, suryo, runs, fo] = await Promise.all([
    getRegistrationDesk(session),
    getDemoDeskPatients(),
    getScenarioRegistrationPatient(),
    scenarioRuns(session),
    frontOfficeStore(session),
  ]);
  const loket = loketOf(fo);
  const reg = fo.registration.state;
  const stored: Record<string, RegStored> = {};
  for (const p of deskPatients) {
    const sep = reg.seps[p.id];
    const v = reg.visits.find((x) => x.patientId === p.id);
    if (!sep && !v) continue;
    stored[p.id] = {
      sep: sep
        ? { sepNo: sep.sepNo, referralId: sep.referralId, diagnosis: sep.diagnosis, jam: sep.jam }
        : null,
      visit: v
        ? {
            queueNo: v.queueNo,
            jam: v.jam,
            payer: v.payer,
            poliCode: v.poliCode,
            doctorId: v.doctorId,
            doctorName: v.doctorName,
            printedAt: v.printedAt,
          }
        : null,
    };
  }
  const current = loket.current;
  const counterPatientId =
    current?.patientId && deskPatients.some((p) => p.id === current.patientId) ? current.patientId : null;
  const store: RegStoreView = {
    regRev: fo.registration.rev,
    queueRev: fo.queue.rev,
    stored,
    loket: {
      next: loket.next,
      waiting: loket.waiting,
      current: current
        ? { ticketNo: current.ticketNo, patientId: current.patientId, jam: current.jam }
        : null,
    },
    counterPatientId,
    assist: fo.queue.state.assist
      ? { device: fo.queue.state.assist.device, jam: fo.queue.state.assist.jam }
      : null,
  };
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
      <DowntimeBanner />
      <PendaftaranClient
        key={
          scenario.atCounter ? 'skenario' : counterPatientId ? `loket-${current?.ticketNo ?? ''}` : 'lokal'
        }
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
        store={store}
      />
    </div>
  );
}
