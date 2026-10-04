'use client';

import { PAYMENT_STATUSES, type PaymentChannel, type PaymentTransaction } from '@simrs/shared';
import { Chip, cx, FilterChip } from '@simrs/ui';
import { type ReactNode, useState } from 'react';
import { CHANNEL_LABEL, digits, formatWhen, STATUS_LABEL, STATUS_TONE } from '@/lib/btn';

const CHANNEL_FILTERS: ReadonlyArray<{ id: 'semua' | PaymentChannel; label: string }> = [
  { id: 'semua', label: 'Semua kanal' },
  { id: 'VA', label: 'VA BTN' },
  { id: 'QRIS', label: 'QRIS' },
  { id: 'EDC', label: 'EDC BTN' },
];

/** Tab Transaksi: daftar tagihan VA/QRIS/EDC (cari, filter kanal dan status) + panel detail di kanan. */
export function TransaksiTab({
  txs,
  selectedId,
  onSelect,
  detail,
}: {
  txs: readonly PaymentTransaction[];
  selectedId: string;
  onSelect: (id: string) => void;
  detail: ReactNode;
}) {
  const [q, setQ] = useState('');
  const [channel, setChannel] = useState<'semua' | PaymentChannel>('semua');
  const [status, setStatus] = useState('semua');
  const needle = q.trim().toLowerCase();
  const rows = txs.filter((t) => {
    if (channel !== 'semua' && t.channel !== channel) return false;
    if (status !== 'semua' && t.status !== status) return false;
    const hay = `${t.patient.name} ${t.invoiceNo} ${t.reference ?? ''} ${t.externalRef ?? ''}`.toLowerCase();
    return !needle || hay.includes(needle);
  });
  return (
    <div className="flex flex-wrap items-start gap-4">
      <section
        aria-label="Daftar transaksi"
        className="flex min-w-0 flex-[999_1_560px] flex-col gap-2 rounded-card border border-line bg-white p-3"
      >
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex min-w-0 flex-[1_1_220px] flex-col gap-1 text-small font-semibold text-ink-700">
            Cari transaksi
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Pasien, no. tagihan, atau referensi"
              className="h-11 rounded-control border border-line-strong bg-white px-3 font-[inherit] font-normal text-ink-900"
            />
          </label>
          <label className="flex flex-col gap-1 text-small font-semibold text-ink-700">
            Status
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="h-11 rounded-control border border-line-strong bg-white px-2 font-[inherit] font-normal text-ink-900"
            >
              <option value="semua">Semua status</option>
              {PAYMENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div role="group" aria-label="Filter kanal" className="flex flex-wrap gap-1.5">
          {CHANNEL_FILTERS.map((c) => (
            <FilterChip key={c.id} selected={channel === c.id} onClick={() => setChannel(c.id)}>
              {c.label}
            </FilterChip>
          ))}
        </div>
        <div
          aria-hidden="true"
          className="hidden grid-cols-[64px_minmax(0,1fr)_76px_104px_128px] gap-3 border-b border-line px-2 pb-1.5 text-caption font-semibold text-ink-500 md:grid"
        >
          <span>Waktu</span>
          <span>Pasien · tagihan</span>
          <span>Kanal</span>
          <span className="text-right">Nominal (Rp)</span>
          <span className="text-right">Status</span>
        </div>
        <ul className="m-0 flex list-none flex-col p-0">
          {rows.map((t) => {
            const on = t.id === selectedId;
            const when = formatWhen(t.paidAt ?? t.createdAt ?? '2026-10-05T00:00:00+07:00');
            return (
              <li key={t.id}>
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => onSelect(t.id)}
                  className={cx(
                    'grid min-h-12 w-full cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 border-0 border-b border-line px-2 py-2 text-left font-[inherit] md:grid-cols-[64px_minmax(0,1fr)_76px_104px_128px]',
                    on ? 'bg-[#EEF6F5] shadow-[inset_3px_0_0_#0F766E]' : 'bg-white',
                  )}
                >
                  <span className="font-mono text-caption text-ink-700 max-md:hidden">
                    {t.createdAt ? when : '—'}
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate font-semibold">
                      {t.patient.name}
                      {t.scenario && <span className="font-normal text-brand-700"> · skenario</span>}
                    </span>
                    <span className="truncate font-mono text-caption text-ink-500">
                      {t.invoiceNo}
                      <span className="md:hidden">
                        {' '}
                        · {CHANNEL_LABEL[t.channel]}
                        {t.createdAt ? ` · ${when}` : ''}
                      </span>
                    </span>
                  </span>
                  <span className="text-small max-md:hidden">{CHANNEL_LABEL[t.channel]}</span>
                  <span className="text-right font-mono max-md:hidden">{digits(BigInt(t.amount))}</span>
                  <span className="flex flex-col items-end gap-1">
                    <span className="font-mono text-small md:hidden">{digits(BigInt(t.amount))}</span>
                    <Chip tone={STATUS_TONE[t.status]}>{STATUS_LABEL[t.status]}</Chip>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {rows.length === 0 && (
          <p className="m-0 px-2 py-6 text-center text-small text-ink-500">
            Tidak ada transaksi yang cocok dengan filter dan pencarian.
          </p>
        )}
        <span className="px-2 text-caption text-ink-500">
          Menampilkan {rows.length} dari {txs.length} transaksi contoh · pilih baris untuk melihat jejak
          status dan webhook
        </span>
      </section>
      {detail}
    </div>
  );
}
