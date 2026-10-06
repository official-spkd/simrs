'use client';

import { Tabs } from '@simrs/ui';
import { useState } from 'react';
import type { SamplePatient } from '@/lib/platform-pengaturan';
import type { SettingsStoreState } from '@/lib/platform-pengaturan-toko';
import { PengaturanCetak } from './pengaturan-cetak';
import { PengaturanModul } from './pengaturan-modul';
import { PengaturanUmum } from './pengaturan-umum';

/** P10/P12 · Tiga tab pengaturan RS; panel tetap terpasang agar draf tidak hilang saat berpindah tab. */
export function PengaturanBoard({
  state,
  rev,
  sample,
}: {
  state: SettingsStoreState;
  rev: number;
  sample: SamplePatient;
}) {
  const [tab, setTab] = useState('modul');
  return (
    <Tabs
      label="Pengaturan RS"
      value={tab}
      onChange={setTab}
      keepMounted
      items={[
        {
          id: 'modul',
          label: 'Modul aktif',
          content: <PengaturanModul saved={state.modules} log={state.moduleLog} rev={rev} />,
        },
        {
          id: 'umum',
          label: 'Pengaturan umum',
          content: <PengaturanUmum saved={state.settings} lastSaved={state.settingsSaved} rev={rev} />,
        },
        {
          id: 'cetak',
          label: 'Template cetak',
          content: (
            <PengaturanCetak templates={state.templates} history={state.history} rev={rev} sample={sample} />
          ),
        },
      ]}
    />
  );
}
