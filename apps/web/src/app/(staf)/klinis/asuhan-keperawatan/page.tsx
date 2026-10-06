import type { Metadata } from 'next';
import { AskepWorkspace } from '@/components/rme/askep-workspace';
import { RmeChartHeader } from '@/components/rme/chart-header';
import { DemoAccessDenied } from '@/components/demo-access-denied';
import { NURSING_DX_MASTER, nursingPlan, SECOND_NURSES, SHIFT_EVALS } from '@/lib/demo/fixtures/rme-askep';
import { chartPatient } from '@/lib/demo/fixtures/rme-pasien';
import { DEMO_NOW, DEMO_TODAY } from '@/lib/demo/fixtures/waktu';
import { openRoute } from '@/lib/rme';
import { askepGivenNotes, askepView } from '@/lib/rme-toko';
import { requireDemoScreen } from '@/lib/server/demo-guard';
import { rmeChart } from '@/lib/server/data/klinis/rme';

export const metadata: Metadata = { title: 'Asuhan keperawatan' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * K12 · Asuhan keperawatan per shift + ronde obat dengan gerbang gelang eMAR (`?pasien=`, pasien rawat inap). Mode
 * presentasi (ADR-0023): rencana + toko demo `rekam-medis` (ADR-0085), eMAR sama dengan layar Rawat inap; backend
 * `POST /api/v1/nursing/…` menyusul (rencana fase 3 · 3.5).
 */
export default async function AskepPage({ searchParams }: { searchParams: SearchParams }) {
  const { session, screen, allowed } = await requireDemoScreen('askep');
  if (!allowed) return <DemoAccessDenied screen={screen} />;
  const { chart, state, rev } = await rmeChart((await searchParams).pasien);
  const role = session.role?.code ?? null;
  const d = chart.inpatient;
  const ranap = openRoute('ranap', role);

  return (
    <div className="flex flex-col gap-4">
      <RmeChartHeader
        chart={chart}
        screenId="askep"
        title="Asuhan keperawatan"
        tenantName={session.tenant.name}
        role={role}
        asOf={DEMO_NOW}
      />
      {d && !d.summary.scenario ? (
        <AskepWorkspace
          key={chart.encounterId}
          encounterId={chart.encounterId}
          rm={chartPatient(chart).rm}
          canNurse={role === 'perawat' || role === 'bidan'}
          user={session.user.displayName}
          now={DEMO_NOW}
          today={DEMO_TODAY}
          {...askepView(
            {
              ...nursingPlan(d),
              evals: SHIFT_EVALS.filter((e) => e.dxId.startsWith(chart.encounterId)),
            },
            state,
            chart.encounterId,
          )}
          given={askepGivenNotes(state, chart.encounterId)}
          rev={rev}
          master={NURSING_DX_MASTER}
          meds={d.medications}
          emarNote={d.emarNote}
          secondNurses={SECOND_NURSES}
          emarHref={ranap ? `${ranap}/${chart.encounterId}?tab=cppt` : null}
        />
      ) : (
        <p className="m-0 rounded-card border border-line bg-white px-4 py-3.5 text-small text-ink-700">
          {chart.setting === 'rawat-inap'
            ? 'Rencana asuhan keperawatan pasien ini belum disusun: mulai dari asesmen awal keperawatan, lalu tetapkan diagnosis keperawatan.'
            : 'Rencana asuhan keperawatan per shift dan ronde obat eMAR berlaku untuk pasien rawat inap. Pilih pasien rawat inap di pemilih pasien.'}
        </p>
      )}
    </div>
  );
}
