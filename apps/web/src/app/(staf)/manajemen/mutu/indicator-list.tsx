'use client';

import type { QualityIndicator } from '@simrs/shared';
import { Chip, cx, FilterChip } from '@simrs/ui';
import { useState } from 'react';
import { TrendSparkline } from '@/components/manajemen/trend-sparkline';
import { formatPercent, indicatorOnTarget } from '@/lib/manajemen';

type Filter = 'semua' | 'inm' | 'imp-rs' | 'bawah';
const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'semua', label: 'Semua' },
  { id: 'inm', label: 'INM' },
  { id: 'imp-rs', label: 'IMP-RS' },
  { id: 'bawah', label: 'Di bawah sasaran' },
];

const num = (v: number) => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 }).format(v);

function delta(trend: readonly number[], prevMonth: string): string {
  const d = (trend.at(-1) ?? 0) - (trend.at(-2) ?? 0);
  if (Math.abs(d) < 0.05) return `tetap vs ${prevMonth}`;
  return `${d > 0 ? '▲' : '▼'} ${num(Math.abs(d))} poin vs ${prevMonth}`;
}

/** B06 · Indikator mutu (INM + IMP-RS): capaian, sasaran, tren 6 bulan, status teks; bisa disaring. */
export function IndicatorList({ indicators, months }: { indicators: QualityIndicator[]; months: string[] }) {
  const [filter, setFilter] = useState<Filter>('semua');
  const shown = indicators.filter((q) =>
    filter === 'semua' ? true : filter === 'bawah' ? !indicatorOnTarget(q) : q.group === filter,
  );
  const prev = months.at(-2) ?? '';
  return (
    <section
      aria-labelledby="indikator-judul"
      className="flex flex-col gap-3 rounded-card border border-line bg-white p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="flex min-w-0 flex-col">
          <h2 id="indikator-judul" className="m-0 text-base font-semibold">
            Indikator mutu · {months.at(-1)} 2026
          </h2>
          <span className="text-[12.5px] text-ink-500">
            INM = indikator nasional mutu; IMP-RS = indikator mutu prioritas rumah sakit. Tren {months[0]}–
            {months.at(-1)}, garis putus-putus = sasaran.
          </span>
        </span>
        <span role="group" aria-label="Saring indikator" className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <FilterChip key={f.id} selected={filter === f.id} onClick={() => setFilter(f.id)}>
              {f.label}
            </FilterChip>
          ))}
        </span>
      </div>
      <ul className="m-0 flex list-none flex-col p-0" aria-live="polite">
        {shown.map((q) => {
          const ok = indicatorOnTarget(q);
          const target = q.target.min ?? q.target.max;
          return (
            <li
              key={q.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-[#EEF1F4] py-2.5 last:border-0"
            >
              <span className="flex min-w-0 flex-[1_1_260px] flex-col gap-0.5">
                <span className="font-medium text-ink-900">{q.label}</span>
                <span className="text-caption text-ink-500">
                  {q.group === 'inm' ? 'INM' : 'IMP-RS'} · sasaran {q.target.label} · {q.pic}
                </span>
              </span>
              <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <TrendSparkline
                  values={q.trend}
                  target={target}
                  ok={ok}
                  label={`Tren ${months[0]}–${months.at(-1)}: ${q.trend.map(formatPercent).join(', ')}; sasaran ${q.target.label}`}
                />
                <span className="flex w-[124px] flex-col items-end">
                  <span
                    className={cx('font-mono text-lg font-semibold', ok ? 'text-ink-900' : 'text-danger')}
                  >
                    {formatPercent(q.value)}
                  </span>
                  <span className="text-[11.5px] text-ink-500">{delta(q.trend, prev)}</span>
                </span>
                <Chip tone={ok ? 'success' : 'danger'} className="min-w-[132px] justify-center">
                  {ok ? 'Memenuhi sasaran' : 'Di bawah sasaran'}
                </Chip>
              </span>
            </li>
          );
        })}
      </ul>
      {shown.length === 0 && <p className="m-0 text-small text-ink-500">Semua indikator memenuhi sasaran.</p>}
    </section>
  );
}
