'use client';

import { formatRupiah, type ReconRow } from '@simrs/shared';
import { Button, Chip, type ChipTone, cx, FilterChip } from '@simrs/ui';
import Link from 'next/link';
import { type ReactNode, useState } from 'react';
import { digits, formatWhen, RECON_STATUS_LABEL, type ReconTotals } from '@/lib/btn';
import { RekonException } from './rekon-exception';

const TONE: Record<ReconRow['status'], ChipTone> = {
  cocok: 'success',
  'menunggu-settlement': 'info',
  'menunggu-data': 'neutral',
  'belum-dicocokkan': 'warning',
  pengecualian: 'danger',
};

function Cell({ label, src, bad }: { label: string; src: ReconRow['kasir']; bad: boolean }) {
  const missing = src.amount === null;
  return (
    <span className="flex min-w-0 flex-col @2xl:items-end">
      {/* Label kolom tetap terbaca pembaca layar di tata letak lebar (kepala tabel aria-hidden). */}
      <span className="text-caption text-ink-500 @2xl:sr-only">{label}</span>
      <span
        className={cx(
          'font-mono',
          bad ? 'font-semibold text-danger' : missing ? 'text-ink-500' : 'text-ink-900',
        )}
      >
        {missing ? '—' : digits(BigInt(src.amount ?? '0'))}
        {bad && <span className="sr-only"> (selisih)</span>}
      </span>
      {src.note && (
        <span className={cx('text-caption', bad ? 'text-danger' : 'text-ink-500')}>{src.note}</span>
      )}
    </span>
  );
}

/** Sel yang berbeda dari nilai mayoritas ketiga sumber pada pengecualian terbuka (ditandai merah, mockup). */
function oddCells(r: ReconRow): Record<'kasir' | 'tpdi' | 'bank', boolean> {
  const none = { kasir: false, tpdi: false, bank: false };
  if (!r.exception || r.exception.resolution) return none;
  const vals = { kasir: r.kasir.amount, tpdi: r.tpdi.amount, bank: r.bank.amount };
  const count = new Map<string, number>();
  for (const v of Object.values(vals)) if (v !== null) count.set(v, (count.get(v) ?? 0) + 1);
  const major = [...count.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!major || major[1] < 2) {
    // Hanya satu sumber yang mencatat (mis. transfer tanpa referensi): sisi yang kosong yang janggal.
    return { kasir: vals.kasir === null, tpdi: vals.tpdi === null, bank: vals.bank === null };
  }
  return {
    kasir: vals.kasir !== major[0],
    tpdi: vals.tpdi !== major[0],
    bank: vals.bank !== major[0],
  };
}

/** Tab Rekonsiliasi 3 arah: kasir SIM RS ↔ laporan TPDI ↔ mutasi BTN; pengecualian wajib dijelaskan. */
export function RekonTab({
  rows,
  totals,
  account,
  runNote,
  flash,
  busy,
  onRun,
  onResolve,
  journalHref,
  scenarioControls,
}: {
  rows: readonly ReconRow[];
  totals: ReconTotals;
  account: string;
  runNote: string;
  flash: string | null;
  busy: boolean;
  onRun: () => void;
  onResolve: (row: ReconRow, actionId: string, note: string) => void;
  journalHref: string | null;
  scenarioControls: ReactNode;
}) {
  const [onlyOpen, setOnlyOpen] = useState(false);
  const visible = rows.filter(
    (r) => !onlyOpen || r.status === 'menunggu-settlement' || (r.exception && !r.exception.resolution),
  );
  const summary: Array<[string, bigint, boolean]> = [
    ['Dana masuk (mutasi BTN)', totals.bankIn, false],
    ['Tercatat SIM RS', totals.recorded, false],
    ['Selisih belum dijelaskan', totals.unexplained, true],
  ];
  return (
    <section
      aria-label="Rekonsiliasi tiga arah"
      className="@container flex flex-col gap-3 rounded-card border border-line bg-white p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <span className="flex min-w-0 flex-[1_1_280px] flex-col">
          <span className="font-semibold">Rekonsiliasi 3 arah · hari ini</span>
          <span className="text-small text-ink-700">
            Kasir SIM RS ↔ laporan TPDI ↔ mutasi BTN {account} (API H2H). {runNote}
          </span>
        </span>
        <dl className="m-0 flex flex-wrap gap-x-5 gap-y-1">
          {summary.map(([k, v, diff]) => (
            <div key={k} className="flex flex-col">
              <dt className="text-caption text-ink-500">{k}</dt>
              <dd
                className={cx(
                  'm-0 font-mono font-semibold',
                  diff && (v === 0n ? 'text-success' : 'text-danger'),
                )}
              >
                {formatRupiah(v)}
              </dd>
            </div>
          ))}
        </dl>
        <Button variant="primary" disabled={busy} onClick={onRun}>
          Jalankan rekonsiliasi
        </Button>
      </div>
      {flash && (
        <div
          role="status"
          className="rounded-control border border-zamrud-200 bg-zamrud-50 px-3 py-2 text-small text-success"
        >
          {flash}
        </div>
      )}
      {scenarioControls}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span role="group" aria-label="Filter baris" className="flex flex-wrap gap-1.5">
          <FilterChip selected={!onlyOpen} onClick={() => setOnlyOpen(false)}>
            Semua baris
          </FilterChip>
          <FilterChip selected={onlyOpen} onClick={() => setOnlyOpen(true)}>
            Perlu tindakan
          </FilterChip>
        </span>
        {journalHref && (
          <Link href={journalHref} className="text-small font-semibold">
            Lihat jurnal di Akuntansi
          </Link>
        )}
      </div>
      <div
        aria-hidden="true"
        className="hidden grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))_minmax(0,1.1fr)] gap-3 border-b border-line pb-1.5 text-caption font-semibold text-ink-500 @2xl:grid"
      >
        <span>Transaksi</span>
        <span className="text-right">Kasir SIM RS (Rp)</span>
        <span className="text-right">Laporan TPDI (Rp)</span>
        <span className="text-right">Mutasi BTN (Rp)</span>
        <span className="text-right">Status</span>
      </div>
      <ul aria-label="Baris rekonsiliasi" className="m-0 flex list-none flex-col gap-2 p-0">
        {visible.map((r) => {
          const ex = r.exception;
          const open = !!ex && !ex.resolution;
          const status =
            open && ex ? `Selisih ${formatRupiah(BigInt(ex.adjustment))}` : RECON_STATUS_LABEL[r.status];
          const done = ex?.resolution;
          const odd = oddCells(r);
          return (
            <li
              key={r.id}
              className={cx('flex flex-col gap-2 border-b border-line pb-2', open && 'bg-koral-50')}
            >
              <div className="grid grid-cols-2 gap-3 @2xl:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))_minmax(0,1.1fr)]">
                <span className="col-span-2 flex min-w-0 flex-col @2xl:col-span-1">
                  <span className="font-semibold">
                    {r.label}
                    {r.scenario && <span className="font-normal text-brand-700"> · skenario</span>}
                  </span>
                  <span className="text-caption text-ink-500">{r.source}</span>
                </span>
                <Cell label="Kasir SIM RS" src={r.kasir} bad={odd.kasir} />
                <Cell label="Laporan TPDI" src={r.tpdi} bad={odd.tpdi} />
                <Cell label="Mutasi BTN" src={r.bank} bad={odd.bank} />
                <span className="flex flex-col items-start gap-0.5 @2xl:items-end">
                  <Chip tone={open ? 'danger' : done ? 'success' : TONE[r.status]}>
                    {done ? 'Ditangani' : status}
                  </Chip>
                  <span className="text-caption text-ink-500">
                    {open ? 'perlu tindakan' : done ? formatWhen(done.at) : r.note}
                  </span>
                </span>
              </div>
              {open && <RekonException row={r} busy={busy} onApply={(a, n) => onResolve(r, a, n)} />}
              {done && ex && (
                <span className="text-caption text-success">
                  ✓ {ex.actions.find((a) => a.id === done.actionId)?.label} · {formatWhen(done.at)} · oleh{' '}
                  {done.by} · catatan: “{done.note}” · tercatat di jejak audit
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {visible.length === 0 && (
        <p className="m-0 text-center text-small text-ink-500">Tidak ada selisih yang perlu ditangani.</p>
      )}
      <span className="text-caption text-ink-500">
        Pencocokan otomatis berdasarkan no. tagihan, idempotency key TPDI, dan referensi mutasi BTN. Setiap
        tindakan atas selisih tercatat di jejak audit dan membentuk jurnal di Akuntansi.
      </span>
    </section>
  );
}
