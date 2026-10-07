'use client';

import type { EdZone, TriageLevel } from '@simrs/shared';
import { cx, TabList, TabPanel } from '@simrs/ui';
import { useId } from 'react';
import { StatusFlag } from '@/components/klinis/status-flag';
import { TriageBadge } from '@/components/rawat-inap/triage-badge';
import {
  ED_STATUS_META,
  ED_ZONE_LABEL,
  type EdBoardRow,
  edLosAlert,
  formatLos,
  TRIAGE_META,
} from '@/lib/rawat-inap';

const ZONES: Array<EdZone | 'semua'> = ['semua', 'T', 'R', 'B', 'K'];
const LEVELS: Array<TriageLevel | 0> = [0, 1, 2, 3, 4, 5];
/**
 * Tabel tujuh kolom hanya bila papan selebar ≥ 56rem (container query: di 1280–1440 px papan berbagi lebar dengan
 * panel triase, kolom terlalu sempit dan chip status terbelah); lebih sempit = kartu per pasien.
 */
const COLS = '@4xl:grid-cols-[56px_1.7fr_1.05fr_1.6fr_1.1fr_0.8fr_1.25fr]';

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
  all: readonly EdBoardRow[];
  shown: readonly EdBoardRow[];
  zone: EdZone | 'semua';
  level: TriageLevel | 0;
  selected: string;
  /** Menit berjalan sejak data diambil (per pasien; pasien baru dihitung sejak ditambahkan). */
  addMinutes: (encounterId: string) => number;
  onZone: (z: EdZone | 'semua') => void;
  onLevel: (l: TriageLevel | 0) => void;
  onSelect: (id: string) => void;
}) {
  const idBase = useId();
  const zoneTabs = ZONES.map((z) => {
    const n = z === 'semua' ? all.length : all.filter((p) => p.zone === z).length;
    return { id: z, label: `${z === 'semua' ? 'Semua zona' : ED_ZONE_LABEL[z]} · ${n}` };
  });
  return (
    <section
      aria-label="Papan pasien IGD"
      className="@container min-w-0 flex-[999_1_560px] overflow-hidden rounded-card border border-white/95 bg-white/90 shadow-card"
    >
      <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-line px-3 py-2.5">
        {/* Tab zona (mockup: tablist/tab/aria-selected); panah kiri/kanan berpindah zona. */}
        <TabList
          items={zoneTabs}
          value={zone}
          onChange={(z) => onZone(z as EdZone | 'semua')}
          label="Zona IGD"
          idBase={idBase}
        />
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
                      : 'border-transparent bg-nav-active text-white'
                    : 'border-line-strong bg-white/90 text-ink-700 hover:bg-brand-50/60',
                )}
              >
                {n || 'Semua'}
              </button>
            );
          })}
        </div>
      </div>
      <TabPanel
        idBase={idBase}
        value={zone}
        className="focus-visible:outline-2 focus-visible:outline-brand-600"
      >
        <div
          aria-hidden="true"
          className={cx(
            'hidden border-b border-line text-caption font-semibold text-ink-500 @4xl:grid',
            COLS,
          )}
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
                    p.triageLevel
                      ? TRIAGE_META[p.triageLevel].rail
                      : 'shadow-[inset_4px_0_0_var(--color-line-strong)]',
                    on
                      ? 'bg-[linear-gradient(90deg,var(--color-brand-100),rgba(255,255,255,0.4))]'
                      : cx('hover:bg-brand-50/60', p.scenario ? 'bg-brand-50/40' : 'bg-transparent'),
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
                  <span className="col-span-2 px-3 pb-2 text-small @4xl:col-span-1 @4xl:py-2.5">
                    {p.chiefComplaint}
                  </span>
                  <span className="hidden px-3 py-2.5 text-small text-ink-700 @4xl:block">
                    {p.doctor ?? '—'}
                  </span>
                  <span className="flex flex-col items-start gap-1 px-3 pb-2 @4xl:py-2.5">
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
                  <span className="col-span-3 flex flex-wrap items-center gap-x-2 gap-y-1 px-3 pb-2.5 @4xl:col-span-1 @4xl:py-2.5">
                    <span
                      className={cx(
                        'rounded-full px-2.5 py-[3px] text-caption font-semibold whitespace-nowrap',
                        st.tone,
                      )}
                    >
                      {st.label}
                    </span>
                    {/* Kartu (papan sempit): kolom Dokter tidak tampil, jadi dokternya ikut di baris status. */}
                    <span className="text-caption text-ink-500 @4xl:hidden">Dokter: {p.doctor ?? '—'}</span>
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
      </TabPanel>
    </section>
  );
}
