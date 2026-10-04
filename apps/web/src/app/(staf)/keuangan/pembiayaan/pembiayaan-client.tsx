'use client';

import type { FinancingOverview } from '@simrs/shared';
import { Alert } from '@simrs/ui';
import { useState } from 'react';
import { CicilanTab } from '@/components/btn/cicilan-tab';
import { KeepTabs } from '@/components/btn/keep-tabs';
import { PiutangTab } from '@/components/btn/piutang-tab';
import { useScenarioTask } from '@/components/btn/use-scenario-task';
import type { ScenarioHook } from '@/lib/btn-skenario';
import { useFinancingState } from './use-financing-state';

/** U04 · Bagian interaktif layar pembiayaan BTN: tab A piutang BPJS dan tab B cicilan biaya pasien. */
export function PembiayaanClient({
  data,
  hook,
  initialTab,
}: {
  data: FinancingOverview;
  hook: ScenarioHook | null;
  initialTab: 'piutang' | 'cicilan';
}) {
  const s = useFinancingState(data);
  const scenario = useScenarioTask(hook);
  const [tab, setTab] = useState<string>(initialTab);
  const open = s.applications.filter((a) =>
    ['diajukan', 'verifikasi', 'disetujui', 'akad'].includes(a.stage),
  ).length;
  return (
    <div className="flex flex-col gap-3">
      {s.msg && <Alert level={s.msg.ok ? 'success' : 'critical'}>{s.msg.text}</Alert>}
      <KeepTabs
        label="Jenis pembiayaan"
        value={tab}
        onChange={setTab}
        items={[
          {
            id: 'piutang',
            label: 'A · Pembiayaan piutang BPJS',
            content: (
              <div className="flex flex-col gap-3">
                <span className="text-small text-ink-700">
                  Supply chain financing atas piutang klaim BPJS · advance rate{' '}
                  {data.facility.advanceRatePercent}% (simulasi)
                </span>
                <PiutangTab data={data} s={s} scenario={scenario} />
              </div>
            ),
          },
          {
            id: 'cicilan',
            label: 'B · Cicilan biaya pasien',
            badge: open ? `${open} proses` : undefined,
            content: (
              <div className="flex flex-col gap-3">
                <span className="text-small text-ink-700">
                  Cicilan pasien diputuskan dan ditagih oleh BTN · RS menerima pelunasan penuh
                </span>
                <CicilanTab data={data} s={s} />
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}
