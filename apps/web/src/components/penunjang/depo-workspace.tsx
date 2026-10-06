'use client';

import { Alert, FilterChip, KpiCard, Tabs } from '@simrs/ui';
import { useState } from 'react';
import { recordDepoAction, checkDepoAction } from '@/app/(staf)/penunjang/depo/actions';
import { useStoreAction } from '@/lib/demo/store/client';
import { type DepoAction, depotAlerts, formatStockValue, stockValue } from '@/lib/penunjang-depo';
import type { DepoData } from '@/lib/server/data/penunjang-lanjut';
import { DispensePanel, LedgerPanel, OpnamePanel, StockPanel, TransferPanel } from './depo-panels';

export interface DepoRun {
  (action: DepoAction, onDone?: () => void): void;
}

/**
 * S05 · Depo dan stok farmasi: saldo per depo × batch dengan ED, pengeluaran FEFO (override beralasan; batch
 * kedaluwarsa tidak pernah keluar), mutasi dua langkah, stok opname, dan kartu stok. Saldo berasal dari toko demo bersama;
 * setiap transaksi diperiksa server.
 */
export function DepoWorkspace({
  data,
  userName,
  userId,
}: {
  data: DepoData;
  userName: string;
  userId: string;
}) {
  const state = data.state;
  const [depotId, setDepotId] = useState('dp-ri');
  const [tab, setTab] = useState('stok');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const { run: save, pending } = useStoreAction(data.rev);
  const { master, today } = data;
  const depot = master.depots.find((d) => d.id === depotId) ?? master.depots[0];
  const alerts = depotAlerts(state, master, depotId, today);
  const inTransit = state.transfers.filter((t) => t.status === 'dikirim');

  const run: DepoRun = (action, onDone) =>
    save(
      (rev) => recordDepoAction(action, rev),
      (result) => {
        setMsg({ ok: result.ok, text: result.message });
        if (result.ok) onDone?.();
      },
    );
  const check = (action: Extract<DepoAction, { type: 'keluar' }>) =>
    save(
      (rev) => checkDepoAction(action, rev),
      (result) => setMsg({ ok: result.ok, text: result.message }),
    );

  const common = {
    state,
    master,
    today,
    depotId,
    busy: pending,
    run,
    userName,
    userId,
    check,
    checks: data.checks,
  };
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
          tinted
        />
        <KpiCard
          label="Batch kedaluwarsa"
          value={String(alerts.expired.length)}
          tone={alerts.expired.length ? 'danger' : 'success'}
          hint={alerts.expired.length ? 'wajib karantina, tidak bisa dikeluarkan' : 'tidak ada'}
          tinted
        />
        <KpiCard
          label="Segera kedaluwarsa (≤ 90 hari)"
          value={String(alerts.near.length)}
          tone={alerts.near.length ? 'warning' : 'neutral'}
          hint={alerts.near.length ? 'keluar lebih dulu (FEFO)' : 'tidak ada'}
          tinted
        />
        <KpiCard
          label="Di bawah stok minimum"
          value={String(alerts.belowMin.length)}
          tone={alerts.belowMin.length ? 'warning' : 'neutral'}
          hint={alerts.belowMin.map((i) => i.name.split(' ')[0]).join(', ') || 'aman'}
          detail={inTransit.length ? `${inTransit.length} mutasi dalam perjalanan` : undefined}
          tinted
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
