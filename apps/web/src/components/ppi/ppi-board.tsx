'use client';

import { Tabs } from '@simrs/ui';
import { useState } from 'react';
import type { PpiData } from '@/lib/server/data/backoffice';
import { BundleTab } from './bundle-tab';
import { HandHygieneTab } from './hand-hygiene-tab';
import { IsolationTab } from './isolation-tab';
import { SurveillanceTab } from './surveillance-tab';

/** B07 · Surveilans, kebersihan tangan, bundle, dan isolasi dalam tab (isian tetap saat berpindah tab). */
export function PpiBoard({ data }: { data: PpiData }) {
  const [tab, setTab] = useState('surveilans');
  return (
    <Tabs
      label="Pencegahan dan pengendalian infeksi"
      value={tab}
      onChange={setTab}
      keepMounted
      panelClassName="pt-4 outline-none"
      items={[
        {
          id: 'surveilans',
          label: 'Surveilans HAIs',
          badge: String(data.suspects.length),
          badgeTone: 'danger',
          content: <SurveillanceTab initialMonth={data.month} suspects={data.suspects} />,
        },
        {
          id: 'tangan',
          label: 'Kebersihan tangan',
          content: <HandHygieneTab initial={data.handHygiene} />,
        },
        {
          id: 'bundle',
          label: 'Bundle',
          content: <BundleTab bundles={data.bundles} initial={data.bundleAudits} />,
        },
        {
          id: 'isolasi',
          label: 'Isolasi',
          badge: String(data.isolationRequests.length),
          content: <IsolationTab rooms={data.rooms} requests={data.isolationRequests} />,
        },
      ]}
    />
  );
}
