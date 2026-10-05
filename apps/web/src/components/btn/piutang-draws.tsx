'use client';

import { type Drawdown, type FinancingOverview, formatRupiah } from '@simrs/shared';
import { Chip, type ChipTone, cx } from '@simrs/ui';
import type { ReactNode } from 'react';
import type { FinancingState } from '@/app/(staf)/keuangan/pembiayaan/use-financing-state';
import { formatTanggalPendek } from '@/lib/btn';
import { daysBetween, formatRingkas, marginFor } from '@/lib/btn-pembiayaan';
import { DEMO_TODAY } from '@/lib/demo/fixtures/waktu';

function chip(d: Drawdown): [string, ChipTone] {
  if (d.stage === 'cair') return ['Berjalan', 'brand'];
  if (d.stage === 'lunas') return [`Lunas ${d.settledOn ? formatTanggalPendek(d.settledOn) : ''}`, 'neutral'];
  if (d.stage === 'disetujui') return ['Disetujui BTN', 'info'];
  return ['Diajukan', 'info'];
}

/** Satu kolom pencairan: label kecil di atas nilai, sama di tata letak sempit (2 kolom) dan lebar (satu baris). */
function DrawField({ label, mono, children }: { label: string; mono?: boolean; children: ReactNode }) {
  return (
    <span className="flex min-w-0 flex-col">
      <span className="text-caption text-ink-500">{label}</span>
      <span className={cx('whitespace-nowrap', mono && 'font-mono')}>{children}</span>
    </span>
  );
}

/** Pencairan berjalan: pokok, tanggal cair, jatuh tempo, margin berjalan (8% p.a. harian, simulasi). */
export function PiutangDraws({ data, s }: { data: FinancingOverview; s: FinancingState }) {
  const bps = data.facility.marginBps;
  return (
    <section
      aria-label="Pencairan berjalan"
      className="@container flex min-w-0 flex-col gap-2.5 rounded-card border border-line bg-white p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <span className="flex min-w-0 flex-col">
          <span className="font-semibold">Pencairan berjalan</span>
          <span className="text-caption text-ink-500">
            Tenor maks. {data.facility.maxTenorDays} hari per pencairan; pelunasan auto-debit dari rekening
            penampungan {data.facility.claimAccount}
          </span>
        </span>
        <span className="text-small text-ink-700">
          {s.position.activeCount} berjalan · outstanding {formatRingkas(s.position.outstanding)}
        </span>
      </div>
      <ul className="m-0 flex list-none flex-col p-0">
        {s.draws.map((d) => {
          const days = d.disbursedOn && d.stage === 'cair' ? daysBetween(d.disbursedOn, DEMO_TODAY) : 0;
          const margin =
            d.stage === 'cair'
              ? `${formatRingkas(marginFor(BigInt(d.principal), bps, days))} · ${days} hr`
              : d.stage === 'lunas' && d.marginPaid
                ? `${formatRingkas(BigInt(d.marginPaid))} dibayar`
                : '—';
          const [label, tone] = chip(d);
          return (
            <li
              key={d.id}
              className="grid grid-cols-2 items-start gap-x-3 gap-y-2 border-b border-line py-2 text-small @4xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,0.7fr)_minmax(0,0.9fr)_minmax(0,1.1fr)_auto]"
            >
              <span className="font-mono font-semibold whitespace-nowrap">{d.id}</span>
              <span className="text-ink-700">{s.basisOf(d)}</span>
              <DrawField label="Pokok" mono>
                {formatRupiah(BigInt(d.principal))}
              </DrawField>
              <DrawField label="Cair">{d.disbursedOn ? formatTanggalPendek(d.disbursedOn) : '—'}</DrawField>
              <DrawField label="Jatuh tempo">{d.dueOn ? formatTanggalPendek(d.dueOn, true) : '—'}</DrawField>
              <DrawField label="Margin" mono>
                {margin}
              </DrawField>
              <span>
                <Chip tone={tone}>{label}</Chip>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
