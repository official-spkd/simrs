'use client';

import { type ChargeItem, formatRupiah } from '@simrs/shared';
import { Chip, cx, Icon } from '@simrs/ui';
import { useState } from 'react';
import { groupLines } from '@/lib/keuangan';

const GRID =
  'grid grid-cols-[minmax(0,2.2fr)_minmax(0,0.7fr)_minmax(0,1.1fr)_minmax(0,1fr)] items-center gap-2';

/**
 * Rincian tagihan per kategori (mockup Kasir): tiap kategori bisa dibuka, setiap baris menampilkan sumber charge
 * capture (unit/langkah asal) dan kapan tertangkap. Total = jumlah baris (bigint).
 */
export function BillLines({ lines, total }: { lines: readonly ChargeItem[]; total: bigint }) {
  const groups = groupLines(lines);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const allOpen = groups.every((g) => open[g.id]);
  const toggleAll = () => setOpen(allOpen ? {} : Object.fromEntries(groups.map((g) => [g.id, true])));

  return (
    <section
      aria-label="Rincian tagihan"
      className="overflow-hidden rounded-card border border-line bg-white"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
        <span className="font-semibold">Rincian tarif RS · {lines.length} baris</span>
        <button
          type="button"
          onClick={toggleAll}
          aria-expanded={allOpen}
          className="min-h-11 cursor-pointer rounded-control border border-line-strong bg-white px-3 font-[inherit] text-small font-medium"
        >
          {allOpen ? 'Tutup semua kategori' : 'Buka semua kategori'}
        </button>
      </div>
      <div
        className={cx(GRID, 'bg-[#F8FAFB] px-4 py-2 text-caption font-semibold text-ink-500')}
        aria-hidden="true"
      >
        <span>Kategori</span>
        <span>Item</span>
        <span className="text-right">Jumlah</span>
        <span className="text-right">Sumber</span>
      </div>
      {groups.map((g) => {
        const isOpen = !!open[g.id];
        return (
          <div key={g.id}>
            <button
              type="button"
              aria-expanded={isOpen}
              aria-controls={`kategori-${g.id}`}
              onClick={() => setOpen((o) => ({ ...o, [g.id]: !o[g.id] }))}
              className={cx(
                GRID,
                'min-h-11 w-full cursor-pointer border-0 border-b border-[#EEF1F4] px-4 py-2 text-left font-[inherit] text-ink-900',
                isOpen ? 'bg-[#F8FAFB]' : 'bg-white',
              )}
            >
              <span className="flex min-w-0 items-center gap-2">
                <Icon name={isOpen ? 'chevronDown' : 'chevronRight'} size={14} />
                <span className="font-medium">{g.label}</span>
              </span>
              <span className="text-ink-700">{g.count}</span>
              <span className="text-right font-mono">{formatRupiah(g.amount)}</span>
              <span className="truncate text-right text-caption text-ink-500">{g.sources.join(', ')}</span>
            </button>
            {isOpen && (
              <ul id={`kategori-${g.id}`} className="m-0 list-none bg-[#FAFBFC] p-0">
                {g.lines.map((l) => (
                  <li
                    key={l.id}
                    data-line-amount={l.amount}
                    className={cx(GRID, 'border-b border-[#EEF1F4] px-4 py-2 text-small')}
                  >
                    <span className="flex min-w-0 flex-col pl-5 text-ink-700">
                      <span className="break-words">
                        {l.name}
                        {l.manual && (
                          <Chip tone="warning" className="ml-1.5">
                            Manual
                          </Chip>
                        )}
                      </span>
                      {l.manual && l.reason && (
                        <span className="text-caption text-ink-500">Alasan: {l.reason}</span>
                      )}
                    </span>
                    <span className="text-ink-500">
                      {l.qty}×
                      {l.unitPrice ? (
                        <span className="block text-caption">
                          @{formatRupiah(BigInt(l.unitPrice)).replace('Rp ', '')}
                        </span>
                      ) : null}
                    </span>
                    <span className="text-right font-mono text-ink-700">
                      {formatRupiah(BigInt(l.amount))}
                    </span>
                    <span className="text-right text-caption text-ink-500">
                      {l.source}
                      {l.when ? ` · ${l.when}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
      <div className="flex items-center justify-between gap-2 bg-[#F8FAFB] px-4 py-3 font-semibold">
        <span>Total tarif RS</span>
        <span aria-live="polite" data-total-amount={total.toString()} className="font-mono">
          {formatRupiah(total)}
        </span>
      </div>
    </section>
  );
}
