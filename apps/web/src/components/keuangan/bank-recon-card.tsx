'use client';

import { type BankRecon, formatJam, formatRupiah } from '@simrs/shared';
import { Button, Chip } from '@simrs/ui';
import Link from 'next/link';

/**
 * Rekonsiliasi bank otomatis (mockup Akuntansi): mutasi H2H BTN dicocokkan dengan transaksi kasir/klaim; selisih
 * dipadankan manual. Status dalam teks ("Cocok 100%", "2 selisih"), bukan hanya warna.
 */
export function BankReconCard({
  accounts,
  matchedAt,
  locked,
  pending,
  onMatch,
}: {
  accounts: readonly BankRecon[];
  /** Waktu pemadanan lokal per rekening. */
  matchedAt: Record<string, string>;
  locked: boolean;
  pending: boolean;
  onMatch: (accountId: string) => void;
}) {
  return (
    <section
      aria-label="Rekonsiliasi bank"
      className="flex flex-col gap-3 rounded-card border border-line bg-white p-4"
    >
      <span className="font-semibold">Rekonsiliasi bank otomatis</span>
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {accounts.map((a) => {
          const done = !!matchedAt[a.id];
          const open = !done && a.unmatched.length > 0;
          const total = a.unmatched.reduce((s, u) => s + BigInt(u.amount), 0n);
          return (
            <li key={a.id} className="flex flex-col gap-1 text-[13px]">
              <span className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">
                  {a.label} <span className="font-mono">{a.account}</span>
                </span>
                <Chip tone={open ? 'warning' : 'success'}>
                  {open ? `${a.unmatched.length} selisih` : 'Cocok 100%'}
                </Chip>
              </span>
              <span className="text-caption text-ink-500">
                {done
                  ? `${a.unmatched.length} transfer ${formatRupiah(total)} dipadankan ke batch klaim · ${matchedAt[a.id]}`
                  : `${a.note} · ${a.mutations} mutasi · sinkron ${formatJam(a.syncedAt)}`}
              </span>
              {open && (
                <>
                  <ul className="m-0 flex list-none flex-col gap-0.5 p-0 text-caption text-ink-700">
                    {a.unmatched.map((u) => (
                      <li key={u.id} className="flex justify-between gap-2">
                        <span>{u.description}</span>
                        <span className="font-mono whitespace-nowrap">{formatRupiah(BigInt(u.amount))}</span>
                      </li>
                    ))}
                  </ul>
                  <Button className="self-start" disabled={locked || pending} onClick={() => onMatch(a.id)}>
                    Padankan {a.unmatched.length} transfer ke batch klaim
                  </Button>
                </>
              )}
            </li>
          );
        })}
      </ul>
      <Link
        href="/keuangan/pembayaran"
        className="inline-flex min-h-11 items-center self-start rounded-control border border-line-strong bg-white px-3.5 text-small font-semibold text-ink-900 no-underline"
      >
        Rekonsiliasi 3 arah TPDI × BTN
      </Link>
    </section>
  );
}
