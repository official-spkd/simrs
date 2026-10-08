'use client';

import {
  formatRupiah,
  SAFETY_REASON_MIN,
  type StockBalance,
  type StockDrugView,
  type StockLocationView,
  type SupplierView,
} from '@simrs/shared';
import { Button } from '@simrs/ui';
import { useEffect, useId, useRef, useState, useTransition } from 'react';
import {
  adjustStockAction,
  receiveStockAction,
  searchStockDrugsAction,
  sendTransferAction,
} from '@/app/(staf)/penunjang/depo/actions';
import { transferableDrugs, transferPlan } from '@/lib/depo-api';
import type { Notice } from './depo-api-workspace';

const FIELD =
  'min-h-11 rounded-control border border-line-strong bg-white px-3 font-[inherit] text-small disabled:bg-muted';
const LABEL = 'flex flex-col gap-1 text-caption font-semibold text-ink-700';
const CARD = 'flex flex-col gap-3 rounded-card border border-white/95 bg-white/90 p-4 shadow-card';

interface ReceiptLine {
  key: string;
  drug: StockDrugView | null;
  batchNo: string;
  expiryDate: string;
  quantity: string;
  unitCost: string;
}

const emptyLine = (): ReceiptLine => ({
  key: crypto.randomUUID(),
  drug: null,
  batchNo: '',
  expiryDate: '',
  quantity: '',
  unitCost: '',
});

/** Pilih obat formularium lewat pencarian (server). */
function DrugPicker({
  value,
  onChange,
  disabled,
}: {
  value: StockDrugView | null;
  onChange: (d: StockDrugView | null) => void;
  disabled: boolean;
}) {
  const id = useId();
  const [q, setQ] = useState('');
  const [items, setItems] = useState<StockDrugView[]>([]);
  const seq = useRef(0);
  useEffect(() => {
    const n = ++seq.current;
    if (q.trim().length < 2 || value) {
      setItems([]);
      return;
    }
    const t = setTimeout(async () => {
      const r = await searchStockDrugsAction(q.trim());
      if (n === seq.current && r.ok) setItems(r.items);
    }, 250);
    return () => clearTimeout(t);
  }, [q, value]);
  if (value) {
    return (
      <span className="flex min-h-11 items-center gap-2 text-small">
        <span className="font-semibold">{value.name}</span>
        <Button size="sm" disabled={disabled} onClick={() => onChange(null)}>
          Ganti obat
        </Button>
      </span>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className={LABEL}>
        Obat
        <input
          id={id}
          type="search"
          autoComplete="off"
          placeholder="Ketik minimal 2 huruf"
          value={q}
          disabled={disabled}
          onChange={(e) => setQ(e.target.value)}
          className={FIELD}
        />
      </label>
      {items.length > 0 && (
        <ul aria-label="Hasil obat" className="m-0 flex list-none flex-col gap-1 p-0">
          {items.map((d) => (
            <li key={d.id}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => {
                  onChange(d);
                  setQ('');
                }}
                className="min-h-11 w-full cursor-pointer rounded-control border border-line bg-white px-3 text-left font-[inherit] text-small hover:bg-brand-50/60"
              >
                {d.name}
                {d.highAlert ? ' · kewaspadaan tinggi' : ''}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Penerimaan barang tanpa PO: pemasok, faktur, dan baris obat + batch + ED + jumlah + harga pokok per satuan. */
export function ReceiptForm({
  location,
  suppliers,
  today,
  onNotice,
}: {
  location: StockLocationView;
  suppliers: readonly SupplierView[];
  today: string;
  onNotice: (n: Notice) => void;
}) {
  const id = useId();
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? '');
  const [invoiceNo, setInvoiceNo] = useState('');
  const [lines, setLines] = useState<ReceiptLine[]>([emptyLine()]);
  const [pending, start] = useTransition();
  const set = (key: string, patch: Partial<ReceiptLine>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const lineReady = (l: ReceiptLine) =>
    l.drug !== null &&
    l.batchNo.trim().length > 0 &&
    /^\d{4}-\d{2}-\d{2}$/.test(l.expiryDate) &&
    Number.isInteger(Number(l.quantity)) &&
    Number(l.quantity) > 0 &&
    /^\d{1,18}$/.test(l.unitCost);
  const expiredLine = lines.find((l) => l.expiryDate && l.expiryDate <= today);
  const ready = supplierId && invoiceNo.trim() && lines.every(lineReady) && !expiredLine;

  return (
    <form
      aria-label="Penerimaan barang"
      className={CARD}
      onSubmit={(e) => {
        e.preventDefault();
        if (!ready) return;
        start(async () => {
          const r = await receiveStockAction(
            {
              stockLocationId: location.id,
              supplierId,
              invoiceNo: invoiceNo.trim(),
              items: lines.map((l) => ({
                drugId: l.drug?.id,
                batchNo: l.batchNo.trim(),
                expiryDate: l.expiryDate,
                quantity: Number(l.quantity),
                unitCost: l.unitCost,
              })),
            },
            crypto.randomUUID(),
          );
          if (!r.ok) return onNotice({ ok: false, text: r.message });
          const priced = r.receipt.items
            .map(
              (i) =>
                `${i.batchNo} @ ${formatRupiah(BigInt(i.unitCost))} (HPP batch ${formatRupiah(BigInt(i.batchUnitCost))})`,
            )
            .join('; ');
          onNotice({
            ok: true,
            text: `${r.receipt.receiptNo} diterima di ${location.name}: ${priced}.`,
          });
          setInvoiceNo('');
          setLines([emptyLine()]);
        });
      }}
    >
      <h2 className="m-0 text-body font-semibold">Penerimaan barang ke {location.name}</h2>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <label htmlFor={`${id}-pemasok`} className={LABEL}>
          Pemasok
          <select
            id={`${id}-pemasok`}
            value={supplierId}
            disabled={pending}
            onChange={(e) => setSupplierId(e.target.value)}
            className={FIELD}
          >
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor={`${id}-faktur`} className={LABEL}>
          Nomor faktur
          <input
            id={`${id}-faktur`}
            value={invoiceNo}
            maxLength={60}
            disabled={pending}
            onChange={(e) => setInvoiceNo(e.target.value)}
            className={FIELD}
          />
        </label>
      </div>
      <ol className="m-0 flex list-none flex-col gap-3 p-0">
        {lines.map((l, i) => (
          <li
            key={l.key}
            aria-label={`Baris ${i + 1}`}
            className="flex flex-col gap-2 border-t border-line-soft pt-3"
          >
            <DrugPicker value={l.drug} disabled={pending} onChange={(d) => set(l.key, { drug: d })} />
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              <label className={LABEL}>
                Nomor batch
                <input
                  value={l.batchNo}
                  maxLength={40}
                  disabled={pending}
                  onChange={(e) => set(l.key, { batchNo: e.target.value })}
                  className={FIELD}
                />
              </label>
              <label className={LABEL}>
                Tanggal kedaluwarsa
                <input
                  type="date"
                  value={l.expiryDate}
                  disabled={pending}
                  onChange={(e) => set(l.key, { expiryDate: e.target.value })}
                  className={FIELD}
                />
              </label>
              <label className={LABEL}>
                Jumlah
                <input
                  inputMode="numeric"
                  value={l.quantity}
                  disabled={pending}
                  onChange={(e) => set(l.key, { quantity: e.target.value.replace(/\D/g, '') })}
                  className={FIELD}
                />
              </label>
              <label className={LABEL}>
                Harga pokok per satuan (Rp)
                <input
                  inputMode="numeric"
                  value={l.unitCost}
                  disabled={pending}
                  onChange={(e) => set(l.key, { unitCost: e.target.value.replace(/\D/g, '') })}
                  className={FIELD}
                />
              </label>
            </div>
            {lines.length > 1 && (
              <Button
                size="sm"
                variant="ghost"
                className="w-fit"
                disabled={pending}
                onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
              >
                Hapus baris {i + 1}
              </Button>
            )}
          </li>
        ))}
      </ol>
      {expiredLine && (
        <p role="alert" className="m-0 text-small font-semibold text-danger">
          Batch {expiredLine.batchNo || 'baru'} sudah kedaluwarsa dan tidak boleh diterima.
        </p>
      )}
      <span className="flex flex-wrap gap-2">
        <Button disabled={pending} onClick={() => setLines((ls) => [...ls, emptyLine()])}>
          Tambah baris
        </Button>
        <Button type="submit" variant="primary" disabled={!ready || pending}>
          {pending ? 'Menyimpan…' : 'Simpan penerimaan'}
        </Button>
      </span>
    </form>
  );
}

/** Mutasi langkah kirim: obat + jumlah → batch dipilih FEFO (ED terdekat, tidak kedaluwarsa). */
export function TransferForm({
  location,
  destinations,
  balances,
  today,
  onNotice,
}: {
  location: StockLocationView;
  destinations: readonly StockLocationView[];
  balances: readonly StockBalance[];
  today: string;
  onNotice: (n: Notice) => void;
}) {
  const id = useId();
  const drugs = transferableDrugs(balances);
  const [toId, setToId] = useState(destinations[0]?.id ?? '');
  const [drugId, setDrugId] = useState(drugs[0]?.drugId ?? '');
  const [qty, setQty] = useState('');
  const [pending, start] = useTransition();
  const plan = qty ? transferPlan(balances, drugId, Number(qty), today) : null;
  if (drugs.length === 0) {
    return <p className="m-0 text-small text-ink-500">Tidak ada stok layak untuk dimutasi dari depo ini.</p>;
  }
  return (
    <form
      aria-label="Kirim mutasi"
      className={CARD}
      onSubmit={(e) => {
        e.preventDefault();
        if (!plan?.ok || !toId) return;
        start(async () => {
          const r = await sendTransferAction(
            {
              fromStockLocationId: location.id,
              toStockLocationId: toId,
              items: plan.picks.map((p) => ({ stockBatchId: p.batchId, quantity: p.quantity })),
            },
            crypto.randomUUID(),
          );
          if (!r.ok) return onNotice({ ok: false, text: r.message });
          onNotice({
            ok: true,
            text: `${r.transfer.transferNo} dikirim ke ${r.transfer.to.name}; menunggu diterima depo tujuan.`,
          });
          setQty('');
        });
      }}
    >
      <h2 className="m-0 text-body font-semibold">Kirim mutasi dari {location.name}</h2>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <label htmlFor={`${id}-tujuan`} className={LABEL}>
          Depo tujuan
          <select
            id={`${id}-tujuan`}
            value={toId}
            disabled={pending}
            onChange={(e) => setToId(e.target.value)}
            className={FIELD}
          >
            {destinations.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor={`${id}-obat`} className={LABEL}>
          Obat
          <select
            id={`${id}-obat`}
            value={drugId}
            disabled={pending}
            onChange={(e) => setDrugId(e.target.value)}
            className={FIELD}
          >
            {drugs.map((d) => (
              <option key={d.drugId} value={d.drugId}>
                {d.drugName} (layak {d.usable})
              </option>
            ))}
          </select>
        </label>
        <label htmlFor={`${id}-jumlah`} className={LABEL}>
          Jumlah
          <input
            id={`${id}-jumlah`}
            inputMode="numeric"
            value={qty}
            disabled={pending}
            onChange={(e) => setQty(e.target.value.replace(/\D/g, ''))}
            className={FIELD}
          />
        </label>
      </div>
      {plan && !plan.ok && (
        <p role="alert" className="m-0 text-small font-semibold text-danger">
          {plan.message}
        </p>
      )}
      {plan?.ok && (
        <p className="m-0 text-small text-ink-700">
          Batch FEFO: {plan.picks.map((p) => `${p.batchNo} (ED ${p.expiryDate}) × ${p.quantity}`).join('; ')}
        </p>
      )}
      <Button type="submit" variant="primary" className="w-fit" disabled={!plan?.ok || !toId || pending}>
        {pending ? 'Mengirim…' : 'Kirim mutasi'}
      </Button>
    </form>
  );
}

/** Penyesuaian stok beralasan satu batch: selisih bertanda; batch kedaluwarsa hanya bisa dikurangi (hapus buku). */
export function AdjustForm({
  location,
  balances,
  onNotice,
}: {
  location: StockLocationView;
  balances: readonly StockBalance[];
  onNotice: (n: Notice) => void;
}) {
  const id = useId();
  const [batchId, setBatchId] = useState(balances[0]?.stockBatchId ?? '');
  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState('');
  const [pending, start] = useTransition();
  const batch = balances.find((b) => b.stockBatchId === batchId);
  const n = Number(delta);
  const deltaOk = /^-?\d+$/.test(delta) && n !== 0;
  const problem = !batch
    ? null
    : batch.expired && n > 0
      ? 'Batch kedaluwarsa tidak boleh ditambah; isi selisih negatif untuk hapus buku.'
      : n < 0 && -n > batch.quantity
        ? `Selisih melebihi saldo batch (${batch.quantity}).`
        : null;
  const ready = batch && deltaOk && !problem && reason.trim().length >= SAFETY_REASON_MIN;
  if (balances.length === 0)
    return <p className="m-0 text-small text-ink-500">Belum ada stok untuk disesuaikan.</p>;
  return (
    <form
      aria-label="Penyesuaian stok"
      className={CARD}
      onSubmit={(e) => {
        e.preventDefault();
        if (!ready) return;
        start(async () => {
          const r = await adjustStockAction(
            {
              stockLocationId: location.id,
              items: [{ stockBatchId: batchId, quantityDelta: n }],
              reason: reason.trim(),
            },
            crypto.randomUUID(),
          );
          if (!r.ok) return onNotice({ ok: false, text: r.message });
          onNotice({ ok: true, text: `Penyesuaian ${batch.batchNo} (${n > 0 ? '+' : ''}${n}) tersimpan.` });
          setDelta('');
          setReason('');
        });
      }}
    >
      <h2 className="m-0 text-body font-semibold">Penyesuaian stok {location.name}</h2>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <label htmlFor={`${id}-batch`} className={LABEL}>
          Batch
          <select
            id={`${id}-batch`}
            value={batchId}
            disabled={pending}
            onChange={(e) => setBatchId(e.target.value)}
            className={FIELD}
          >
            {balances.map((b) => (
              <option key={b.stockBatchId} value={b.stockBatchId}>
                {b.drugName} · {b.batchNo} · saldo {b.quantity}
                {b.expired ? ' · kedaluwarsa' : ''}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor={`${id}-selisih`} className={LABEL}>
          Selisih (negatif = berkurang)
          <input
            id={`${id}-selisih`}
            inputMode="numeric"
            value={delta}
            disabled={pending}
            onChange={(e) => setDelta(e.target.value.replace(/[^\d-]/g, ''))}
            className={FIELD}
          />
        </label>
      </div>
      <label htmlFor={`${id}-alasan`} className={LABEL}>
        Alasan (wajib, minimal {SAFETY_REASON_MIN} karakter)
        <textarea
          id={`${id}-alasan`}
          rows={2}
          maxLength={500}
          value={reason}
          disabled={pending}
          onChange={(e) => setReason(e.target.value)}
          className="rounded-control border border-line-strong bg-white px-3 py-2 font-[inherit] text-small font-normal"
        />
      </label>
      {problem && (
        <p role="alert" className="m-0 text-small font-semibold text-danger">
          {problem}
        </p>
      )}
      <Button type="submit" variant="primary" className="w-fit" disabled={!ready || pending}>
        {pending ? 'Menyimpan…' : 'Simpan penyesuaian'}
      </Button>
    </form>
  );
}
