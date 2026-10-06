'use client';

import { Tabs } from '@simrs/ui';
import { useState } from 'react';
import type { AssetData } from '@/lib/server/data/backoffice';
import { AssetTab } from './asset-tab';
import { RepairTab } from './repair-tab';

/**
 * B02 · Register aset + kalibrasi dan tiket perbaikan; kalibrasi tidak laik membuat tiket di tab perbaikan. Semua aksi
 * tersimpan di toko demo (domain `aset`, ADR-0085).
 */
export function AssetBoard({
  data,
  today,
  now,
  viewerId,
}: {
  data: AssetData;
  today: string;
  now: string;
  viewerId: string;
}) {
  const [tab, setTab] = useState('aset');
  const { state, rev } = data.store;
  const open = state.tickets.filter((t) => t.stage < 4).length;

  return (
    <Tabs
      label="Aset dan pemeliharaan"
      value={tab}
      onChange={setTab}
      keepMounted
      panelClassName="pt-4 outline-none"
      items={[
        {
          id: 'aset',
          label: 'Aset & kalibrasi',
          content: (
            <AssetTab
              assets={data.assets}
              labs={data.labs}
              today={today}
              calibration={state.calibration}
              nextTicket={state.seq}
              rev={rev}
            />
          ),
        },
        {
          id: 'perbaikan',
          label: 'Perbaikan',
          badge: open ? String(open) : undefined,
          content: (
            <RepairTab
              assets={data.assets}
              tickets={state.tickets}
              technicians={data.technicians}
              now={now}
              nextTicket={state.seq}
              rev={rev}
              viewerId={viewerId}
            />
          ),
        },
      ]}
    />
  );
}
