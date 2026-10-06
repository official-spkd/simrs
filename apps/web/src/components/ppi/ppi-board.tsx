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
  const { state: st, rev } = data.store;
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
          badge: String(data.suspects.filter((x) => !st.decisions[x.id]).length),
          badgeTone: 'danger',
          content: <SurveillanceTab state={st} rev={rev} suspects={data.suspects} />,
        },
        {
          id: 'tangan',
          label: 'Kebersihan tangan',
          content: <HandHygieneTab observations={st.handHygiene} session={st.hhSession} rev={rev} />,
        },
        {
          id: 'bundle',
          label: 'Bundle',
          content: <BundleTab bundles={data.bundles} audits={st.bundleAudits} rev={rev} />,
        },
        {
          id: 'isolasi',
          label: 'Isolasi',
          badge: String(data.isolationRequests.filter((x) => !st.placed[x.id]).length),
          content: (
            <IsolationTab rooms={st.rooms} placed={st.placed} requests={data.isolationRequests} rev={rev} />
          ),
        },
      ]}
    />
  );
}
