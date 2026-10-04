'use client';

import type { FinancingOverview } from '@simrs/shared';
import { Chip, cx, KpiCard } from '@simrs/ui';
import { useState } from 'react';
import type { FinancingState } from '@/app/(staf)/keuangan/pembiayaan/use-financing-state';
import { scenarioTag } from '@/lib/btn';
import { formatRingkas, INSTALMENT_LABEL, INSTALMENT_TONE } from '@/lib/btn-pembiayaan';
import { CicilanDetail } from './cicilan-detail';

/** Tab B · Cicilan biaya pasien: KPI, daftar pengajuan, dan detail tahap Diajukan → … → Dicairkan. */
export function CicilanTab({ data, s }: { data: FinancingOverview; s: FinancingState }) {
  const apps = s.applications;
  const [sel, setSel] = useState(apps[0]?.id ?? '');
  const app = apps.find((a) => a.id === sel) ?? apps[0];
  let disbursed = 0n;
  let nDisbursed = 0;
  let approved = 0;
  let rejected = 0;
  let inProcess = 0;
  for (const a of apps) {
    if (a.stage === 'dicairkan') {
      disbursed += BigInt(a.amount);
      nDisbursed++;
    }
    if (a.stage === 'disetujui' || a.stage === 'akad' || a.stage === 'dicairkan') approved++;
    if (a.stage === 'ditolak') rejected++;
    if (a.stage === 'diajukan' || a.stage === 'verifikasi' || a.stage === 'disetujui' || a.stage === 'akad')
      inProcess++;
  }
  const decided = approved + rejected;
  return (
    <div className="flex flex-col gap-4">
      <div
        role="region"
        aria-label="Indikator cicilan pasien"
        className="grid grid-cols-2 gap-3.5 xl:grid-cols-4"
      >
        <KpiCard
          label="Dicairkan bulan ini"
          value={formatRingkas(disbursed)}
          hint={`${nDisbursed} pengajuan · masuk ${data.facility.operationalAccount}`}
          tone="success"
          tinted
        />
        <KpiCard
          label="Approval rate"
          value={decided ? `${Math.round((approved / decided) * 100)}%` : '—'}
          detail={`${approved} disetujui dari ${decided} diputuskan BTN`}
          tinted
        />
        <KpiCard
          label="Dalam proses"
          value={String(inProcess)}
          detail="menunggu verifikasi, akad, atau cair"
          tinted
        />
        <KpiCard
          label="Ditolak"
          value={String(rejected)}
          hint="tagihan tetap terbuka di kasir"
          tone="danger"
          tinted
        />
      </div>
      <div className="flex flex-wrap items-start gap-4">
        <section
          aria-label="Daftar pengajuan cicilan"
          className="flex min-w-0 flex-[1_1_320px] flex-col gap-1 rounded-card border border-line bg-white p-3 lg:max-w-[440px]"
        >
          <span className="flex flex-col px-1 pb-1">
            <span className="font-semibold">Pengajuan cicilan</span>
            <span className="text-caption text-ink-500">
              Pasien umum dan selisih naik kelas · diajukan dari kasir atau aplikasi pasien
            </span>
          </span>
          {apps.map((a) => (
            <button
              key={a.id}
              type="button"
              aria-pressed={a.id === app?.id}
              onClick={() => setSel(a.id)}
              className={cx(
                'flex min-h-12 w-full cursor-pointer flex-col gap-1 rounded-control border-0 px-2 py-2 text-left font-[inherit]',
                a.id === app?.id ? 'bg-[#F3FAF8] shadow-[inset_3px_0_0_#0F766E]' : 'bg-white',
              )}
            >
              <span className="flex w-full justify-between gap-2">
                <span className="font-semibold">
                  {a.patient.name}
                  {a.scenario && (
                    <span className="font-normal text-brand-700">
                      {' '}
                      · {scenarioTag(a.history[0]?.at ?? null)}
                    </span>
                  )}
                </span>
                <span className="font-mono">{formatRingkas(BigInt(a.amount))}</span>
              </span>
              <span className="flex w-full flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 text-caption text-ink-500">
                  {a.service} · {a.source}
                </span>
                <Chip tone={INSTALMENT_TONE[a.stage]}>{INSTALMENT_LABEL[a.stage]}</Chip>
              </span>
            </button>
          ))}
        </section>
        {app && (
          <CicilanDetail
            key={app.id}
            app={app}
            marginPercent={data.instalmentMarginPercent}
            account={data.facility.operationalAccount}
            busy={s.pending}
            onNext={() => s.advanceApp(app)}
            onReject={(reason) => s.rejectApp(app, reason)}
          />
        )}
      </div>
    </div>
  );
}
