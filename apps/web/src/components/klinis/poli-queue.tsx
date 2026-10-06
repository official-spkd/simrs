'use client';

import type { PoliQueueItem, PoliQueueStatus } from '@simrs/shared';
import { Button, Chip, type ChipTone, cx, FilterChip } from '@simrs/ui';
import Link from 'next/link';
import { useId, useState } from 'react';
import { filterQueue, QUEUE_FILTERS, QUEUE_STATUS_LABEL, type QueueFilter, queueCounts } from '@/lib/klinis';

const STATUS_TONE: Record<PoliQueueStatus, ChipTone> = {
  diperiksa: 'brand',
  menunggu: 'neutral',
  'menunggu-hasil': 'warning',
  dijeda: 'warning',
  selesai: 'success',
};

function initials(name: string): string {
  return name
    .replace(/^(Tn|Ny|An|Nn)\.\s*/, '')
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

/** Kolom kiri pemeriksaan poli: antrean hari ini dengan filter, pencarian, dan "Panggil berikutnya". */
export function PoliQueue({
  title,
  items,
  selectedId,
  statusOf,
  waitOf,
  next,
  onCallNext,
  called,
  canCall,
}: {
  title: string;
  items: readonly PoliQueueItem[];
  selectedId: string;
  statusOf: (i: PoliQueueItem) => PoliQueueStatus;
  waitOf: (i: PoliQueueItem) => string;
  next: PoliQueueItem | undefined;
  onCallNext: () => void;
  called: string | null;
  /** Posisi aktif boleh memanggil pasien (dokter). */
  canCall: boolean;
}) {
  const [filter, setFilter] = useState<QueueFilter>('semua');
  const [q, setQ] = useState('');
  const searchId = useId();
  const counts = queueCounts(items, statusOf);
  const shown = filterQueue(items, filter, q, statusOf);

  return (
    <section
      aria-label="Antrean poli"
      className="flex min-w-0 flex-col overflow-hidden rounded-card border border-line bg-white shadow-card"
    >
      <div className="flex flex-col gap-2.5 border-b border-line px-4 pt-3.5 pb-3">
        <span className="flex items-baseline justify-between gap-2">
          <h2 className="m-0 text-[15px] font-semibold">Antrean hari ini</h2>
          <span className="text-caption text-ink-500">{title}</span>
        </span>
        <div className="flex flex-col gap-1">
          <label htmlFor={searchId} className="text-caption font-semibold text-ink-700">
            Cari pasien
          </label>
          <input
            id={searchId}
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Nama, No. RM, atau nomor antrean"
            className="h-11 rounded-control border border-line-strong bg-white px-3 font-[inherit] text-ink-900"
          />
        </div>
        <div role="group" aria-label="Filter antrean" className="flex flex-wrap gap-1.5">
          {QUEUE_FILTERS.map((f) => (
            <FilterChip key={f.id} selected={filter === f.id} onClick={() => setFilter(f.id)}>
              {f.label} {counts[f.id]}
            </FilterChip>
          ))}
        </div>
      </div>
      <ul className="m-0 flex list-none flex-col p-0">
        {shown.map((p) => {
          const on = p.patientId === selectedId;
          const s = statusOf(p);
          return (
            <li key={p.patientId} className="border-b border-line-soft">
              <Link
                href={`/klinis/poli?pasien=${p.patientId}`}
                scroll={false}
                aria-current={on ? 'true' : undefined}
                className={cx(
                  'flex min-h-11 gap-3 border-l-[3px] px-4 py-3 text-ink-900 no-underline',
                  on ? 'bg-selected' : 'bg-white hover:bg-subtle',
                  s === 'diperiksa' ? 'border-l-brand-600' : 'border-l-transparent',
                )}
              >
                <span
                  aria-hidden="true"
                  className={cx(
                    'flex size-[34px] flex-none items-center justify-center rounded-full text-caption font-bold',
                    on ? 'bg-brand-600 text-white' : 'bg-muted text-ink-700',
                  )}
                >
                  {initials(p.name)}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex justify-between gap-2">
                    <span className="truncate font-semibold">{p.name}</span>
                    <span className="flex-none font-mono text-caption whitespace-nowrap text-ink-500">
                      {p.queueNo}
                    </span>
                  </span>
                  <span className="text-caption text-ink-500">
                    {p.rm} · {p.ageYears} th · {p.payer}
                  </span>
                  <span className="flex flex-wrap items-center justify-between gap-1.5">
                    <Chip tone={STATUS_TONE[s]}>{QUEUE_STATUS_LABEL[s]}</Chip>
                    {p.scenario && <Chip tone="info">Skenario</Chip>}
                    <span className="text-caption text-ink-500">{waitOf(p)}</span>
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      {shown.length === 0 && (
        <p className="m-0 px-4 py-4 text-small text-ink-500">
          Tidak ada pasien yang cocok dengan filter atau pencarian.
        </p>
      )}
      <div className="flex flex-col gap-1.5 px-4 py-3">
        <Button
          variant="primary"
          type="button"
          onClick={() => {
            // Mockup: memanggil pasien mengembalikan daftar ke "Semua" agar pasien yang dipanggil tetap terlihat.
            setFilter('semua');
            onCallNext();
          }}
          disabled={!canCall || !next}
          aria-describedby={!canCall ? `${searchId}-call` : undefined}
        >
          {next ? `Panggil berikutnya · ${next.queueNo}` : 'Tidak ada pasien menunggu'}
        </Button>
        {!canCall && (
          <span id={`${searchId}-call`} className="text-caption text-ink-500">
            Pemanggilan pasien dilakukan dokter pemeriksa.
          </span>
        )}
        {called && (
          <span role="status" className="text-caption text-success">
            {called}
          </span>
        )}
      </div>
    </section>
  );
}
