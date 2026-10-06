import { DASHBOARD_PERIODS, formatJam } from '@simrs/shared';
import { cx, LineChart } from '@simrs/ui';
import type { Metadata } from 'next';
import { z } from 'zod';
import {
  CARD,
  CATEGORY_FILLS,
  H1,
  H2,
  PROGRESS_FILL,
  PROGRESS_FILL_DANGER,
  PROGRESS_TRACK,
} from '@/components/backoffice/styles';
import { DemoAccessDenied } from '@/components/demo-access-denied';
import { KpiTile } from '@/components/manajemen/kpi-tile';
import {
  capacityRows,
  formatKpiDelta,
  formatKpiValue,
  kpiOnTrack,
  PERIOD_TITLES,
  payerShares,
  revenueChart,
} from '@/lib/dasbor';
import { screenById } from '@/lib/screens';
import { getExecutiveDashboard } from '@/lib/server/data/dashboard';
import { requireDemoScreen } from '@/lib/server/demo-guard';
import { type DashboardAlertView, DecisionAlerts, PeriodSwitch } from './dashboard-client';

export const metadata: Metadata = { title: 'Dasbor eksekutif' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Warna kategori tetap (papan F5): JKN samudra, umum zamrud, asuransi anggrek, kerja sama kunyit muda. */
const MIX_COLOR = {
  jkn: CATEGORY_FILLS[0],
  umum: CATEGORY_FILLS[1],
  asuransi: CATEGORY_FILLS[2],
  'kerja-sama': CATEGORY_FILLS[3],
};

/**
 * I09 · Dasbor direksi (mockup `Dasbor.dc.html`). Mode presentasi: profil dummy fiktif (ADR-0023) ditimpa keadaan toko
 * demo yang tersedia (kapasitas bed, IGD, kebersihan tangan, stok); tanda tindak lanjut tersimpan (ADR-0085).
 */
export default async function DasborPage({ searchParams }: { searchParams: SearchParams }) {
  const { session, screen, allowed } = await requireDemoScreen('dasbor');
  if (!allowed) return <DemoAccessDenied screen={screen} />;
  const sp = await searchParams;
  const period = z.enum(DASHBOARD_PERIODS).catch('bulan').parse(sp.periode);
  const { dashboard: d, store } = await getExecutiveDashboard(period, session);
  const chart = revenueChart(d.revenue);
  const shares = payerShares(d.payerMix);
  const capacity = capacityRows(d.capacity);
  const alerts: DashboardAlertView[] = d.alerts.map((a) => {
    const target = a.link ? screenById(a.link.screen) : undefined;
    return {
      id: a.id,
      title: a.title,
      detail: a.detail,
      severity: a.severity,
      link:
        a.link && target && target.status !== 'belum' ? { href: target.route, label: a.link.label } : null,
    };
  });

  return (
    <div className="stagger-rise flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-caption text-ink-500">
            Manajemen / Dasbor direksi · data per {formatJam(d.asOf)}
          </span>
          <h1 className={H1}>{PERIOD_TITLES[period]}</h1>
        </div>
        <PeriodSwitch value={period} />
      </header>

      <div
        role="region"
        aria-label="Indikator kinerja utama"
        aria-live="polite"
        className="grid grid-cols-2 gap-3.5 md:grid-cols-3 xl:grid-cols-6"
      >
        {d.kpis.map((k, i) => {
          const good = kpiOnTrack(k);
          return (
            <KpiTile
              key={k.id}
              index={i}
              label={k.label}
              value={formatKpiValue(k)}
              hint={formatKpiDelta(k)}
              detail={[k.note, k.target.label].filter(Boolean).join(' · ')}
              tone={good ? 'success' : 'danger'}
            />
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.5fr_1fr]">
        <section aria-label="Pendapatan" className={cx('flex flex-col gap-2.5 p-4', CARD)}>
          <span className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className={H2}>Pendapatan harian vs anggaran (Rp juta)</h2>
            <span className="text-[12.5px] text-ink-500">
              realisasi {chart.realizationPercent}% dari anggaran berjalan
            </span>
          </span>
          <LineChart
            id="pendapatan"
            ariaLabel="Grafik pendapatan harian 30 hari terakhir terhadap anggaran (Rp juta)"
            yTicks={[150, 200, 250, 300]}
            xLabels={chart.xLabels}
            rowLabels={chart.rows.map((r) => r.date)}
            series={[
              { label: 'Realisasi', values: chart.actual, tone: 'brand', area: true },
              { label: 'Anggaran', values: chart.budget, tone: 'warning', dashed: true },
            ]}
          />
          <div className="flex flex-wrap gap-4 text-caption text-ink-700">
            <span>
              <span className="mr-1.5 inline-block h-0.5 w-3.5 bg-brand-600 align-middle" />
              Realisasi 30 hari
            </span>
            <span>
              <span className="mr-1.5 inline-block w-3.5 border-t-2 border-dashed border-warning align-middle" />
              Anggaran harian
            </span>
          </div>
        </section>

        <section aria-label="Bauran penjamin" className={cx('flex flex-col gap-3 p-4', CARD)}>
          <h2 className={H2}>Bauran penjamin dan margin</h2>
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {shares.map((m) => (
              <li
                key={m.payer}
                className="grid grid-cols-[1.2fr_2fr_48px_64px] items-center gap-2.5 text-small"
              >
                <span>{m.label}</span>
                <span
                  className="h-2.5 overflow-hidden rounded-full bg-[rgba(23,32,46,0.08)]"
                  aria-hidden="true"
                >
                  <span
                    className={cx('block h-2.5 rounded-full', MIX_COLOR[m.payer])}
                    style={{ width: `${m.share}%` }}
                  />
                </span>
                <span className="text-right font-mono">{m.share}%</span>
                <span
                  className={cx('text-right font-mono', m.marginNegative ? 'text-danger' : 'text-success')}
                >
                  {m.margin}
                </span>
              </li>
            ))}
          </ul>
          <span className="text-caption text-ink-500">
            Kolom terakhir: margin kontribusi. JKN negatif terutama di kasus pneumonia, stroke, dan sepsis
            (LOS melebihi clinical pathway).
          </span>
        </section>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <section aria-label="Mutu" className={cx('flex flex-col gap-2.5 p-4', CARD)}>
          <h2 className={H2}>Indikator nasional mutu</h2>
          <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
            {d.quality.map((q) => {
              const ok = q.value >= q.target.min;
              return (
                <li key={q.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-2.5 text-small">
                  <span className="text-ink-700">{q.label}</span>
                  <span className={cx('font-mono font-semibold', ok ? 'text-success' : 'text-warning')}>
                    {q.value}%
                    <span className="sr-only">{ok ? ', memenuhi sasaran' : ', di bawah sasaran'}</span>
                  </span>
                  <span className="text-[11.5px] text-ink-500">{q.target.label}</span>
                </li>
              );
            })}
          </ul>
        </section>

        <section aria-label="Kapasitas" className={cx('flex flex-col gap-2.5 p-4', CARD)}>
          <h2 className={H2}>Kapasitas saat ini</h2>
          <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
            {capacity.map((c) => (
              <li key={c.id} className="flex flex-col gap-1">
                <span className="flex justify-between text-small">
                  <span className="text-ink-700">{c.label}</span>
                  <span className={cx('font-mono font-semibold', c.high ? 'text-danger' : 'text-ink-900')}>
                    {c.text}
                    <span className="sr-only">
                      {c.high ? `, ${c.percent}% hampir penuh` : `, ${c.percent}%`}
                    </span>
                  </span>
                </span>
                <span className={PROGRESS_TRACK} aria-hidden="true">
                  <span
                    className={c.high ? PROGRESS_FILL_DANGER : PROGRESS_FILL}
                    style={{ width: `${c.percent}%` }}
                  />
                </span>
              </li>
            ))}
          </ul>
        </section>

        <DecisionAlerts
          alerts={alerts}
          acks={store.state.acks}
          rev={store.rev}
          canDecide={session.role?.code === 'manajemen'}
        />
      </div>
    </div>
  );
}
