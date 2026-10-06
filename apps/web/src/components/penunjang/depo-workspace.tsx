'use client';

import { Alert, FilterChip, KpiCard, Tabs } from '@simrs/ui';
import { useState, useTransition } from 'react';
import { recordDepoAction } from '@/app/(staf)/penunjang/depo/actions';
import { demoNow } from '@/lib/demo/fixtures/waktu';
import {
  applyDepo,
  type DepoAction,
  type DepoState,
  depotAlerts,
  fefoPlan,
  formatStockValue,
  opnameDiffs,
  stockValue,
} from '@/lib/penunjang-depo';
import type { DepoData } from '@/lib/server/data/penunjang-lanjut';
import { DispensePanel, LedgerPanel, OpnamePanel, StockPanel, TransferPanel } from './depo-panels';

export interface DepoRun {
  (action: DepoAction, onDone?: () => void): void;
}

/**
 * S05 · Depo dan stok farmasi: saldo per depo × batch dengan ED, pengeluaran FEFO (override beralasan; batch
 * kedaluwarsa tidak pernah keluar), mutasi dua langkah, stok opname, dan kartu stok. Saldo = keadaan lokal sesi
 * (simulasi); setiap transaksi diperiksa gerbang lokal lalu Server Action.
 */
export function DepoWorkspace({ data, userName }: { data: DepoData; userName: string }) {
  const [state, setState] = useState<DepoState>(data.state);
  const [depotId, setDepotId] = useState('dp-ri');
  const [tab, setTab] = useState('stok');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const { master, today } = data;
  const depot = master.depots.find((d) => d.id === depotId) ?? master.depots[0];
  const alerts = depotAlerts(state, master, depotId, today);
  const inTransit = state.transfers.filter((t) => t.status === 'dikirim');

  const run: DepoRun = (action, onDone) => {
    let seq = state.movements.length + state.transfers.length;
    const local = applyDepo(state, master, action, {
      at: demoNow().toISOString(),
      by: userName,
      today,
      nextId: (p) => `${p}-${String(++seq).padStart(3, '0')}`,
    });
    if (!local.ok) {
      setMsg({ ok: false, text: local.message });
      return;
    }
    startTransition(async () => {
      const server = await recordDepoAction(toServer(action, state, data, userName));
      if (!server.ok) {
        setMsg({ ok: false, text: server.message });
        return;
      }
      setState(local.state);
      setMsg({ ok: true, text: `${local.message} · ${server.at} (simulasi, tidak disimpan)` });
      onDone?.();
    });
  };

  const common = { state, master, today, depotId, busy: pending, run, userName };
  return (
    <div className="flex flex-col gap-4">
      <div role="group" aria-label="Pilih depo" className="flex flex-wrap gap-2">
        {master.depots.map((d) => (
          <FilterChip
            key={d.id}
            selected={d.id === depotId}
            onClick={() => {
              setDepotId(d.id);
              setMsg(null);
            }}
          >
            {d.name}
          </FilterChip>
        ))}
      </div>
      <section
        aria-label={`Ringkasan ${depot?.name ?? 'depo'}`}
        className="grid grid-cols-2 gap-3 lg:grid-cols-4"
      >
        <KpiCard
          label="Nilai persediaan"
          value={formatStockValue(stockValue(state, master, depotId))}
          detail="harga pokok per batch"
        />
        <KpiCard
          label="Batch kedaluwarsa"
          value={String(alerts.expired.length)}
          tone={alerts.expired.length ? 'danger' : 'success'}
          hint={alerts.expired.length ? 'wajib karantina, tidak bisa dikeluarkan' : 'tidak ada'}
        />
        <KpiCard
          label="Segera kedaluwarsa (≤ 90 hari)"
          value={String(alerts.near.length)}
          tone={alerts.near.length ? 'warning' : 'neutral'}
          hint={alerts.near.length ? 'keluar lebih dulu (FEFO)' : 'tidak ada'}
        />
        <KpiCard
          label="Di bawah stok minimum"
          value={String(alerts.belowMin.length)}
          tone={alerts.belowMin.length ? 'warning' : 'neutral'}
          hint={alerts.belowMin.map((i) => i.name.split(' ')[0]).join(', ') || 'aman'}
          detail={inTransit.length ? `${inTransit.length} mutasi dalam perjalanan` : undefined}
        />
      </section>
      {msg && <Alert level={msg.ok ? 'success' : 'critical'}>{msg.text}</Alert>}
      <Tabs
        label="Kegiatan depo"
        value={tab}
        onChange={(t) => {
          setTab(t);
          setMsg(null);
        }}
        keepMounted
        items={[
          { id: 'stok', label: 'Stok & kedaluwarsa', content: <StockPanel {...common} /> },
          {
            id: 'keluar',
            label: 'Keluarkan (FEFO)',
            content: <DispensePanel {...common} requests={data.requests} />,
          },
          {
            id: 'mutasi',
            label: 'Mutasi antar depo',
            badge: inTransit.length ? String(inTransit.length) : undefined,
            content: <TransferPanel {...common} />,
          },
          { id: 'opname', label: 'Stok opname', content: <OpnamePanel {...common} /> },
          { id: 'kartu', label: 'Kartu stok', content: <LedgerPanel {...common} /> },
        ]}
      />
    </div>
  );
}

/** Bentuk kiriman Server Action: id + aturan yang bisa diperiksa server (tanpa saldo lokal). */
function toServer(action: DepoAction, state: DepoState, data: DepoData, userName: string) {
  switch (action.type) {
    case 'keluar': {
      const batchIds = action.batchId
        ? [action.batchId]
        : fefoPlan(state, data.master, action.depotId, action.itemId, action.qty, data.today).allocations.map(
            (a) => a.batchId,
          );
      const fefo = fefoPlan(state, data.master, action.depotId, action.itemId, action.qty, data.today);
      const overrideFefo =
        !!action.batchId &&
        !(fefo.allocations.length === 1 && fefo.allocations[0]?.batchId === action.batchId);
      return {
        kind: 'keluar',
        depotId: action.depotId,
        itemId: action.itemId,
        qty: action.qty,
        batchIds,
        overrideFefo,
        reason: action.reason ?? '',
      };
    }
    case 'kirim':
      return { kind: 'kirim', from: action.from, to: action.to, itemId: action.itemId, qty: action.qty };
    case 'terima':
      return {
        kind: 'terima',
        transferId: action.transferId,
        sentBy: state.transfers.find((t) => t.id === action.transferId)?.sentBy ?? userName,
        receiver: action.receiver,
      };
    case 'opname':
      return {
        kind: 'opname',
        depotId: action.depotId,
        diffCount: opnameDiffs(state, action.depotId, action.counts).filter((d) => d.diff !== 0).length,
        reason: action.reason,
      };
    case 'karantina':
      return { kind: 'karantina', depotId: action.depotId, batchId: action.batchId };
  }
}
