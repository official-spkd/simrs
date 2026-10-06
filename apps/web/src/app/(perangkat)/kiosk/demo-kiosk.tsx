import { DemoAccessDenied } from '@/components/demo-access-denied';
import { KioskPresenterHint, type KioskScenarioView } from '@/components/front-office/kiosk-hint';
import { ScaleToFit } from '@/components/scale-to-fit';
import { SCENARIO_RJ } from '@/lib/demo/fixtures/front-office';
import { DEMO_NOW, DEMO_TODAY } from '@/lib/demo/fixtures/waktu';
import { dateFull } from '@/lib/front-office';
import { getKioskDefaultPatient } from '@/lib/server/data/front-office/kiosk';
import {
  getRegistrationDesk,
  getScenarioRegistrationPatient,
} from '@/lib/server/data/front-office/pendaftaran';
import { frontOfficeStore, nextKioskTicket } from '@/lib/server/data/front-office/toko';
import { milestone, milestoneValue, scenarioRuns, scenariosHere } from '@/lib/server/demo/scenario-context';
import type { DemoScreenAccess } from '@/lib/server/demo-guard';
import { KioskClient } from './kiosk-client';

/**
 * F05 · Anjungan pendaftaran mandiri mode presentasi (mockup `Anjungan.dc.html`, kanvas potret 1080×1920, data dummy
 * fiktif, ADR-0023): tiket dan permintaan bantuan tersimpan di toko demo bersama (ADR-0085, domain `antrean`). Jalur
 * api diisi potongan 6 di `page.tsx` dan tidak membaca toko.
 */
export async function DemoKiosk({ access }: { access: DemoScreenAccess }) {
  const { session, screen, allowed } = access;
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
  const [local, suryo, desk, fo] = await Promise.all([
    getKioskDefaultPatient(),
    getScenarioRegistrationPatient(),
    getRegistrationDesk(session),
    frontOfficeStore(session),
  ]);
  const loketNo = nextKioskTicket(fo, 'loket');
  const tickets = {
    bpjs: { no: loketNo, waitMin: 14 },
    umum: { no: loketNo, waitMin: 26 },
    farmasi: { no: nextKioskTicket(fo, 'farmasi'), waitMin: 9 },
    skenario: { no: SCENARIO_RJ.ticket, waitMin: 12 },
  };
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
          tickets={tickets}
          bookingCode={SCENARIO_RJ.bookingCode}
          scenario={scenario}
          assistAt={fo.queue.state.assist?.jam ?? null}
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
