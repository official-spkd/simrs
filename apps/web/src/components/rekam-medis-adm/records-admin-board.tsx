'use client';

import { Tabs } from '@simrs/ui';
import { useState } from 'react';
import type { RecordsAdminData } from '@/lib/server/data/backoffice';
import { LoanTab } from './loan-tab';
import { RetentionTab } from './retention-tab';
import { RoiTab } from './roi-tab';
import { RETENTION_COMPUTED_AT } from '@/lib/rekam-medis-adm-toko';

type Tab = 'pinjam' | 'roi' | 'retensi';

/** B09 · Tiga alur RM administratif dalam tab; isian tiap tab tetap saat berpindah (`keepMounted`). */
export function RecordsAdminBoard({
  data,
  today,
  now,
  operator,
  viewerId,
  viewerRole,
  counts,
}: {
  data: RecordsAdminData;
  today: string;
  now: string;
  operator: string;
  viewerId: string;
  viewerRole: string | null;
  counts: { overdue: number; openRequests: number };
}) {
  const { state, rev } = data.store;
  const [tab, setTab] = useState<Tab>('roi');
  return (
    <Tabs
      label="Alur rekam medis administratif"
      value={tab}
      onChange={(v) => setTab(v as Tab)}
      keepMounted
      panelClassName="pt-4 outline-none"
      items={[
        {
          id: 'roi',
          label: 'Salinan & hak subjek data',
          badge: counts.openRequests ? String(counts.openRequests) : undefined,
          content: (
            <RoiTab
              requests={data.requests}
              progress={state.roi}
              rev={rev}
              now={now}
              operator={operator}
              viewerId={viewerId}
              viewerRole={viewerRole}
            />
          ),
        },
        {
          id: 'pinjam',
          label: 'Peminjaman berkas',
          badge: counts.overdue ? `${counts.overdue} terlambat` : undefined,
          badgeTone: 'danger',
          content: (
            <LoanTab files={data.files} loans={state.loans} rev={rev} units={data.loanUnits} today={today} />
          ),
        },
        {
          id: 'retensi',
          label: 'Retensi & pemusnahan',
          content: (
            <RetentionTab
              batches={data.batches}
              today={today}
              computedAt={RETENTION_COMPUTED_AT}
              actors={data.destructionActors}
              stage={state.destruction.stage}
              steps={state.destruction.steps}
              rev={rev}
              viewerId={viewerId}
              viewerRole={viewerRole}
            />
          ),
        },
      ]}
    />
  );
}
