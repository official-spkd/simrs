'use client';

import { formatJam, type RadiologyExam, type RadStatus } from '@simrs/shared';
import { cx, FilterChip } from '@simrs/ui';
import { MODALITY_LABEL, procedureCodeText, RAD_STATUS_VIEW } from '@/lib/penunjang-radiologi';
import { TONE_CHIP } from './lab-worklist';

export type RadFilter = 'semua' | RadStatus;

/** Worklist pemeriksaan radiologi dengan filter status (terjadwal → berlangsung → ekspertise → ditandatangani). */
export function RadWorklist({
  exams,
  counts,
  filter,
  selected,
  onFilter,
  onSelect,
}: {
  exams: readonly RadiologyExam[];
  counts: Record<RadFilter, number>;
  filter: RadFilter;
  selected: string;
  onFilter: (f: RadFilter) => void;
  onSelect: (id: string) => void;
}) {
  const filters: Array<{ id: RadFilter; label: string }> = [
    { id: 'semua', label: 'Semua' },
    { id: 'terjadwal', label: 'Terjadwal' },
    { id: 'berlangsung', label: 'Berlangsung' },
    { id: 'ekspertise', label: 'Ekspertise' },
    { id: 'ditandatangani', label: 'Ditandatangani' },
  ];
  return (
    <section
      aria-label="Worklist radiologi"
      className="flex min-w-0 flex-[1_1_300px] flex-col overflow-hidden rounded-card border border-white/95 bg-white/90 shadow-card lg:max-w-[400px]"
    >
      <div className="flex flex-col gap-2 border-b border-line px-4 py-3">
        <h2 className="m-0 text-[15px] font-semibold">Worklist pemeriksaan</h2>
        <div role="group" aria-label="Filter status" className="flex flex-wrap gap-1.5">
          {filters.map((f) => (
            <FilterChip key={f.id} selected={filter === f.id} onClick={() => onFilter(f.id)}>
              {f.label} · {counts[f.id]}
            </FilterChip>
          ))}
        </div>
      </div>
      {exams.length === 0 && <p className="m-0 px-4 py-4 text-small text-ink-500">Tidak ada pemeriksaan.</p>}
      <ul className="m-0 list-none p-0">
        {exams.map((e) => {
          const sel = e.id === selected;
          const st = RAD_STATUS_VIEW[e.status];
          return (
            <li key={e.id}>
              <button
                type="button"
                aria-pressed={sel}
                onClick={() => onSelect(e.id)}
                className={cx(
                  'grid min-h-11 w-full cursor-pointer grid-cols-[4px_minmax(0,1fr)_auto] gap-2.5 border-0 border-b border-line-soft py-2.5 pr-3.5 text-left font-[inherit] text-inherit',
                  sel
                    ? 'bg-[linear-gradient(90deg,var(--color-brand-100),rgba(255,255,255,0.4))]'
                    : 'bg-transparent hover:bg-brand-50/60',
                )}
              >
                <span
                  aria-hidden="true"
                  className={cx(
                    'self-stretch',
                    sel
                      ? 'bg-brand-600'
                      : e.priority === 'cito' && e.status !== 'ditandatangani'
                        ? 'bg-koral-600'
                        : 'bg-transparent',
                  )}
                />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="flex flex-wrap items-center gap-1.5 font-semibold">
                    {e.patient.name}
                    {e.priority === 'cito' && (
                      <span className="rounded-full bg-koral-100 px-2 text-[11px] font-semibold text-koral-800">
                        Cito
                      </span>
                    )}
                  </span>
                  <span className="text-[12.5px] text-ink-700">{e.procedure}</span>
                  <span className="text-[11.5px] text-ink-500">
                    {MODALITY_LABEL[e.modality]} ·{' '}
                    <span className="font-mono">{procedureCodeText(e.procedureCode)}</span>
                  </span>
                </span>
                <span className="flex flex-col items-end gap-1">
                  <span
                    className={cx('rounded-full px-2 py-0.5 text-[11.5px] font-semibold', TONE_CHIP[st.tone])}
                  >
                    {st.label}
                  </span>
                  <span className="font-mono text-caption text-ink-500">
                    <span className="sr-only">Jadwal </span>
                    {formatJam(e.scheduledAt)}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
