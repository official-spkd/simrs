import { formatJam } from '@simrs/shared';
import type { Metadata } from 'next';
import { DemoAccessDenied } from '@/components/demo-access-denied';
import { ComputedIndicators } from '@/components/manajemen/computed-indicators';
import { IncidentList } from '@/components/manajemen/incident-list';
import { RiskRegister } from '@/components/manajemen/risk-register';
import { ScenarioBanner } from '@/components/scenario-banner';
import { DEMO_TODAY } from '@/lib/demo/fixtures/waktu';
import { formatPercent, indicatorOnTarget, riskLevel, riskScore } from '@/lib/manajemen';
import { getComputedIndicators } from '@/lib/server/data/backoffice';
import { getQualityOverview } from '@/lib/server/data/manajemen';
import { requireDemoScreen } from '@/lib/server/demo-guard';
import { IndicatorList } from './indicator-list';
import { KpiTile } from '@/components/manajemen/kpi-tile';

export const metadata: Metadata = { title: 'Mutu & keselamatan' };

/**
 * B06 · Mutu dan keselamatan pasien (tanpa mockup; gaya Dasbor direksi). Indikator yang juga tampil di Dasbor
 * memakai nilai yang sama. Mode presentasi: data dummy fiktif (ADR-0023); indikator dari data transaksi dihitung dari
 * toko demo (PPI, pengaduan, resume final klinis; ADR-0085).
 */
export default async function MutuPage() {
  const { session, screen, allowed } = await requireDemoScreen('mutu');
  if (!allowed) return <DemoAccessDenied screen={screen} />;
  const d = await getQualityOverview();
  const computed = await getComputedIndicators();
  const q = computed.store.state;

  const onTarget = d.indicators.filter(indicatorOnTarget).length;
  const month = DEMO_TODAY.slice(0, 7);
  const thisMonth = d.incidents.filter((i) => i.reportedAt.startsWith(month));
  const harm = thisMonth.filter((i) => i.type === 'KTD' || i.type === 'Sentinel').length;
  const open = d.incidents.filter((i) => i.investigation !== 'selesai');
  const rca = open.filter((i) => i.investigation === 'rca').length;
  const overdue = open.filter((i) => i.dueDate < DEMO_TODAY).length;
  const high = d.risks.filter((r) => ['tinggi', 'ekstrem'].includes(riskLevel(riskScore(r))));
  const extreme = high.filter((r) => riskLevel(riskScore(r)) === 'ekstrem').length;
  const reporting = d.indicators.find((q) => q.id === 'lapor-ikp');

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-caption text-ink-500">
            Manajemen / Mutu dan keselamatan pasien · B06 · data per {formatJam(d.asOf)}
          </span>
          <h1 className="m-0 text-h1 font-semibold">Mutu dan keselamatan pasien · Oktober 2026</h1>
        </div>
      </header>

      <div role="region" aria-label="Ringkasan mutu" className="grid grid-cols-2 gap-3.5 xl:grid-cols-4">
        <KpiTile
          index={0}
          label="Indikator memenuhi sasaran"
          value={`${onTarget}/${d.indicators.length}`}
          hint={`${d.indicators.length - onTarget} di bawah sasaran`}
          detail="INM dan IMP-RS bulan berjalan"
          tone={onTarget === d.indicators.length ? 'success' : 'warning'}
        />
        <KpiTile
          index={1}
          label="IKP bulan ini"
          value={String(thisMonth.length)}
          hint={`${harm} KTD · ${thisMonth.length - harm} tanpa cedera/nyaris`}
          detail={
            reporting ? `pelaporan ≤ 2×24 jam ${formatPercent(reporting.value)}` : 'IKP tercatat bulan ini'
          }
          tone={harm > 0 ? 'warning' : 'success'}
        />
        <KpiTile
          index={2}
          label="Investigasi terbuka"
          value={String(open.length)}
          hint={overdue > 0 ? `${overdue} lewat batas waktu` : 'semua dalam batas waktu'}
          detail={`${rca} RCA berjalan`}
          tone={overdue > 0 ? 'danger' : 'neutral'}
        />
        <KpiTile
          index={3}
          label="Risiko tinggi/ekstrem"
          value={String(high.length)}
          hint={`${extreme} ekstrem`}
          detail={`dari ${d.risks.length} risiko di register`}
          tone={extreme > 0 ? 'danger' : 'warning'}
        />
      </div>

      <ScenarioBanner session={session} screen="mutu" />
      <IndicatorList indicators={d.indicators} months={d.months} />
      <ComputedIndicators
        items={computed.items}
        computedAt={q.recomputed ? `ulang ${q.recomputed.jam} oleh ${q.recomputed.by}` : '01.30'}
        rev={computed.store.rev}
        fromClinical={q.discharges.length}
      />
      {q.deaths.length > 0 && (
        <section
          aria-label="Kematian di IGD untuk telaah mutu"
          className="flex flex-col gap-2 rounded-card border border-line bg-white p-4"
        >
          <h2 className="m-0 text-base font-semibold">Kematian di IGD untuk telaah mutu</h2>
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-small">
            {q.deaths.map((x) => (
              <li key={x.encounterId}>
                {x.patientName} · {formatJam(x.diedAt)} · {x.causeCode} {x.causeLabel}
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-[1_1_420px]">
          <IncidentList incidents={d.incidents} today={DEMO_TODAY} />
        </div>
        <div className="min-w-0 flex-[1_1_420px]">
          <RiskRegister risks={d.risks} />
        </div>
      </div>
    </div>
  );
}
