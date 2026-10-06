'use client';

import { formatJam, formatTanggal } from '@simrs/shared';
import { Button, Chip, cx } from '@simrs/ui';
import { useId, useState } from 'react';
import {
  batchesIn,
  type DepoMaster,
  type DepoAction,
  type DepoState,
  expiryStatus,
  expiryText,
  fefoPlan,
  MOVEMENT_LABEL,
  opnameDiffs,
  qtyOf,
  usableStock,
} from '@/lib/penunjang-depo';
import { depotCheckKey } from '@/lib/penunjang-demo';
import type { DepoData } from '@/lib/server/data/penunjang-lanjut';
import type { DepoRun } from './depo-workspace';

interface PanelProps {
  state: DepoState;
  master: DepoMaster;
  today: string;
  depotId: string;
  busy: boolean;
  run: DepoRun;
  userName: string;
  userId: string;
  check: (action: Extract<DepoAction, { type: 'keluar' }>) => void;
  checks: DepoData['checks'];
}

const inputCls = 'h-11 rounded-control border border-line-strong bg-white px-3 font-[inherit]';
const labelCls = 'text-small font-semibold text-ink-700';
const depotName = (m: DepoMaster, id: string) => m.depots.find((d) => d.id === id)?.name ?? id;
const batchOf = (m: DepoMaster, id: string) => m.batches.find((b) => b.id === id);

function ExpiryChip({ expiry, today }: { expiry: string; today: string }) {
  const { status } = expiryStatus(expiry, today);
  const tone = status === 'kedaluwarsa' ? 'danger' : status === 'segera' ? 'warning' : 'success';
  const label = status === 'kedaluwarsa' ? 'Kedaluwarsa' : status === 'segera' ? 'Segera ED' : 'Aman';
  return (
    <Chip tone={tone}>
      {label} · {expiryText(expiry, today)}
    </Chip>
  );
}

/** Saldo per item → batch (urut FEFO) dengan ED dan aksi karantina untuk batch kedaluwarsa. */
export function StockPanel({ state, master, today, depotId, busy, run }: PanelProps) {
  const items = master.items.filter((i) => batchesIn(state, master, depotId, i.id).length > 0);
  if (items.length === 0)
    return (
      <p className="m-0 rounded-card border border-line bg-white p-4 text-small">
        Depo ini belum memegang stok.
      </p>
    );
  return (
    <div className="overflow-x-auto rounded-card border border-line bg-white">
      <table className="w-full min-w-[680px] border-collapse text-small">
        <caption className="sr-only">
          Stok per batch di {depotName(master, depotId)}, urut ED terdekat (FEFO)
        </caption>
        <thead>
          <tr className="border-b border-line bg-subtle text-left text-caption text-ink-500">
            <th className="px-3 py-2 font-semibold">Obat / batch</th>
            <th className="px-3 py-2 font-semibold">Kedaluwarsa</th>
            <th className="px-3 py-2 text-right font-semibold">Jumlah</th>
            <th className="px-3 py-2 font-semibold">Tindakan</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => {
            const usable = usableStock(state, master, depotId, i.id, today);
            return [
              <tr key={i.id} className="border-b border-line bg-canvas">
                <th scope="row" colSpan={2} className="px-3 py-2 text-left font-semibold">
                  {i.name}{' '}
                  <span className="font-normal text-ink-500">
                    · {i.kfa ? `KFA ${i.kfa}` : 'KFA belum dipetakan'}
                    {i.highAlert ? ' · high alert' : ''}
                  </span>
                </th>
                <td className="px-3 py-2 text-right font-mono font-semibold">
                  {usable} {i.unit}
                </td>
                <td className="px-3 py-2">
                  {usable < i.minPerDepot ? (
                    <Chip tone="warning">di bawah minimum {i.minPerDepot}</Chip>
                  ) : (
                    <span className="text-caption text-ink-500">min. {i.minPerDepot}</span>
                  )}
                </td>
              </tr>,
              ...batchesIn(state, master, depotId, i.id).map((b, idx) => {
                const expired = expiryStatus(b.expiry, today).status === 'kedaluwarsa';
                return (
                  <tr key={b.id} className={cx('border-b border-line', expired && 'bg-danger-bg')}>
                    <td className="px-3 py-2 pl-6">
                      <span className="font-mono">{b.batchNo}</span>
                      {idx === 0 && !expired && (
                        <span className="text-caption text-brand-700"> · keluar berikutnya (FEFO)</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span className="flex flex-wrap items-center gap-2">
                        {formatTanggal(`${b.expiry}T00:00:00+07:00`)}{' '}
                        <ExpiryChip expiry={b.expiry} today={today} />
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right font-mono">{b.qty}</td>
                    <td className="px-3 py-2">
                      {expired ? (
                        <Button
                          size="sm"
                          variant="danger"
                          disabled={busy}
                          onClick={() => run({ type: 'karantina', depotId, batchId: b.id })}
                        >
                          Pindahkan ke karantina
                        </Button>
                      ) : (
                        <span className="text-caption text-ink-500">{b.supplier}</span>
                      )}
                    </td>
                  </tr>
                );
              }),
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Pengeluaran ke pasien/ruangan: rencana FEFO otomatis; pilih batch lain = override beralasan. */
export function DispensePanel({
  state,
  master,
  today,
  depotId,
  busy,
  run,
  requests,
  userId,
  check,
  checks,
}: PanelProps & { requests: DepoData['requests'] }) {
  const id = useId();
  const items = master.items.filter((i) => batchesIn(state, master, depotId, i.id).length > 0);
  const [itemId, setItemId] = useState(items[0]?.id ?? '');
  const [qty, setQty] = useState('1');
  const [ref, setRef] = useState('');
  const [override, setOverride] = useState(false);
  const [batchId, setBatchId] = useState('');
  const [reason, setReason] = useState('');
  const current = items.some((i) => i.id === itemId) ? itemId : (items[0]?.id ?? '');
  const highAlert = master.items.find((i) => i.id === current)?.highAlert ?? false;
  const n = Number(qty);
  const plan = fefoPlan(state, master, depotId, current, Number.isInteger(n) && n > 0 ? n : 0, today);
  const batches = batchesIn(state, master, depotId, current);
  const unit = master.items.find((i) => i.id === current)?.unit ?? '';
  const action: Extract<DepoAction, { type: 'keluar' }> = {
    type: 'keluar',
    depotId,
    itemId: current,
    qty: n,
    ref: ref.trim() || 'Permintaan ruangan',
    ...(override && batchId ? { batchId, reason } : {}),
  };
  const recorded = checks[depotCheckKey(action)] ?? [];
  const waiting = requests.filter((r) => r.depotId === depotId);

  const reset = () => {
    setQty('1');
    setRef('');
    setOverride(false);
    setBatchId('');
    setReason('');
  };

  if (items.length === 0)
    return (
      <p className="m-0 rounded-card border border-line bg-white p-4 text-small">
        Depo ini belum memegang stok.
      </p>
    );
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
      <section
        aria-label="Permintaan menunggu"
        className="flex flex-col gap-2 rounded-card border border-line bg-white p-4"
      >
        <h3 className="m-0 text-base font-semibold">Permintaan menunggu disiapkan</h3>
        {waiting.length === 0 ? (
          <p className="m-0 text-small text-ink-700">Tidak ada permintaan untuk depo ini.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {waiting.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-control border border-line p-2.5 text-small"
              >
                <span className="min-w-0 flex-1">
                  <span className="font-semibold">{master.items.find((i) => i.id === r.itemId)?.name}</span> ·{' '}
                  {r.qty}
                  <span className="block text-ink-500">{r.ref}</span>
                </span>
                <Button
                  size="sm"
                  onClick={() => {
                    reset();
                    setItemId(r.itemId);
                    setQty(String(r.qty));
                    setRef(r.ref);
                  }}
                >
                  Siapkan
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <form
        aria-label="Pengeluaran stok"
        className="flex flex-col gap-3 rounded-card border border-line bg-white p-4"
        onSubmit={(e) => {
          e.preventDefault();
          run(action, reset);
        }}
      >
        <h3 className="m-0 text-base font-semibold">Keluarkan dari {depotName(master, depotId)}</h3>
        <div className="flex flex-wrap gap-3">
          <div className="flex min-w-[220px] flex-[2] flex-col gap-1">
            <label htmlFor={`${id}-obat`} className={labelCls}>
              Obat
            </label>
            <select
              id={`${id}-obat`}
              value={current}
              onChange={(e) => setItemId(e.target.value)}
              className={inputCls}
            >
              {items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex min-w-[100px] flex-1 flex-col gap-1">
            <label htmlFor={`${id}-qty`} className={labelCls}>
              Jumlah ({unit})
            </label>
            <input
              id={`${id}-qty`}
              inputMode="numeric"
              value={qty}
              onChange={(e) => setQty(e.target.value.replace(/\D/g, ''))}
              className={cx(inputCls, 'font-mono')}
            />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-ref`} className={labelCls}>
            Untuk (resep / UDD / ruangan)
          </label>
          <input
            id={`${id}-ref`}
            value={ref}
            maxLength={120}
            onChange={(e) => setRef(e.target.value)}
            className={inputCls}
          />
        </div>
        {highAlert && (
          <div className="flex flex-col gap-2 rounded-control border border-warning-border bg-warning-bg p-3">
            <p className="m-0 text-small">
              Obat high alert: pemeriksa kedua mencatat dari sesinya, kemudian petugas berbeda mengeluarkan.
              Pemeriksa: {recorded.map((c) => c.name).join(', ') || 'belum ada'}.
            </p>
            <Button
              disabled={busy || !(n > 0) || recorded.some((c) => c.userId === userId)}
              onClick={() => check(action)}
            >
              Catat pemeriksaan saya
            </Button>
          </div>
        )}
        <div className="flex flex-col gap-1.5 rounded-control bg-canvas p-3 text-small" aria-live="polite">
          <span className="font-semibold">Rencana FEFO (batch ED terdekat keluar dulu)</span>
          {plan.allocations.length === 0 ? (
            <span className="text-ink-700">Isi jumlah untuk melihat batch yang keluar.</span>
          ) : (
            plan.allocations.map((a) => {
              const b = batchOf(master, a.batchId);
              return (
                <span key={a.batchId}>
                  <span className="font-mono">{b?.batchNo}</span> · {a.qty} {unit} · ED{' '}
                  {b ? formatTanggal(`${b.expiry}T00:00:00+07:00`) : ''}
                </span>
              );
            })
          )}
          {plan.shortBy > 0 && (
            <span className="font-semibold text-danger">
              Kurang {plan.shortBy} {unit}: stok yang boleh dipakai tidak cukup (batch kedaluwarsa tidak
              dihitung).
            </span>
          )}
        </div>
        <label className="flex min-h-11 cursor-pointer items-center gap-2 text-small">
          <input
            type="checkbox"
            checked={override}
            onChange={(e) => setOverride(e.target.checked)}
            className="size-4 accent-brand-600"
          />
          Pilih batch lain (override FEFO, wajib alasan)
        </label>
        {override && (
          <div className="flex flex-col gap-2 rounded-control border border-warning-border bg-warning-bg p-3">
            <label htmlFor={`${id}-batch`} className={labelCls}>
              Batch pilihan
            </label>
            <select
              id={`${id}-batch`}
              value={batchId}
              onChange={(e) => setBatchId(e.target.value)}
              className={inputCls}
            >
              <option value="">Pilih batch</option>
              {batches.map((b) => {
                const expired = expiryStatus(b.expiry, today).status === 'kedaluwarsa';
                return (
                  <option key={b.id} value={b.id} disabled={expired}>
                    {b.batchNo} · sisa {b.qty} ·{' '}
                    {expired ? 'kedaluwarsa, tidak bisa dipilih' : expiryText(b.expiry, today)}
                  </option>
                );
              })}
            </select>
            <label htmlFor={`${id}-alasan`} className={labelCls}>
              Alasan override (minimal 10 karakter, tercatat di kartu stok)
            </label>
            <textarea
              id={`${id}-alasan`}
              rows={2}
              value={reason}
              maxLength={300}
              onChange={(e) => setReason(e.target.value)}
              className="rounded-control border border-line-strong bg-white px-3 py-2 font-[inherit]"
            />
          </div>
        )}
        <span className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="primary" disabled={busy || !(n > 0) || (override && !batchId)}>
            Keluarkan
          </Button>
          {override && !batchId && (
            <span className="text-caption text-ink-500">Pilih batch dulu atau matikan override.</span>
          )}
        </span>
      </form>
    </div>
  );
}

/** Mutasi dua langkah: kirim (FEFO dari depo asal) → terima oleh petugas lain di depo tujuan. */
export function TransferPanel({ state, master, today, depotId, busy, run, userName }: PanelProps) {
  const id = useId();
  const [to, setTo] = useState(master.depots.find((d) => d.id !== depotId)?.id ?? '');
  const items = master.items.filter((i) => usableStock(state, master, depotId, i.id, today) > 0);
  const [itemId, setItemId] = useState(items[0]?.id ?? '');
  const [qty, setQty] = useState('');
  const current = items.some((i) => i.id === itemId) ? itemId : (items[0]?.id ?? '');
  const dest = to === depotId ? (master.depots.find((d) => d.id !== depotId)?.id ?? '') : to;
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <form
        aria-label="Kirim mutasi"
        className="flex flex-col gap-3 rounded-card border border-line bg-white p-4"
        onSubmit={(e) => {
          e.preventDefault();
          run({ type: 'kirim', from: depotId, to: dest, itemId: current, qty: Number(qty) }, () =>
            setQty(''),
          );
        }}
      >
        <h3 className="m-0 text-base font-semibold">Langkah 1 · Kirim dari {depotName(master, depotId)}</h3>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-tujuan`} className={labelCls}>
            Depo tujuan
          </label>
          <select
            id={`${id}-tujuan`}
            value={dest}
            onChange={(e) => setTo(e.target.value)}
            className={inputCls}
          >
            {master.depots
              .filter((d) => d.id !== depotId)
              .map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
          </select>
        </div>
        <div className="flex flex-wrap gap-3">
          <div className="flex min-w-[200px] flex-[2] flex-col gap-1">
            <label htmlFor={`${id}-obat`} className={labelCls}>
              Obat
            </label>
            <select
              id={`${id}-obat`}
              value={current}
              onChange={(e) => setItemId(e.target.value)}
              className={inputCls}
            >
              {items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name} (tersedia {usableStock(state, master, depotId, i.id, today)})
                </option>
              ))}
            </select>
          </div>
          <div className="flex min-w-[100px] flex-1 flex-col gap-1">
            <label htmlFor={`${id}-qty`} className={labelCls}>
              Jumlah
            </label>
            <input
              id={`${id}-qty`}
              inputMode="numeric"
              value={qty}
              onChange={(e) => setQty(e.target.value.replace(/\D/g, ''))}
              className={cx(inputCls, 'font-mono')}
            />
          </div>
        </div>
        <span className="text-caption text-ink-500">
          Batch dipilih FEFO di depo asal; stok tujuan bertambah setelah diterima.
        </span>
        <Button
          type="submit"
          variant="primary"
          disabled={busy || !current || !(Number(qty) > 0)}
          className="self-start"
        >
          Kirim mutasi
        </Button>
      </form>
      <section
        aria-label="Mutasi dalam perjalanan"
        className="flex flex-col gap-2 rounded-card border border-line bg-white p-4"
      >
        <h3 className="m-0 text-base font-semibold">Langkah 2 · Terima di depo tujuan</h3>
        {state.transfers.length === 0 ? (
          <p className="m-0 text-small text-ink-700">Belum ada mutasi hari ini.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {state.transfers.map((t) => {
              const item = master.items.find((i) => i.id === t.itemId);
              const total = t.lines.reduce((a, l) => a + l.qty, 0);
              return (
                <li
                  key={t.id}
                  className="flex flex-col gap-2 rounded-control border border-line p-3 text-small"
                >
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold">
                      {t.id} · {item?.name} · {total} {item?.unit}
                    </span>
                    <Chip tone={t.status === 'dikirim' ? 'warning' : 'success'}>
                      {t.status === 'dikirim'
                        ? 'Dalam perjalanan'
                        : `Diterima ${t.receivedAt ? formatJam(t.receivedAt) : ''}`}
                    </Chip>
                  </span>
                  <span className="text-ink-700">
                    {depotName(master, t.from)} → {depotName(master, t.to)} · dikirim {formatJam(t.sentAt)}{' '}
                    oleh {t.sentBy} · batch{' '}
                    {t.lines.map((l) => `${batchOf(master, l.batchId)?.batchNo} (${l.qty})`).join(', ')}
                    {t.receivedBy ? ` · diterima ${t.receivedBy}` : ''}
                  </span>
                  {t.status === 'dikirim' && (
                    <span className="flex flex-wrap items-end gap-2">
                      <span className="flex min-w-[220px] flex-1 flex-col gap-1">
                        <label htmlFor={`${id}-${t.id}`} className={labelCls}>
                          Petugas penerima di {depotName(master, t.to)}
                        </label>
                        <input
                          id={`${id}-${t.id}`}
                          value={userName}
                          maxLength={120}
                          readOnly
                          className={inputCls}
                        />
                      </span>
                      <Button
                        disabled={busy}
                        onClick={() => run({ type: 'terima', transferId: t.id, receiver: userName })}
                      >
                        Konfirmasi terima
                      </Button>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

/** Stok opname: hitung fisik per batch; selisih wajib alasan lalu menjadi penyesuaian di kartu stok. */
export function OpnamePanel({ state, master, depotId, busy, run, today }: PanelProps) {
  const id = useId();
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const parsed = Object.fromEntries(
    Object.entries(counts).flatMap(([k, v]) => (v === '' ? [] : [[k, Number(v)] as const])),
  );
  const diffs = opnameDiffs(state, depotId, parsed);
  const changed = diffs.filter((d) => d.diff !== 0);
  return (
    <form
      aria-label="Stok opname"
      className="flex flex-col gap-3 rounded-card border border-line bg-white p-4"
      onSubmit={(e) => {
        e.preventDefault();
        run({ type: 'opname', depotId, counts: parsed, reason }, () => {
          setCounts({});
          setReason('');
        });
      }}
    >
      <h3 className="m-0 text-base font-semibold">Stok opname · {depotName(master, depotId)}</h3>
      <span className="text-small text-ink-700">
        Isi hitung fisik per batch. Kosong = sama dengan sistem.
      </span>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-small">
          <thead>
            <tr className="border-b border-line text-left text-caption text-ink-500">
              <th className="px-2 py-2 font-semibold">Batch</th>
              <th className="px-2 py-2 text-right font-semibold">Sistem</th>
              <th className="px-2 py-2 font-semibold">Hitung fisik</th>
              <th className="px-2 py-2 text-right font-semibold">Selisih</th>
            </tr>
          </thead>
          <tbody>
            {diffs.map((d) => {
              const b = batchOf(master, d.batchId);
              const item = master.items.find((i) => i.id === b?.itemId);
              return (
                <tr key={d.batchId} className="border-b border-line">
                  <td className="px-2 py-1.5">
                    {item?.name} · <span className="font-mono">{b?.batchNo}</span>
                    {b && expiryStatus(b.expiry, today).status === 'kedaluwarsa' && (
                      <span className="text-caption font-semibold text-danger"> · kedaluwarsa</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono">{qtyOf(state, depotId, d.batchId)}</td>
                  <td className="px-2 py-1.5">
                    <input
                      aria-label={`Hitung fisik ${b?.batchNo ?? ''}`}
                      inputMode="numeric"
                      value={counts[d.batchId] ?? ''}
                      onChange={(e) =>
                        setCounts((c) => ({ ...c, [d.batchId]: e.target.value.replace(/\D/g, '') }))
                      }
                      className={cx(inputCls, 'w-28 font-mono')}
                    />
                  </td>
                  <td
                    className={cx(
                      'px-2 py-1.5 text-right font-mono font-semibold',
                      d.diff < 0 ? 'text-danger' : d.diff > 0 ? 'text-warning' : 'text-ink-500',
                    )}
                  >
                    {d.diff > 0 ? `+${d.diff}` : d.diff}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {changed.length > 0 && (
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-alasan`} className={labelCls}>
            Alasan selisih (wajib, minimal 10 karakter)
          </label>
          <textarea
            id={`${id}-alasan`}
            rows={2}
            value={reason}
            maxLength={300}
            onChange={(e) => setReason(e.target.value)}
            className="rounded-control border border-line-strong bg-white px-3 py-2 font-[inherit]"
          />
        </div>
      )}
      <Button type="submit" variant="primary" disabled={busy} className="self-start">
        {changed.length ? `Tutup opname (${changed.length} selisih)` : 'Tutup opname tanpa selisih'}
      </Button>
    </form>
  );
}

/** Kartu stok (ledger append-only) depo terpilih, terbaru di atas. */
export function LedgerPanel({ state, master, depotId }: PanelProps) {
  const rows = state.movements.filter((m) => m.depotId === depotId);
  return (
    <div className="overflow-x-auto rounded-card border border-line bg-white">
      <table className="w-full min-w-[700px] border-collapse text-small">
        <caption className="sr-only">Kartu stok {depotName(master, depotId)}</caption>
        <thead>
          <tr className="border-b border-line bg-subtle text-left text-caption text-ink-500">
            <th className="px-3 py-2 font-semibold">Jam</th>
            <th className="px-3 py-2 font-semibold">Jenis</th>
            <th className="px-3 py-2 font-semibold">Obat / batch</th>
            <th className="px-3 py-2 text-right font-semibold">Qty</th>
            <th className="px-3 py-2 font-semibold">Rujukan · petugas</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => {
            const b = batchOf(master, m.batchId);
            return (
              <tr key={m.id} className="border-b border-line align-top">
                <td className="px-3 py-1.5 font-mono">{formatJam(m.at)}</td>
                <td className="px-3 py-1.5">{MOVEMENT_LABEL[m.kind]}</td>
                <td className="px-3 py-1.5">
                  {master.items.find((i) => i.id === b?.itemId)?.name} ·{' '}
                  <span className="font-mono">{b?.batchNo}</span>
                </td>
                <td
                  className={cx(
                    'px-3 py-1.5 text-right font-mono font-semibold',
                    m.qty < 0 ? 'text-danger' : 'text-success',
                  )}
                >
                  {m.qty > 0 ? `+${m.qty}` : m.qty}
                </td>
                <td className="px-3 py-1.5 text-ink-700">
                  {m.ref} · {m.by}
                  {m.reason && <span className="block text-caption text-warning">{m.reason}</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
