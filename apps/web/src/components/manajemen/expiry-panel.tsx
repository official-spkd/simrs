'use client';

import { type ExpiryAlert, formatRupiah, sumRupiah } from '@simrs/shared';
import { Button, Chip } from '@simrs/ui';
import { daysUntil, formatRupiahShort } from '@/lib/manajemen';

export type ExpiryAction = 'pindah' | 'retur';

/**
 * Kedaluwarsa ≤ 90 hari (FEFO, mockup Logistik): pindahkan ke depo pemakai terbesar atau retur ke distributor.
 * Tindakan tersimpan di toko demo (domain `logistik`); `done` = teks tindakan tersimpan per batch.
 */
export function ExpiryPanel({
  items,
  today,
  done,
  pending,
  onAct,
}: {
  items: ExpiryAlert[];
  today: string;
  done: Readonly<Record<string, string>>;
  pending: boolean;
  onAct: (id: string, action: ExpiryAction) => void;
}) {
  const total = sumRupiah(items.map((e) => BigInt(e.value)));
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
                aria-live="polite"
                className={status ? 'text-[12.5px] font-semibold text-success' : 'text-[12.5px] text-ink-700'}
              >
                {status ?? e.suggestion}
              </span>
              {!status && (
                <span className="flex flex-wrap gap-2">
                  <Button disabled={pending} onClick={() => onAct(e.id, 'pindah')}>
                    Pindahkan ke {e.moveTo}
                  </Button>
                  <Button variant="ghost" disabled={pending} onClick={() => onAct(e.id, 'retur')}>
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
