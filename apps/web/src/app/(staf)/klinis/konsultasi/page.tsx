import type { Metadata } from 'next';
import { RmeChartHeader } from '@/components/rme/chart-header';
import { KonsulWorkspace } from '@/components/rme/konsul-workspace';
import { DemoAccessDenied } from '@/components/demo-access-denied';
import { ENCOUNTER_ID } from '@/lib/demo/fixtures/ids';
import { patientById } from '@/lib/demo/fixtures/pasien';
import { careTeam, CONSULTANTS, CONSULTS } from '@/lib/demo/fixtures/rme-konsul';
import { DEMO_NOW } from '@/lib/demo/fixtures/waktu';
import { consultsOf, teamOf } from '@/lib/rme-konsul-toko';
import { requireDemoScreen } from '@/lib/server/demo-guard';
import { rmeChart } from '@/lib/server/data/klinis/rme';

export const metadata: Metadata = { title: 'Konsultasi & rawat bersama' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * K10 · Konsultasi antar-DPJP dan rawat bersama (`?pasien=`, bawaan Tn. Sutan dengan konsul PD cito): kotak masuk,
 * kirim, jawaban terstruktur, rawat bersama/alih rawat, tim perawatan. Mode presentasi (ADR-0023): konsul rekam
 * awal + toko demo `rekam-medis` (ADR-0085); backend konsul menyusul (rencana fase 3 · 3.8).
 */
export default async function KonsultasiPage({ searchParams }: { searchParams: SearchParams }) {
  const { session, screen, allowed } = await requireDemoScreen('konsul');
  if (!allowed) return <DemoAccessDenied screen={screen} />;
  const { chart, state, rev } = await rmeChart((await searchParams).pasien, ENCOUNTER_ID.sutan);
  const role = session.role?.code ?? null;
  const consults = consultsOf(CONSULTS, state);
  const names = Object.fromEntries(consults.map((c) => [c.patientId, patientById(c.patientId)?.nama ?? '']));

  return (
    <div className="flex flex-col gap-4">
      <RmeChartHeader
        chart={chart}
        screenId="konsul"
        title="Konsultasi & rawat bersama"
        tenantName={session.tenant.name}
        role={role}
        asOf={DEMO_NOW}
      />
      <KonsulWorkspace
        key={chart.encounterId}
        encounterId={chart.encounterId}
        patientNames={names}
        consults={consults}
        team={teamOf(careTeam(chart), consults, chart.encounterId)}
        rev={rev}
        consultants={CONSULTANTS}
        role={role}
        user={session.user.displayName}
        now={DEMO_NOW}
        route={screen.route}
      />
    </div>
  );
}
