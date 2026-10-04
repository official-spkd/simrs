'use client';

import { type ExpiryAlert, formatJam, formatRupiah, sumRupiah } from '@simrs/shared';
import { Button, Chip } from '@simrs/ui';
import { useState } from 'react';
import { daysUntil, formatRupiahShort } from '@/lib/manajemen';

/**
 * Kedaluwarsa ≤ 90 hari (FEFO, mockup Logistik): pindahkan ke depo pemakai terbesar atau retur ke distributor.
 * Tindakan di mode presentasi hanya dicatat di layar ini (simulasi, tidak disimpan).
 */
export function ExpiryPanel({ items, today }: { items: ExpiryAlert[]; today: string }) {
  const [done, setDone] = useState<Record<string, string>>({});
  const total = sumRupiah(items.map((e) => BigInt(e.value)));
  const act = (id: string, text: string) =>
    setDone((cur) => ({ ...cur, [id]: `${text} · ${formatJam(new Date())} (simulasi, tidak disimpan)` }));
  return (
    <section
      aria-labelledby="ed-judul"
      className="flex flex-col gap-3 rounded-card border border-line bg-white p-4"
    >
      <span className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="ed-judul" className="m-0 text-base font-semibold">
          Kedaluwarsa ≤ 90 hari
        </h2>
        <span className="font-mono font-semibold text-warning" title={formatRupiah(total)}>
          {formatRupiahShort(total)}
        </span>
      </span>
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {items.map((e) => {
          const days = daysUntil(e.expiry, today);
          const status = done[e.id];
          return (
            <li
              key={e.id}
              className="flex flex-col gap-1.5 border-b border-[#EEF1F4] pb-3 last:border-0 last:pb-0"
            >
              <span className="flex flex-wrap items-center justify-between gap-2 text-small">
                <span className="font-medium text-ink-900">
                  {e.itemName} · {e.qty} {e.unit}
                </span>
                <Chip tone={days <= 30 ? 'danger' : 'warning'}>ED {days} hari</Chip>
              </span>
              <span className="text-caption text-ink-500">
                Batch {e.batch} · nilai {formatRupiah(BigInt(e.value))}
              </span>
              <span
                className={status ? 'text-[12.5px] font-semibold text-success' : 'text-[12.5px] text-ink-700'}
              >
                {status ?? e.suggestion}
              </span>
              {!status && (
                <span className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    onClick={() => act(e.id, `Dipindahkan ke ${e.moveTo} · stok depo diperbarui`)}
                  >
                    Pindahkan ke {e.moveTo}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => act(e.id, 'Diretur ke distributor · menunggu nota kredit')}
                  >
                    Retur ke distributor
                  </Button>
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <span className="text-caption text-ink-500">
        Dispensing memakai FEFO: batch dengan kedaluwarsa terdekat keluar lebih dulu.
      </span>
    </section>
  );
}
