'use client';

import { Tabs } from '@simrs/ui';
import { useState } from 'react';
import type { HrData } from '@/lib/server/data/backoffice';
import { EmployeeTab } from './employee-tab';
import { RosterTab } from './roster-tab';

/** B03 · Pegawai & izin praktik + jadwal dinas dalam tab (isian tetap saat berpindah tab). */
export function HrBoard({ data, today, alerts }: { data: HrData; today: string; alerts: number }) {
  const [tab, setTab] = useState('pegawai');
  return (
    <Tabs
      label="SDM dan kepegawaian"
      value={tab}
      onChange={setTab}
      keepMounted
      panelClassName="pt-4 outline-none"
      items={[
        {
          id: 'pegawai',
          label: 'Pegawai & izin praktik',
          badge: alerts ? String(alerts) : undefined,
          badgeTone: 'danger',
          content: <EmployeeTab employees={data.employees} today={today} />,
        },
        {
          id: 'jadwal',
          label: 'Jadwal dinas',
          content: (
            <RosterTab
              unit={data.roster.unit}
              weekLabel={data.roster.weekLabel}
              dayLabels={data.roster.dayLabels}
              minimum={data.roster.minimum}
              staff={data.rosterStaff}
              initial={data.draft}
            />
          ),
        },
      ]}
    />
  );
}
