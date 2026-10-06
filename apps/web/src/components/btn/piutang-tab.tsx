'use client';

import type { FinancingOverview } from '@simrs/shared';
import { KpiCard } from '@simrs/ui';
import type { FinancingState } from '@/app/(staf)/keuangan/pembiayaan/use-financing-state';
import { formatRingkas } from '@/lib/btn-pembiayaan';
import { PiutangAside } from './piutang-aside';
import { PiutangDraws } from './piutang-draws';
import { PiutangPool } from './piutang-pool';
import { ScenarioClaimCard } from './scenario-claim';
import type { useScenarioTask } from './use-scenario-task';

/** Tab A · Pembiayaan piutang BPJS (supply chain financing): KPI fasilitas, pool klaim, pencairan, pelunasan. */
export function PiutangTab({
  data,
  s,
  scenario,
}: {
  data: FinancingOverview;
  s: FinancingState;
  scenario: ReturnType<typeof useScenarioTask>;
}) {
  const f = data.facility;
  const limit = BigInt(f.limit);
  const pos = s.position;
  const eligible = s.free.reduce((sum, b) => sum + BigInt(b.amount), 0n);
  const availablePct = limit > 0n ? Number((pos.available * 100n) / limit) : 0;
  return (
    <div className="@container flex flex-col gap-4">
      <div
        role="region"
        aria-label="Indikator fasilitas"
        className="grid grid-cols-2 gap-3.5 @xl:grid-cols-3 @5xl:grid-cols-6"
      >
        <KpiCard label="Plafon fasilitas" value={formatRingkas(limit)} detail="simulasi · revolving" tinted />
        <KpiCard
          label="Outstanding"
          value={formatRingkas(pos.outstanding)}
          detail={`${pos.activeCount} pencairan berjalan`}
          tinted
        />
        <KpiCard
          label="Sisa plafon"
          value={formatRingkas(pos.available)}
          hint={
            pos.reserved > 0n ? `${formatRingkas(pos.reserved)} dalam proses` : `${availablePct}% tersedia`
          }
          tone="success"
          tinted
        />
        <KpiCard
          label="Klaim layak bayar eligible"
          value={formatRingkas(eligible)}
          detail={`${s.free.length} batch belum dijaminkan`}
          tinted
        />
        <KpiCard
          label="Rata-rata hari cair BPJS"
          value={`${f.avgBpjsPayDays} hari`}
          hint="sejak klaim diajukan"
          tone="warning"
          tinted
        />
        <KpiCard
          label="Margin berjalan"
          value={formatRingkas(pos.marginRunning)}
          detail={`${f.marginBps / 100}% p.a. (simulasi)`}
          tinted
        />
      </div>
      {data.scenarioClaim && (
        <ScenarioClaimCard claim={data.scenarioClaim} facility={f} scenario={scenario} />
      )}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.8fr)_minmax(300px,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <PiutangPool data={data} s={s} />
          <PiutangDraws data={data} s={s} />
        </div>
        <PiutangAside data={data} s={s} />
      </div>
    </div>
  );
}
