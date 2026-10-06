'use client';

import { Tabs } from '@simrs/ui';
import { useState } from 'react';
import type { RecordsAdminData } from '@/lib/server/data/backoffice';
import { LoanTab } from './loan-tab';
import { RetentionTab } from './retention-tab';
import { RoiTab } from './roi-tab';

type Tab = 'pinjam' | 'roi' | 'retensi';

/** B09 · Tiga alur RM administratif dalam tab; isian tiap tab tetap saat berpindah (`keepMounted`). */
export function RecordsAdminBoard({
  data,
  today,
  now,
  operator,
  counts,
}: {
  data: RecordsAdminData;
  today: string;
  now: string;
  operator: string;
  counts: { overdue: number; openRequests: number };
}) {
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
            <RoiTab requests={data.requests} approvers={data.approvers} now={now} operator={operator} />
          ),
        },
        {
          id: 'pinjam',
          label: 'Peminjaman berkas',
          badge: counts.overdue ? `${counts.overdue} terlambat` : undefined,
          badgeTone: 'danger',
          content: (
            <LoanTab files={data.files} initialLoans={data.loans} units={data.loanUnits} today={today} />
          ),
        },
        {
          id: 'retensi',
          label: 'Retensi & pemusnahan',
          content: (
            <RetentionTab
              batches={data.batches}
              today={today}
              computedAt={`${today}T01:30:00+07:00`}
              actors={data.destructionActors}
            />
          ),
        },
      ]}
    />
  );
}
