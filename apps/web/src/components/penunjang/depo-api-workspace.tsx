'use client';

import {
  formatTanggal,
  formatTanggalWaktu,
  type StockBalance,
  type StockLocationView,
  type StockMovementView,
  type StockTransferView,
  type SupplierView,
} from '@simrs/shared';
import { Alert, Button, Chip, KpiCard, Tabs } from '@simrs/ui';
import { useState } from 'react';
import { receiveTransferAction } from '@/app/(staf)/penunjang/depo/actions';
import { depoSummary, expiryLabel, MOVEMENT_KIND_LABEL } from '@/lib/depo-api';
import { AdjustForm, ReceiptForm, TransferForm } from './depo-api-forms';

export type Notice = { ok: boolean; text: string } | null;

const TABLE = 'w-full border-collapse text-small';
const TH = 'border-b border-line px-3 py-2 text-left text-caption font-semibold text-ink-700';
const TD = 'border-b border-line-soft px-3 py-2 align-top';
const CARD = 'overflow-x-auto rounded-card border border-white/95 bg-white/90 shadow-card';

function StockTable({ balances }: { balances: readonly StockBalance[] }) {
  if (balances.length === 0) {
    return <p className="m-0 p-4 text-small text-ink-500">Belum ada stok di depo ini.</p>;
  }
  return (
    <div className={CARD}>
      <table className={TABLE} aria-label="Saldo per batch">
        <thead>
          <tr>
            <th className={TH}>Obat</th>
            <th className={TH}>Batch</th>
            <th className={TH}>ED</th>
            <th className={TH}>Status ED</th>
            <th className={`${TH} text-right`}>Jumlah</th>
          </tr>
        </thead>
        <tbody>
          {balances.map((b) => (
            <tr key={b.stockBatchId}>
              <td className={TD}>
                <span className="font-semibold">{b.drugName}</span>
                <span className="block text-caption text-ink-500">
                  {b.kfa ? `KFA ${b.kfa}` : 'KFA belum dipetakan'}
                </span>
              </td>
              <td className={`${TD} font-mono`}>{b.batchNo}</td>
              <td className={TD}>{formatTanggal(b.expiryDate)}</td>
              <td className={TD}>
                <Chip tone={b.expired ? 'danger' : b.expiringSoon ? 'warning' : 'success'}>
                  {expiryLabel(b)}
                </Chip>
              </td>
              <td className={`${TD} text-right font-mono`}>{b.quantity}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Ledger({ movements }: { movements: readonly StockMovementView[] }) {
  if (movements.length === 0)
    return <p className="m-0 p-4 text-small text-ink-500">Kartu stok masih kosong.</p>;
  return (
    <div className={CARD}>
      <table className={TABLE} aria-label="Kartu stok">
        <thead>
          <tr>
            <th className={TH}>Waktu</th>
            <th className={TH}>Jenis</th>
            <th className={TH}>Obat · batch</th>
            <th className={`${TH} text-right`}>Jumlah</th>
            <th className={TH}>Dokumen · alasan</th>
            <th className={TH}>Petugas</th>
          </tr>
        </thead>
        <tbody>
          {movements.map((m) => (
            <tr key={m.id}>
              <td className={TD}>{formatTanggalWaktu(m.at)}</td>
              <td className={TD}>{MOVEMENT_KIND_LABEL[m.kind]}</td>
              <td className={TD}>
                {m.drugName} · <span className="font-mono">{m.batchNo}</span>
              </td>
              <td className={`${TD} text-right font-mono`}>
                {m.quantity > 0 ? `+${m.quantity}` : m.quantity}
              </td>
              <td className={TD}>
                {m.refNo && <span className="font-mono">{m.refNo}</span>}
                {m.reason && <span className="block text-caption text-ink-500">{m.reason}</span>}
              </td>
              <td className={TD}>{m.by.nama}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Transfers({
  transfers,
  location,
  onNotice,
}: {
  transfers: readonly StockTransferView[];
  location: StockLocationView;
  onNotice: (n: Notice) => void;
}) {
  const [pending, setPending] = useState<string | null>(null);
  const mine = transfers.filter((t) => t.from.id === location.id || t.to.id === location.id);
  if (mine.length === 0)
    return <p className="m-0 text-small text-ink-500">Belum ada mutasi untuk depo ini.</p>;
  return (
    <ul aria-label="Daftar mutasi" className="m-0 flex list-none flex-col gap-2 p-0">
      {mine.map((t) => (
        <li key={t.id} className={`flex flex-col gap-2 p-3.5 ${CARD}`}>
          <span className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-small">
              <span className="font-mono font-semibold">{t.transferNo}</span> · {t.from.name} → {t.to.name}
            </span>
            <Chip tone={t.status === 'dikirim' ? 'warning' : 'success'}>
              {t.status === 'dikirim' ? 'Dalam perjalanan' : 'Diterima'}
            </Chip>
          </span>
          <span className="text-caption text-ink-700">
            {t.items.map((i) => `${i.drugName} · ${i.batchNo} × ${i.quantity}`).join('; ')}
          </span>
          <span className="text-caption text-ink-500">
            Dikirim {t.sentBy.nama} · {formatTanggalWaktu(t.sentAt)}
            {t.receivedBy && t.receivedAt
              ? ` · diterima ${t.receivedBy.nama} · ${formatTanggalWaktu(t.receivedAt)}`
              : ''}
          </span>
          {t.canReceive && t.to.id === location.id && (
            <Button
              variant="primary"
              size="sm"
              className="w-fit"
              disabled={pending !== null}
              onClick={async () => {
                setPending(t.id);
                const r = await receiveTransferAction(t.id);
                setPending(null);
                onNotice(
                  r.ok
                    ? { ok: true, text: `${r.transfer.transferNo} diterima di ${r.transfer.to.name}.` }
                    : { ok: false, text: r.message },
                );
              }}
            >
              {pending === t.id ? 'Menerima…' : `Terima ${t.transferNo}`}
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * S05 · Depo mode api (potongan 4.6a): ringkasan ED, saldo per batch FEFO, penerimaan, mutasi dua langkah, penyesuaian
 * beralasan, dan kartu stok. Tombol mengikuti izin `stock.*`; API menegakkan ulang izin, lingkup unit, dan saldo.
 */
export function DepoApiWorkspace({
  location,
  destinations,
  balances,
  movements,
  transfers,
  suppliers,
  today,
  can,
}: {
  location: StockLocationView;
  destinations: readonly StockLocationView[];
  balances: readonly StockBalance[];
  movements: readonly StockMovementView[];
  transfers: readonly StockTransferView[];
  suppliers: readonly SupplierView[];
  today: string;
  can: { receive: boolean; transfer: boolean; adjust: boolean };
}) {
  const [tab, setTab] = useState('stok');
  const [notice, setNotice] = useState<Notice>(null);
  const s = depoSummary(balances);
  const inTransit = transfers.filter((t) => t.status === 'dikirim' && t.to.id === location.id).length;
  const items = [
    { id: 'stok', label: 'Stok & kedaluwarsa', content: <StockTable balances={balances} /> },
    ...(can.receive
      ? [
          {
            id: 'terima',
            label: 'Penerimaan barang',
            content: (
              <ReceiptForm location={location} suppliers={suppliers} today={today} onNotice={setNotice} />
            ),
          },
        ]
      : []),
    {
      id: 'mutasi',
      label: 'Mutasi antar depo',
      badge: inTransit ? String(inTransit) : undefined,
      content: (
        <div className="flex flex-col gap-4">
          {can.transfer && (
            <TransferForm
              location={location}
              destinations={destinations}
              balances={balances}
              today={today}
              onNotice={setNotice}
            />
          )}
          <Transfers transfers={transfers} location={location} onNotice={setNotice} />
        </div>
      ),
    },
    ...(can.adjust
      ? [
          {
            id: 'sesuai',
            label: 'Penyesuaian',
            content: <AdjustForm location={location} balances={balances} onNotice={setNotice} />,
          },
        ]
      : []),
    { id: 'kartu', label: 'Kartu stok', content: <Ledger movements={movements} /> },
  ];
  return (
    <div className="flex flex-col gap-4">
      <section aria-label={`Ringkasan ${location.name}`} className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Batch tersedia" value={String(s.batches)} detail={`${s.drugs} obat`} tinted />
        <KpiCard
          label="Batch kedaluwarsa"
          value={String(s.expired)}
          tone={s.expired ? 'danger' : 'success'}
          hint={s.expired ? 'tidak bisa dikeluarkan; hapus buku lewat penyesuaian' : 'tidak ada'}
          tinted
        />
        <KpiCard
          label="Segera kedaluwarsa"
          value={String(s.expiringSoon)}
          tone={s.expiringSoon ? 'warning' : 'neutral'}
          hint={s.expiringSoon ? 'keluar lebih dulu (FEFO)' : 'tidak ada'}
          tinted
        />
        <KpiCard
          label="Mutasi masuk menunggu"
          value={String(inTransit)}
          tone={inTransit ? 'warning' : 'neutral'}
          hint={inTransit ? 'terima di tab Mutasi' : 'tidak ada'}
          tinted
        />
      </section>
      {notice && <Alert level={notice.ok ? 'success' : 'critical'}>{notice.text}</Alert>}
      <Tabs
        label="Kegiatan depo"
        value={tab}
        onChange={(t) => {
          setTab(t);
          setNotice(null);
        }}
        keepMounted
        items={items}
      />
    </div>
  );
}
