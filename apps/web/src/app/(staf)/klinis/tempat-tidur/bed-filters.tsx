'use client';

import { BED_STATUSES, type Ward, WARD_CLASSES } from '@simrs/shared';
import { cx } from '@simrs/ui';
import { BED_STATUS_META, type BedCounts, type BedFilter, percent } from '@/lib/rawat-inap';

const selectCls =
  'h-11 min-w-[150px] rounded-control border border-line-strong bg-white px-2.5 font-[inherit] text-small font-normal text-ink-900';

/** Filter bangsal, kelas, status (label terlihat) + jumlah bed yang tampil. */
export function BedFilters({
  wards,
  filter,
  shownLabel,
  onChange,
}: {
  wards: Ward[];
  filter: BedFilter;
  shownLabel: string;
  onChange: (f: BedFilter) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Filter tempat tidur"
      className="flex flex-wrap items-end gap-2.5 rounded-card border border-line bg-white px-3.5 py-2.5"
    >
      <label className="flex flex-col gap-1 text-caption font-semibold text-ink-700">
        Bangsal
        <select
          className={selectCls}
          value={filter.ward}
          onChange={(e) => onChange({ ...filter, ward: e.target.value })}
        >
          <option value="semua">Semua bangsal</option>
          {wards.map((w) => (
            <option key={w.code} value={w.code}>
              {w.name} · {w.service}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-caption font-semibold text-ink-700">
        Kelas
        <select
          className={selectCls}
          value={filter.kelas}
          onChange={(e) => onChange({ ...filter, kelas: e.target.value as BedFilter['kelas'] })}
        >
          <option value="semua">Semua kelas</option>
          {WARD_CLASSES.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-caption font-semibold text-ink-700">
        Status
        <select
          className={selectCls}
          value={filter.status}
          onChange={(e) => onChange({ ...filter, status: e.target.value as BedFilter['status'] })}
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
        {shownLabel}
      </span>
    </div>
  );
}

/** Lima ubin status (teks + angka, warna hanya penegas). */
export function BedStatusTiles({ counts }: { counts: BedCounts }) {
  const tiles = [
    {
      label: 'Terisi',
      value: `${counts.occupied} · ${percent(counts.occupied, counts.total)}%`,
      sub: `dari ${counts.total} bed · ${counts.pulang} pulang hari ini`,
      swatch: 'border-line-strong bg-white',
    },
    {
      label: 'Siap pakai',
      value: String(counts.siap),
      sub: 'bersih, bisa dialokasikan',
      swatch: 'border-success-border bg-success-bg',
    },
    {
      label: 'Dipesan',
      value: String(counts.dipesan),
      sub: 'menunggu pasien tiba',
      swatch: 'border-info-border bg-info-bg',
    },
    {
      label: 'Kotor · dibersihkan',
      value: String(counts.kotor + counts.dibersihkan),
      sub: `${counts.kotor} kotor · ${counts.dibersihkan} dibersihkan`,
      swatch: 'border-warning-border bg-[#FFF8EB]',
    },
    {
      label: 'Rusak',
      value: String(counts.rusak),
      sub: 'tidak dapat dipakai',
      swatch: 'border-danger-border bg-[#FEF3F2]',
    },
  ];
  return (
    <div
      role="region"
      aria-label="Ringkasan status bed"
      className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5"
    >
      {tiles.map((t) => (
        <div
          key={t.label}
          className="flex items-center gap-3 rounded-card border border-line bg-white px-3.5 py-3"
        >
          <span aria-hidden="true" className={cx('h-10 w-3 flex-none rounded-[4px] border', t.swatch)} />
          <span className="flex min-w-0 flex-col">
            <span className="text-caption text-ink-500">{t.label}</span>
            <span className="text-[22px] font-bold">{t.value}</span>
            <span className="text-[11.5px] text-ink-500">{t.sub}</span>
          </span>
        </div>
      ))}
    </div>
  );
}
