'use client';

import {
  formatTanggal,
  formatTanggalWaktu,
  type DispenseView,
  type PharmacyPrescriptionView,
  type StockBalance,
} from '@simrs/shared';
import { Button, Chip } from '@simrs/ui';
import { useState } from 'react';
import {
  doubleCheckAction,
  handoverAction,
  prepareDispenseAction,
  returnDispenseAction,
} from '@/app/(staf)/penunjang/farmasi/dispense-actions';

export type DispenseNotice = (n: { ok: boolean; text: string }) => void;
export interface DispenseCan {
  prepare: boolean;
  doubleCheck: boolean;
  handover: boolean;
  return: boolean;
}

const CARD = 'rounded-card border border-white/95 bg-white/90 shadow-card';
const TABLE = 'w-full border-collapse text-small';
const TH = 'border-b border-line px-3 py-2 text-left text-caption font-semibold text-ink-700';
const TD = 'border-b border-line-soft px-3 py-2 align-top';
const INPUT =
  'rounded-control border border-line-strong bg-white px-3 py-2 font-[inherit] text-small font-normal';
const LABEL = 'flex flex-col gap-1 text-caption font-semibold text-ink-700';
const RECEIVER = { pasien: 'Pasien sendiri', keluarga: 'Keluarga', perawat: 'Perawat ruangan' } as const;

/** Item yang boleh disiapkan: hasil telaah terakhir (sebagian = item terpilih; setujui = semua item aktif). */
function approvedItems(rx: PharmacyPrescriptionView) {
  const last = rx.reviews.at(-1);
  const ids = last?.decision === 'sebagian' ? new Set(last.medicationRequestIds) : null;
  return rx.items.filter((i) => i.status === 'aktif' && (!ids || ids.has(i.id)));
}

function PrepareForm({
  rx,
  balances,
  onNotice,
}: {
  rx: PharmacyPrescriptionView;
  balances: readonly StockBalance[] | null;
  onNotice: DispenseNotice;
}) {
  const items = approvedItems(rx);
  const [qty, setQty] = useState<Record<string, string>>(Object.fromEntries(items.map((i) => [i.id, '1'])));
  const [batch, setBatch] = useState<Record<string, string>>({});
  const [reason, setReason] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const lines = items.map((i) => ({
    medicationRequestId: i.id,
    quantity: Number(qty[i.id] ?? '0'),
    stockBatchId: batch[i.id] || null,
    fefoOverrideReason: batch[i.id] ? (reason[i.id] ?? '').trim() || null : null,
  }));
  const ready =
    lines.length > 0 &&
    lines.every(
      (l) =>
        Number.isInteger(l.quantity) &&
        l.quantity > 0 &&
        (l.stockBatchId === null || (l.fefoOverrideReason ?? '').length >= 10),
    );
  return (
    <form
      aria-label="Penyiapan obat"
      className={`flex flex-col gap-3 p-3 ${CARD}`}
      onSubmit={async (e) => {
        e.preventDefault();
        if (!ready) return;
        setPending(true);
        const r = await prepareDispenseAction(rx.id, { items: lines }, crypto.randomUUID());
        setPending(false);
        onNotice(
          r.ok
            ? {
                ok: true,
                text: `Obat ${rx.prescriptionNo} disiapkan: ${r.dispense.items
                  .map((i) => `${i.drugName} batch ${i.batchNo} × ${i.quantity}`)
                  .join('; ')}.`,
              }
            : { ok: false, text: r.message },
        );
      }}
    >
      <span className="text-small font-semibold">Penyiapan obat (FEFO otomatis)</span>
      {items.map((i) => {
        const options = (balances ?? []).filter((b) => b.drugId === i.drugId && !b.expired);
        return (
          <fieldset
            key={i.id}
            className="m-0 flex flex-col gap-2 border-0 border-b border-line-soft p-0 pb-2"
          >
            <legend className="text-small font-semibold">{i.name}</legend>
            <span className="flex flex-wrap gap-3">
              <label className={LABEL}>
                Jumlah {i.name}
                <input
                  type="number"
                  min={1}
                  max={10000}
                  value={qty[i.id] ?? ''}
                  onChange={(e) => setQty((s) => ({ ...s, [i.id]: e.target.value }))}
                  className={`${INPUT} w-28`}
                />
              </label>
              <label className={LABEL}>
                Batch {i.name}
                <select
                  value={batch[i.id] ?? ''}
                  onChange={(e) => setBatch((s) => ({ ...s, [i.id]: e.target.value }))}
                  className={INPUT}
                >
                  <option value="">FEFO otomatis (ED terdekat dulu)</option>
                  {options.map((b) => (
                    <option key={b.stockBatchId} value={b.stockBatchId}>
                      {b.batchNo} · ED {formatTanggal(b.expiryDate)} · sisa {b.quantity}
                    </option>
                  ))}
                </select>
              </label>
            </span>
            {batch[i.id] && (
              <label className={LABEL}>
                Alasan memilih batch di luar FEFO {i.name} (minimal 10 karakter)
                <textarea
                  rows={2}
                  maxLength={500}
                  value={reason[i.id] ?? ''}
                  onChange={(e) => setReason((s) => ({ ...s, [i.id]: e.target.value }))}
                  className={INPUT}
                />
              </label>
            )}
          </fieldset>
        );
      })}
      <Button type="submit" variant="primary" size="sm" className="w-fit" disabled={!ready || pending}>
        {pending ? 'Menyiapkan…' : 'Siapkan obat'}
      </Button>
    </form>
  );
}

function HandoverForm({ d, onNotice }: { d: DispenseView; onNotice: DispenseNotice }) {
  const [kind, setKind] = useState<keyof typeof RECEIVER>('pasien');
  const [name, setName] = useState('');
  const [pio, setPio] = useState(false);
  const [pending, setPending] = useState(false);
  const ready = name.trim().length >= 3 && pio;
  return (
    <form
      aria-label="Serah terima obat"
      className="flex flex-col gap-2 rounded-control border border-line bg-card-header p-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!ready) return;
        setPending(true);
        const r = await handoverAction(d.id, {
          receiverKind: kind,
          receiverName: name.trim(),
          counselingGiven: true,
        });
        setPending(false);
        onNotice(
          r.ok
            ? { ok: true, text: `Obat ${d.prescriptionNo} diserahkan ke ${name.trim()}.` }
            : { ok: false, text: r.message },
        );
      }}
    >
      <label className={LABEL}>
        Penerima
        <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} className={INPUT}>
          {Object.entries(RECEIVER).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </label>
      <label className={LABEL}>
        Nama penerima
        <input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} className={INPUT} />
      </label>
      <label className="flex items-center gap-2 text-small">
        <input type="checkbox" checked={pio} onChange={(e) => setPio(e.target.checked)} />
        PIO (informasi obat) sudah diberikan
      </label>
      <Button type="submit" variant="primary" size="sm" className="w-fit" disabled={!ready || pending}>
        {pending ? 'Menyerahkan…' : 'Serahkan obat'}
      </Button>
    </form>
  );
}

function ReturnForm({ d, onNotice }: { d: DispenseView; onNotice: DispenseNotice }) {
  const open = d.items.filter((i) => i.returned < i.quantity);
  const [itemId, setItemId] = useState(open[0]?.id ?? '');
  const [qty, setQty] = useState('1');
  const [condition, setCondition] = useState<'layak' | 'tidak_layak'>('layak');
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  if (open.length === 0) return null;
  const ready = itemId !== '' && Number(qty) > 0 && reason.trim().length >= 10;
  return (
    <form
      aria-label="Retur obat"
      className="flex flex-col gap-2 rounded-control border border-line bg-card-header p-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!ready) return;
        setPending(true);
        const r = await returnDispenseAction(
          d.id,
          { items: [{ dispenseItemId: itemId, quantity: Number(qty), condition }], reason: reason.trim() },
          crypto.randomUUID(),
        );
        setPending(false);
        if (r.ok) setReason('');
        onNotice(
          r.ok
            ? {
                ok: true,
                text:
                  condition === 'layak'
                    ? `Retur ${qty} tercatat; stok kembali ke ${d.stockLocation.name}.`
                    : `Retur ${qty} tidak layak tercatat (tidak kembali ke stok).`,
              }
            : { ok: false, text: r.message },
        );
      }}
    >
      <span className="text-small font-semibold">Retur obat</span>
      <label className={LABEL}>
        Item
        <select value={itemId} onChange={(e) => setItemId(e.target.value)} className={INPUT}>
          {open.map((i) => (
            <option key={i.id} value={i.id}>
              {i.drugName} · {i.batchNo} · sisa {i.quantity - i.returned}
            </option>
          ))}
        </select>
      </label>
      <span className="flex flex-wrap gap-3">
        <label className={LABEL}>
          Jumlah retur
          <input
            type="number"
            min={1}
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            className={`${INPUT} w-24`}
          />
        </label>
        <label className={LABEL}>
          Kondisi
          <select
            value={condition}
            onChange={(e) => setCondition(e.target.value as typeof condition)}
            className={INPUT}
          >
            <option value="layak">Layak, kembali ke stok</option>
            <option value="tidak_layak">Tidak layak (hapus buku)</option>
          </select>
        </label>
      </span>
      <label className={LABEL}>
        Alasan retur (minimal 10 karakter)
        <textarea
          rows={2}
          maxLength={500}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className={INPUT}
        />
      </label>
      <Button type="submit" size="sm" className="w-fit" disabled={!ready || pending}>
        {pending ? 'Menyimpan…' : 'Simpan retur'}
      </Button>
    </form>
  );
}

function DispenseCard({ d, can, onNotice }: { d: DispenseView; can: DispenseCan; onNotice: DispenseNotice }) {
  const [pending, setPending] = useState(false);
  return (
    <section aria-label={`Penyiapan ${d.prescriptionNo}`} className={`flex flex-col gap-2 p-3 ${CARD}`}>
      <span className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-small">
          Disiapkan {d.preparedBy.nama} · {formatTanggalWaktu(d.preparedAt)}
        </span>
        <span className="flex flex-wrap gap-2">
          {d.hasHighAlert && <Chip tone="warning">Kewaspadaan tinggi</Chip>}
          <Chip tone={d.handover ? 'success' : 'info'}>{d.handover ? 'Diserahkan' : 'Menunggu serah'}</Chip>
        </span>
      </span>
      <div className="overflow-x-auto">
        <table className={TABLE} aria-label="Item disiapkan">
          <thead>
            <tr>
              <th className={TH}>Obat</th>
              <th className={TH}>Batch · ED</th>
              <th className={`${TH} text-right`}>Jumlah</th>
              <th className={TH}>Label dosis</th>
            </tr>
          </thead>
          <tbody>
            {d.items.map((i) => (
              <tr key={i.id}>
                <td className={TD}>
                  {i.drugName}
                  {i.fefoOverrideReason && (
                    <span className="block text-caption text-ink-500">
                      Di luar FEFO: {i.fefoOverrideReason}
                    </span>
                  )}
                </td>
                <td className={TD}>
                  <span className="font-mono">{i.batchNo}</span> · {formatTanggal(i.expiryDate)}
                </td>
                <td className={`${TD} text-right font-mono`}>
                  {i.quantity}
                  {i.returned > 0 && (
                    <span className="block text-caption text-ink-500">retur {i.returned}</span>
                  )}
                </td>
                <td className={`${TD} font-mono`}>{i.labelBarcode}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <a
        href={`/cetak/etiket-obat/${d.id}`}
        target="_blank"
        rel="noreferrer"
        className="w-fit text-small font-semibold text-brand-700"
      >
        Cetak etiket
      </a>
      <span className="text-caption text-ink-500">
        {d.doubleCheck
          ? `Cek ganda ${d.doubleCheck.by.nama} · ${formatTanggalWaktu(d.doubleCheck.at)}`
          : d.hasHighAlert
            ? 'Wajib cek ganda apoteker kedua sebelum diserahkan.'
            : 'Tanpa obat kewaspadaan tinggi; cek ganda tidak wajib.'}
        {d.handover
          ? ` · diserahkan ${d.handover.by.nama} ke ${RECEIVER[d.handover.receiverKind].toLowerCase()} ${d.handover.receiverName} · ${formatTanggalWaktu(d.handover.at)}`
          : ''}
      </span>
      {!d.handover && !d.doubleCheck && can.doubleCheck && (
        <Button
          size="sm"
          className="w-fit"
          disabled={pending}
          onClick={async () => {
            setPending(true);
            const r = await doubleCheckAction(d.id);
            setPending(false);
            onNotice(r.ok ? { ok: true, text: 'Cek ganda tercatat.' } : { ok: false, text: r.message });
          }}
        >
          {pending ? 'Menyimpan…' : 'Konfirmasi cek ganda'}
        </Button>
      )}
      {!d.handover && can.handover && <HandoverForm d={d} onNotice={onNotice} />}
      {d.returns.length > 0 && (
        <ul
          aria-label="Riwayat retur"
          className="m-0 flex list-none flex-col gap-1 p-0 text-caption text-ink-700"
        >
          {d.returns.map((r) => (
            <li key={r.id}>
              Retur {r.quantity} {r.restocked ? 'layak (kembali ke stok)' : 'tidak layak'} · {r.by.nama} ·{' '}
              {formatTanggalWaktu(r.at)} · {r.reason}
            </li>
          ))}
        </ul>
      )}
      {d.handover && can.return && <ReturnForm d={d} onNotice={onNotice} />}
    </section>
  );
}

/**
 * S05 · Penyiapan, cek ganda, serah terima, dan retur di layar Farmasi mode api (potongan 4.6b). FEFO dihitung API dari
 * ledger; batch di luar FEFO wajib beralasan. Obat kewaspadaan tinggi wajib cek ganda apoteker lain sebelum diserahkan.
 */
export function FarmasiDispense({
  rx,
  dispenses,
  balances,
  can,
  onNotice,
}: {
  rx: PharmacyPrescriptionView;
  dispenses: readonly DispenseView[];
  balances: readonly StockBalance[] | null;
  can: DispenseCan;
  onNotice: DispenseNotice;
}) {
  if (rx.status !== 'penyiapan' && dispenses.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <h3 className="m-0 text-h3 font-semibold">Penyiapan dan serah terima</h3>
      {rx.status === 'penyiapan' && can.prepare && (
        <PrepareForm rx={rx} balances={balances} onNotice={onNotice} />
      )}
      {dispenses.map((d) => (
        <DispenseCard key={d.id} d={d} can={can} onNotice={onNotice} />
      ))}
    </div>
  );
}
