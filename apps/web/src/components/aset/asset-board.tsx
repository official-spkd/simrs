'use client';

import { Tabs } from '@simrs/ui';
import { useRef, useState } from 'react';
import { demoNow } from '@/lib/demo/fixtures/waktu';
import type { AssetData } from '@/lib/server/data/backoffice';
import { AssetTab } from './asset-tab';
import { RepairTab, type TicketView } from './repair-tab';

/** B02 · Register aset + kalibrasi dan tiket perbaikan; kalibrasi tidak laik membuat tiket di tab perbaikan. */
export function AssetBoard({ data, today, now }: { data: AssetData; today: string; now: string }) {
  const [tab, setTab] = useState('aset');
  const [tickets, setTickets] = useState<TicketView[]>(() =>
    data.tickets.map((t) => ({ ...t, at: {}, note: '' })),
  );
  const seq = useRef(42);
  const nextNumber = () => {
    const n = `WO-2610-${String(seq.current).padStart(3, '0')}`;
    seq.current += 1;
    return n;
  };
  const open = tickets.filter((t) => t.stage < 4).length;

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
              onWithdraw={(asset, reason) => {
                const number = nextNumber();
                setTickets((cur) => [
                  {
                    id: `tkt-kal-${number}`,
                    number,
                    assetId: asset.id,
                    unit: asset.location,
                    reporter: 'Hasil kalibrasi',
                    complaint: reason,
                    impact: 'sedang',
                    reportedAt: demoNow().toISOString(),
                    stage: 0,
                    technician: null,
                    respondedAt: null,
                    at: {},
                    note: '',
                  },
                  ...cur,
                ]);
                return number;
              }}
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
              tickets={tickets}
              setTickets={setTickets}
              technicians={data.technicians}
              now={now}
              nextNumber={nextNumber}
            />
          ),
        },
      ]}
    />
  );
}
