'use client';

import {
  BED_STATUSES,
  type BedBoardApi,
  type BedStatus,
  CLINICAL_SSE_EVENTS,
  formatJam,
  type PractitionerOption,
} from '@simrs/shared';
import { cx } from '@simrs/ui';
import { useMemo, useState } from 'react';
import { LiveIndicator, useLiveBoard } from '@/components/klinis/live-board';
import { careClassLabel } from '@/lib/igd-api';
import { BED_STATUS_META, bedCounts, percent } from '@/lib/rawat-inap';
import { BedStatusTiles } from './bed-filters';
import { AplicarePanel, BedPanel, RequestsPanel } from './bed-live-panels';

export interface BedPermissions {
  /** Status bed, alokasi, batal permintaan, admisi terencana, transfer, pulang (`bed.write`). */
  write: boolean;
  /** Admisi dari IGD satu langkah (`encounter.write`). */
  admit: boolean;
}

export type ApiUnit = BedBoardApi['units'][number];
export type ApiBed = ApiUnit['beds'][number];

const CHANGE_EVENTS = [CLINICAL_SSE_EVENTS.bedStatus, CLINICAL_SSE_EVENTS.bedRequest] as const;
const SELECT =
  'h-11 min-w-[160px] rounded-control border border-line-strong bg-white px-2.5 text-small text-ink-900';

/**
 * K05 · Papan tempat tidur mode api (layar W3): ubin status, filter bangsal/status, peta bed per bangsal (status
 * bertulisan, label pasien inisial), bed terpilih (status berversi, transfer, pulang, gelang), antrean permintaan bed
 * (alokasi → admisi), status Aplicare. Real-time: event SSE → muat ulang data server.
 */
export function BedLive({
  tenantName,
  board,
  doctors,
  perms,
  initialUnit,
}: {
  tenantName: string;
  board: BedBoardApi;
  doctors: PractitionerOption[];
  perms: BedPermissions;
  initialUnit: string;
}) {
  const live = useLiveBoard('/klinis/tempat-tidur/events', CLINICAL_SSE_EVENTS.bedBoard, CHANGE_EVENTS);
  const wards = useMemo(() => board.units.filter((u) => u.kind === 'rawat_inap'), [board.units]);
  const allBeds = useMemo(() => wards.flatMap((u) => u.beds), [wards]);
  const [unitId, setUnitId] = useState(initialUnit);
  const [status, setStatus] = useState<BedStatus | 'semua'>('semua');
  const [selected, setSelected] = useState<string | null>(null);

  const shownWards = wards.filter((u) => unitId === 'semua' || u.unitId === unitId);
  const selBed = allBeds.find((b) => b.bedId === selected) ?? null;
  const selUnit = selBed ? (wards.find((u) => u.beds.some((b) => b.bedId === selBed.bedId)) ?? null) : null;
  const sync = board.aplicare;
  const failed = sync.filter((a) => a.state === 'gagal').length;
  const waiting = sync.filter((a) => a.state === 'menunggu').length;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-caption text-ink-500">Klinis / Rawat inap / Tempat tidur · {tenantName}</span>
          <h1 className="m-0 text-h1 font-bold tracking-[-0.02em]">Manajemen tempat tidur</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <LiveIndicator status={live.status} asOf={formatJam(board.asOf)} />
          <span className="inline-flex min-h-9 items-center gap-2 rounded-control border border-white/95 bg-white/90 px-3 text-small shadow-card">
            <span
              aria-hidden="true"
              className={cx(
                'size-[7px] rounded-full',
                failed ? 'bg-danger' : waiting ? 'bg-warning' : 'bg-success',
              )}
            />
            Aplicare:{' '}
            {sync.length === 0
              ? 'belum ada perubahan dilaporkan'
              : failed
                ? `${failed} ruang gagal terkirim`
                : waiting
                  ? `${waiting} ruang menunggu kirim`
                  : 'semua ruang terkirim'}
          </span>
        </div>
      </header>
      <BedStatusTiles counts={bedCounts(allBeds)} />
      <div className="flex flex-wrap items-start gap-4">
        <section aria-label="Peta tempat tidur" className="flex min-w-0 flex-[999_1_560px] flex-col gap-3">
          <div
            role="group"
            aria-label="Filter tempat tidur"
            className="flex flex-wrap items-end gap-2.5 rounded-card border border-white/95 bg-white/90 px-3.5 py-2.5 shadow-card"
          >
            <label className="flex flex-col gap-1 text-caption font-semibold text-ink-700">
              Bangsal
              <select className={SELECT} value={unitId} onChange={(e) => setUnitId(e.target.value)}>
                <option value="semua">Semua bangsal</option>
                {wards.map((u) => (
                  <option key={u.unitId} value={u.unitId}>
                    {u.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-caption font-semibold text-ink-700">
              Status
              <select
                className={SELECT}
                value={status}
                onChange={(e) => setStatus(e.target.value as BedStatus | 'semua')}
              >
                <option value="semua">Semua status</option>
                {BED_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {BED_STATUS_META[s].label}
                  </option>
                ))}
              </select>
            </label>
            <span className="flex-[1_1_120px] pb-2.5 text-right text-caption text-ink-500" aria-live="polite">
              {allBeds.length} bed di {wards.length} bangsal
            </span>
          </div>
          {wards.length === 0 && (
            <p className="m-0 rounded-card border border-dashed border-line-strong bg-white/70 p-4 text-small text-ink-500">
              Tidak ada bangsal rawat inap di lingkup penugasan Anda.
            </p>
          )}
          {shownWards.map((u) => (
            <WardSection
              key={u.unitId}
              unit={u}
              status={status}
              selected={selected}
              onSelect={(id) => setSelected(id === selected ? null : id)}
            />
          ))}
        </section>
        <aside
          aria-label="Alokasi dan admisi"
          className="flex flex-[1_1_320px] flex-col gap-4 lg:max-w-[420px]"
        >
          {selBed && selUnit && (
            <BedPanel
              key={`${selBed.bedId}-${selBed.version}`}
              bed={selBed}
              unit={selUnit}
              board={board}
              canWrite={perms.write}
              onClose={() => setSelected(null)}
            />
          )}
          <RequestsPanel board={board} doctors={doctors} perms={perms} onPickBed={setSelected} />
          <AplicarePanel board={board} />
        </aside>
      </div>
    </div>
  );
}

function WardSection({
  unit,
  status,
  selected,
  onSelect,
}: {
  unit: ApiUnit;
  status: BedStatus | 'semua';
  selected: string | null;
  onSelect: (bedId: string) => void;
}) {
  const counts = bedCounts(unit.beds);
  const beds = unit.beds.filter((b) => status === 'semua' || b.status === status);
  return (
    <section
      aria-label={`Peta ${unit.name}`}
      className="flex flex-col gap-3 rounded-card border border-white/95 bg-white/90 px-4 py-3.5 shadow-card"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="m-0 text-body font-bold">{unit.name}</h2>
        <span className="text-small text-ink-700">
          {counts.occupied}/{counts.total} terisi ({percent(counts.occupied, counts.total)}%) · siap{' '}
          {counts.siap}
          {counts.dipesan ? ` · dipesan ${counts.dipesan}` : ''}
        </span>
      </div>
      {beds.length === 0 ? (
        <p className="m-0 text-caption text-ink-500">Tidak ada bed berstatus ini.</p>
      ) : (
        <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2 p-0">
          {beds.map((b) => {
            const m = BED_STATUS_META[b.status];
            const on = b.bedId === selected;
            return (
              <li key={b.bedId}>
                <button
                  type="button"
                  aria-pressed={on}
                  aria-label={`${b.code} · ${m.label}${b.patientLabel ? ` · ${b.patientLabel}` : ''}`}
                  onClick={() => onSelect(b.bedId)}
                  className={cx(
                    'flex min-h-[72px] w-full cursor-pointer flex-col gap-0.5 rounded-control border px-2.5 py-2 text-left font-[inherit] text-ink-900',
                    m.tile,
                    on &&
                      'border-brand-600 ring-2 ring-[color-mix(in_srgb,_var(--color-brand-600)_35%,_transparent)]',
                  )}
                >
                  <span className="flex items-baseline justify-between gap-1">
                    <span className="font-mono text-caption font-semibold">{b.code}</span>
                    <span className={cx('text-[11px] font-bold', m.text)}>{m.label}</span>
                  </span>
                  <span className="truncate text-[12.5px] font-semibold">{b.patientLabel ?? '—'}</span>
                  <span className="truncate text-[11.5px] text-ink-500">
                    {careClassLabel(b.careClass)} · sejak {formatJam(b.since)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
