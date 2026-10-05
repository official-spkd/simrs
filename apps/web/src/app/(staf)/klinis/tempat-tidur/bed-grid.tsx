'use client';

import type { Bed, Ward } from '@simrs/shared';
import { Button, cx } from '@simrs/ui';
import { StatusFlag } from '@/components/klinis/status-flag';
import { BED_STATUS_META, wardSummary } from '@/lib/rawat-inap';

/** Peta bed satu ruang: ubin berwarna + teks status (tidak hanya warna). */
export function WardGrid({
  ward,
  beds,
  allBeds,
  selected,
  onSelect,
}: {
  ward: Ward;
  beds: Bed[];
  allBeds: Bed[];
  selected: string;
  onSelect: (code: string) => void;
}) {
  const s = wardSummary(ward, allBeds);
  return (
    <section
      aria-label={`Peta ${ward.name}`}
      className="flex flex-col gap-3 rounded-card border border-line bg-white px-4 py-3.5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="m-0 text-body font-bold">
          {ward.name} · {ward.service} · {ward.kelas}
        </h2>
        <span className="text-small text-ink-700">{s.text}</span>
      </div>
      <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-2 p-0">
        {beds.map((b) => {
          const m = BED_STATUS_META[b.status];
          const on = b.code === selected;
          return (
            <li key={b.code}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => onSelect(b.code)}
                className={cx(
                  'flex min-h-[72px] w-full cursor-pointer flex-col gap-0.5 rounded-control border px-2.5 py-2 text-left font-[inherit] text-ink-900',
                  m.tile,
                  on && 'border-brand-600 ring-2 ring-[rgba(15,118,110,0.35)]',
                )}
              >
                <span className="flex items-baseline justify-between gap-1">
                  <span className="font-mono text-caption font-semibold">{b.code}</span>
                  <span className={cx('text-[11px] font-bold', m.text)}>{m.label}</span>
                </span>
                <span className="truncate text-[12.5px] font-semibold">{b.patientLabel ?? '—'}</span>
                <span className="truncate text-[11.5px] text-ink-500">{b.note}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Ringkasan semua ruang (filter "Semua bangsal"): okupansi + jumlah per status, lalu buka peta ruangnya. */
export function WardOverview({
  wards,
  beds,
  onOpen,
}: {
  wards: Ward[];
  beds: Bed[];
  onOpen: (code: string) => void;
}) {
  return (
    <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3 p-0">
      {wards.map((w) => {
        const { counts, percent: pct, nearlyFull } = wardSummary(w, beds);
        return (
          <li key={w.code} className="flex flex-col gap-2 rounded-card border border-line bg-white px-4 py-3">
            <span className="flex items-baseline justify-between gap-2">
              <span className="font-bold">{w.name}</span>
              <span className="text-caption text-ink-500">{w.kelas}</span>
            </span>
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-small text-ink-700">
              <span>
                {counts.occupied}/{counts.total} terisi ({pct}%) · {w.service}
              </span>
              {nearlyFull && <StatusFlag icon="alert">Hampir penuh</StatusFlag>}
            </span>
            <span className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
              <span
                className={cx('block h-2', nearlyFull ? 'bg-danger' : 'bg-brand-600')}
                style={{ width: `${pct}%` }}
              />
            </span>
            <span className="text-caption text-ink-700">
              Siap {counts.siap} · Dipesan {counts.dipesan} · Kotor/dibersihkan{' '}
              {counts.kotor + counts.dibersihkan}
              {counts.rusak ? ` · Rusak ${counts.rusak}` : ''}
            </span>
            <Button size="sm" onClick={() => onOpen(w.code)}>
              Lihat peta {w.name}
            </Button>
          </li>
        );
      })}
    </ul>
  );
}

/** Tampilan daftar: semua bed yang lolos filter. */
export function BedList({
  beds,
  wardName,
  selected,
  onSelect,
}: {
  beds: Bed[];
  wardName: (code: string) => string;
  selected: string;
  onSelect: (code: string) => void;
}) {
  return (
    <div className="overflow-hidden rounded-card border border-line bg-white">
      <div
        aria-hidden="true"
        className="hidden grid-cols-[84px_1.3fr_1fr_1.2fr_1.4fr] bg-subtle text-caption font-semibold text-ink-700 lg:grid"
      >
        {['Bed', 'Bangsal', 'Status', 'Pasien', 'Catatan'].map((h) => (
          <span key={h} className="px-3.5 py-2.5">
            {h}
          </span>
        ))}
      </div>
      <ul className="m-0 list-none p-0" aria-label="Daftar tempat tidur">
        {beds.map((b) => {
          const m = BED_STATUS_META[b.status];
          return (
            <li key={b.code} className="border-t border-line-soft">
              <button
                type="button"
                aria-pressed={b.code === selected}
                onClick={() => onSelect(b.code)}
                className={cx(
                  'grid min-h-11 w-full cursor-pointer grid-cols-[84px_1fr_auto] items-center border-0 p-0 text-left font-[inherit] text-ink-900 lg:grid-cols-[84px_1.3fr_1fr_1.2fr_1.4fr]',
                  b.code === selected ? 'bg-selected' : 'bg-white',
                )}
              >
                <span className="px-3.5 py-2 font-mono font-semibold">{b.code}</span>
                <span className="px-3.5 py-2 text-small text-ink-700">{wardName(b.wardCode)}</span>
                <span className="px-3.5 py-2">
                  <span
                    className={cx(
                      'rounded-full border px-2.5 py-[3px] text-caption font-bold',
                      m.tile,
                      m.text,
                    )}
                  >
                    {m.label}
                  </span>
                </span>
                <span className="hidden px-3.5 py-2 text-small font-semibold lg:block">
                  {b.patientLabel ?? '—'}
                </span>
                <span className="hidden px-3.5 py-2 text-[12.5px] text-ink-500 lg:block">{b.note}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
