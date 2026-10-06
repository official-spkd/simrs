'use client';

import { formatJam, formatRupiah } from '@simrs/shared';
import { KpiCard, Tabs } from '@simrs/ui';
import { useState } from 'react';
import { demoNow } from '@/lib/demo/fixtures/waktu';
import { formatRupiahRingkas } from '@/lib/keuangan';
import { agingView } from '@/lib/keuangan-akuntansi';
import { ringkasJurnal } from '@/lib/keuangan-jurnal';
import {
  adjustmentJournal,
  allocatePayment,
  type BatchTagihan,
  batchStatusOf,
  approveAdjustment,
  outstanding,
  paymentJournal,
  type Penyesuaian,
  type PiutangItem,
} from '@/lib/keuangan-piutang';
import type { ReceivablesBoard } from '@/lib/server/data/keuangan-lanjut';
import { PiutangPembagian } from './piutang-pembagian';
import { PiutangPenagihan } from './piutang-penagihan';
import { PiutangPenyesuaian } from './piutang-penyesuaian';

/**
 * U04 · Ruang kerja Penjaminan dan piutang: pembagian penjamin, umur piutang + batch penagihan + pelunasan
 * bereferensi, dan penyesuaian berpersetujuan. Setiap mutasi uang menampilkan jurnal berpasangan. Simulasi lokal.
 */
export function PiutangWorkspace({
  board,
  today,
  viewer,
}: {
  board: ReceivablesBoard;
  today: string;
  viewer: { name: string; role: string | null };
}) {
  const [tab, setTab] = useState('penagihan');
  const [items, setItems] = useState<readonly PiutangItem[]>(board.items);
  const [batches, setBatches] = useState<readonly BatchTagihan[]>(board.batches);
  const [adjustments, setAdjustments] = useState<readonly Penyesuaian[]>(board.adjustments);
  const [seq, setSeq] = useState(board.nextBatchSeq);
  const [adjSeq, setAdjSeq] = useState(4);
  const [flash, setFlash] = useState<string | null>(null);

  const totalAll = board.aging.reduce((s, r) => s + agingView(r).total, 0n);
  const over90 = board.aging.reduce((s, r) => s + (agingView(r).amounts[3] ?? 0n), 0n);
  const unbilled = items.filter((i) => !i.batch && i.payerGroup !== 'umum' && outstanding(i) > 0n);
  const pendingAdj = adjustments.filter((a) => a.status === 'menunggu');

  const createBatch = (ids: string[]) => {
    const number = `TG-2610-${String(seq).padStart(3, '0')}`;
    const first = items.find((i) => i.id === ids[0]);
    if (!first) return;
    setSeq((n) => n + 1);
    setItems((list) => list.map((i) => (ids.includes(i.id) ? { ...i, batch: number } : i)));
    setBatches((list) => [
      {
        number,
        payerName: first.payerName,
        payerGroup: first.payerGroup,
        itemIds: ids,
        status: 'draf',
        sentAt: null,
        payments: [],
      },
      ...list,
    ]);
    setFlash(
      `Batch ${number} dibuat untuk ${first.payerName} (${ids.length} invoice) · ${formatJam(demoNow())}`,
    );
  };
  const send = (number: string) => {
    const now = demoNow();
    setBatches((list) =>
      list.map((b) => (b.number === number ? { ...b, status: 'ditagih', sentAt: now.toISOString() } : b)),
    );
    setFlash(`Tagihan ${number} dikirim ke penjamin (surat + rincian invoice) · ${formatJam(now)}`);
  };
  const pay = (number: string, amount: bigint, reference: string) => {
    const now = demoNow();
    const b = batches.find((x) => x.number === number);
    if (!b) return;
    const nextItems = allocatePayment(items, b, amount);
    const payments = [...b.payments, { id: `py-${now.getTime()}`, at: now.toISOString(), amount, reference }];
    const status = batchStatusOf({ ...b, payments, sentAt: b.sentAt ?? now.toISOString() }, nextItems);
    setItems(nextItems);
    setBatches((list) => list.map((x) => (x.number === number ? { ...x, payments, status } : x)));
    setFlash(
      `Pelunasan ${number} ${formatRupiah(amount)} diposting · ${formatJam(now)} · ${ringkasJurnal(paymentJournal(b, amount))}`,
    );
  };
  const submitAdj = (a: { itemId: string; kind: Penyesuaian['kind']; amount: bigint; reason: string }) => {
    const now = demoNow();
    const number = `AJ-2610-${String(adjSeq).padStart(3, '0')}`;
    setAdjSeq((n) => n + 1);
    setAdjustments((list) => [
      {
        id: `aj-${adjSeq}`,
        number,
        maker: viewer.name,
        createdAt: now.toISOString(),
        status: 'menunggu',
        ...a,
      },
      ...list,
    ]);
    setFlash(`Penyesuaian ${number} diajukan · ${formatJam(now)} · menunggu persetujuan manajemen`);
  };
  const decide = (a: Penyesuaian, approve: boolean) => {
    const now = demoNow();
    setAdjustments((list) =>
      list.map((x) =>
        x.id === a.id
          ? {
              ...x,
              status: approve ? 'disetujui' : 'ditolak',
              decidedBy: viewer.name,
              decidedAt: now.toISOString(),
            }
          : x,
      ),
    );
    const it = items.find((i) => i.id === a.itemId);
    if (approve) {
      const nextItems = approveAdjustment(items, a);
      setItems(nextItems);
      // Batch yang memuat piutang ini ikut berkurang sisanya (lunas bila habis).
      setBatches((list) =>
        list.map((b) => (b.itemIds.includes(a.itemId) ? { ...b, status: batchStatusOf(b, nextItems) } : b)),
      );
    }
    setFlash(
      approve && it
        ? `${a.number} disetujui dan diposting · ${formatJam(now)} · ${ringkasJurnal(adjustmentJournal(a, it.payerGroup))}`
        : `${a.number} ditolak · ${formatJam(now)}`,
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div role="region" aria-label="Indikator piutang" className="grid grid-cols-2 gap-3.5 xl:grid-cols-4">
        <KpiCard label="Total piutang" value={formatRupiahRingkas(totalAll)} detail="semua penjamin" />
        <KpiCard
          label="Umur > 90 hari"
          value={formatRupiahRingkas(over90)}
          hint="prioritas penagihan"
          tone="danger"
          tinted
        />
        <KpiCard
          label="Belum ditagih (contoh)"
          value={unbilled.length}
          detail={formatRupiah(unbilled.reduce((s, i) => s + outstanding(i), 0n))}
        />
        <KpiCard
          label="Penyesuaian menunggu"
          value={pendingAdj.length}
          hint={pendingAdj.length ? 'perlu persetujuan manajemen' : 'tidak ada'}
          tone={pendingAdj.length ? 'warning' : 'success'}
          tinted
        />
      </div>
      {flash && (
        <div
          role="status"
          className="rounded-control border border-[#B7DEC0] bg-[#EAF5EC] px-3 py-2 text-small text-success"
        >
          ✓ {flash} (simulasi, tidak disimpan)
        </div>
      )}
      <Tabs
        label="Penjaminan dan piutang"
        variant="pil"
        value={tab}
        onChange={setTab}
        items={[
          {
            id: 'penagihan',
            label: 'Umur piutang & penagihan',
            content: (
              <div className="pt-3">
                <PiutangPenagihan
                  aging={board.aging}
                  items={items}
                  batches={batches}
                  today={today}
                  onCreateBatch={createBatch}
                  onSend={send}
                  onPay={pay}
                />
              </div>
            ),
          },
          {
            id: 'pembagian',
            label: 'Pembagian penjamin',
            content: (
              <div className="pt-3">
                <PiutangPembagian examples={board.examples} />
              </div>
            ),
          },
          {
            id: 'penyesuaian',
            label: 'Penyesuaian',
            badge: pendingAdj.length ? String(pendingAdj.length) : undefined,
            content: (
              <div className="pt-3">
                <PiutangPenyesuaian
                  items={items}
                  adjustments={adjustments}
                  viewer={viewer}
                  onSubmit={submitAdj}
                  onDecide={decide}
                />
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}
