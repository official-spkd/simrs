'use client';

import { Tabs } from '@simrs/ui';
import { useState } from 'react';
import type { ModuleState, PrintTemplate, SamplePatient, SettingDraft } from '@/lib/platform-pengaturan';
import { PengaturanCetak } from './pengaturan-cetak';
import { PengaturanModul } from './pengaturan-modul';
import { PengaturanUmum } from './pengaturan-umum';

/** P10/P12 · Tiga tab pengaturan RS; panel tetap terpasang agar draf tidak hilang saat berpindah tab. */
export function PengaturanBoard({
  modules,
  settings,
  templates,
  sample,
}: {
  modules: ModuleState;
  settings: SettingDraft;
  templates: PrintTemplate[];
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
        { id: 'modul', label: 'Modul aktif', content: <PengaturanModul initial={modules} /> },
        { id: 'umum', label: 'Pengaturan umum', content: <PengaturanUmum initial={settings} /> },
        {
          id: 'cetak',
          label: 'Template cetak',
          content: <PengaturanCetak initial={templates} sample={sample} />,
        },
      ]}
    />
  );
}
