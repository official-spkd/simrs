'use client';

import type { EdTrackingItem, EdZone, TriageLevel } from '@simrs/shared';
import { cx } from '@simrs/ui';
import { StatusFlag } from '@/components/klinis/status-flag';
import { TriageBadge } from '@/components/rawat-inap/triage-badge';
import { ED_STATUS_META, ED_ZONE_LABEL, edLosAlert, formatLos, TRIAGE_META } from '@/lib/rawat-inap';

const ZONES: Array<EdZone | 'semua'> = ['semua', 'T', 'R', 'B', 'K'];
const LEVELS: Array<TriageLevel | 0> = [0, 1, 2, 3, 4, 5];
const COLS = 'lg:grid-cols-[56px_1.7fr_1.05fr_1.6fr_1.1fr_0.8fr_1.25fr]';

/** Papan pelacakan IGD: tab zona, filter level triase, baris pasien dengan lama tinggal berjalan. */
export function EdBoardTable({
  all,
  shown,
  zone,
  level,
  selected,
  addMinutes,
  onZone,
  onLevel,
  onSelect,
}: {
  all: EdTrackingItem[];
  shown: EdTrackingItem[];
  zone: EdZone | 'semua';
  level: TriageLevel | 0;
  selected: string;
  /** Menit berjalan sejak data diambil (per pasien; pasien baru dihitung sejak ditambahkan). */
  addMinutes: (encounterId: string) => number;
  onZone: (z: EdZone | 'semua') => void;
  onLevel: (l: TriageLevel | 0) => void;
  onSelect: (id: string) => void;
}) {
  return (
    <section
      aria-label="Papan pasien IGD"
      className="min-w-0 flex-[999_1_560px] overflow-hidden rounded-card border border-line bg-white"
    >
      <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-line px-3 py-2.5">
        <div
          role="group"
          aria-label="Zona IGD"
          className="flex flex-wrap gap-1 rounded-control bg-line-soft p-[3px]"
        >
          {ZONES.map((z) => {
            const n = z === 'semua' ? all.length : all.filter((p) => p.zone === z).length;
            const on = zone === z;
            return (
              <button
                key={z}
                type="button"
                aria-pressed={on}
                onClick={() => onZone(z)}
                className={cx(
                  'min-h-11 cursor-pointer rounded-[8px] border-0 px-3 font-[inherit] text-small',
                  on ? 'bg-white font-semibold text-ink-900 shadow-tab' : 'bg-transparent text-ink-700',
                )}
              >
                {z === 'semua' ? 'Semua zona' : ED_ZONE_LABEL[z]} · {n}
              </button>
            );
          })}
        </div>
        <div role="group" aria-label="Filter level triase" className="flex flex-wrap items-center gap-1.5">
          <span className="text-caption font-semibold text-ink-700">Level triase</span>
          {LEVELS.map((n) => {
            const on = level === n;
            return (
              <button
                key={n}
                type="button"
                aria-pressed={on}
                aria-label={n ? `Level ${n} · ${TRIAGE_META[n].label}` : 'Semua level'}
                onClick={() => onLevel(n)}
                className={cx(
                  'h-11 min-w-11 cursor-pointer rounded-full border px-2.5 font-[inherit] text-caption font-bold',
                  on
                    ? n
                      ? TRIAGE_META[n].badge
                      : 'border-brand-600 bg-brand-50 text-brand-700'
                    : 'border-line bg-white text-ink-700',
                )}
              >
                {n || 'Semua'}
              </button>
            );
          })}
        </div>
      </div>
      <div
        aria-hidden="true"
        className={cx('hidden bg-subtle text-caption font-semibold text-ink-700 lg:grid', COLS)}
      >
        {['Bed', 'Pasien', 'Triase', 'Keluhan utama', 'Dokter', 'Lama', 'Status'].map((h) => (
          <span key={h} className="px-3 py-2.5">
            {h}
          </span>
        ))}
      </div>
      <ul className="m-0 list-none p-0" aria-label="Pasien di IGD">
        {shown.map((p) => {
          const mins = p.losMinutes + addMinutes(p.encounterId);
          const late = edLosAlert(p, mins);
          const on = p.encounterId === selected;
          const st = ED_STATUS_META[p.status];
          return (
            <li key={p.encounterId} className="border-t border-line-soft">
              <button
                type="button"
                aria-pressed={on}
                onClick={() => onSelect(p.encounterId)}
                className={cx(
                  'grid w-full cursor-pointer grid-cols-[52px_1fr_auto] items-center gap-x-1 border-0 p-0 text-left font-[inherit] text-ink-900',
                  COLS,
                  p.triageLevel ? TRIAGE_META[p.triageLevel].rail : 'shadow-[inset_4px_0_0_#CBD3DB]',
                  on ? 'bg-selected' : p.scenario ? 'bg-[#FBFDFC]' : 'bg-white',
                )}
              >
                <span className="px-3 py-2.5 font-mono font-semibold">{p.bed ?? '—'}</span>
                <span className="flex min-w-0 flex-col px-3 py-2.5 leading-tight">
                  <span className="font-semibold">{p.patientName}</span>
                  <span className="text-caption text-ink-500">
                    {p.sex} · {p.ageLabel} · {p.guarantor}
                  </span>
                </span>
                <span className="px-3 py-2.5">
                  <TriageBadge level={p.triageLevel} />
                </span>
                <span className="col-span-2 px-3 pb-2 text-small lg:col-span-1 lg:py-2.5">
                  {p.chiefComplaint}
                </span>
                <span className="hidden px-3 py-2.5 text-small text-ink-700 lg:block">{p.doctor ?? '—'}</span>
                <span className="flex flex-col items-start gap-1 px-3 pb-2 lg:py-2.5">
                  <span
                    className={cx(
                      'font-mono font-semibold whitespace-nowrap',
                      late ? 'text-danger' : 'text-ink-900',
                    )}
                  >
                    {formatLos(mins)}
                  </span>
                  {late && (
                    <StatusFlag icon="clock" inline>
                      {late}
                    </StatusFlag>
                  )}
                </span>
                <span className="col-span-3 px-3 pb-2.5 lg:col-span-1 lg:py-2.5">
                  <span className={cx('rounded-full px-2.5 py-[3px] text-caption font-semibold', st.tone)}>
                    {st.label}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {shown.length === 0 && (
        <p className="m-0 border-t border-line-soft px-3 py-4 text-small text-ink-500">
          Tidak ada pasien pada zona dan level triase ini.
        </p>
      )}
    </section>
  );
}
