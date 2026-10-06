'use client';

import type { SoapPlanRow } from '@simrs/shared';
import { cx, Icon } from '@simrs/ui';
import Link from 'next/link';
import type { ScenarioTasks } from './use-scenario-tasks';

const TAG: Record<SoapPlanRow['kind'], string> = {
  LAB: 'bg-samudra-100 text-samudra-800',
  RAD: 'bg-samudra-100 text-samudra-800',
  OBAT: 'bg-brand-100 text-brand-800',
  TINDAKAN: 'bg-batu-200 text-batu-800',
  KONTROL: 'bg-batu-200 text-batu-800',
};

/** Pilihan order penunjang Tn. Suryo (tugas skenario `pemeriksaan-dokter.order`). */
function ScenarioOrderChoice({ tasks }: { tasks: ScenarioTasks }) {
  const t = tasks.task('order');
  if (!t || t.status === 'selesai') return null;
  return (
    <fieldset className="m-0 flex flex-col gap-1.5 rounded-control border border-brand-100 bg-brand-50/40 p-3">
      <legend className="p-0 text-small font-semibold text-ink-700">{t.label} · CPOE cepat</legend>
      <span className="flex flex-wrap gap-2">
        {t.options.map((o) => (
          <button
            key={o.id}
            type="button"
            disabled={!tasks.enabled('order')}
            onClick={() => tasks.run('order', o.id)}
            className="flex min-h-11 cursor-pointer flex-col items-start rounded-control border border-brand-600 bg-white/90 px-3 py-1.5 text-left font-[inherit] text-brand-800 hover:bg-brand-50/60 disabled:cursor-not-allowed disabled:border-line-strong disabled:text-ink-500"
          >
            <span className="font-semibold">Kirim order: {o.label}</span>
            {o.sub && <span className="text-caption text-ink-500">{o.sub}</span>}
          </button>
        ))}
      </span>
      <span className="text-caption text-ink-500">
        {t.enabled ? 'Order langsung masuk worklist laboratorium.' : 'Simpan SOAP dan diagnosis lebih dulu.'}
      </span>
      {tasks.errorFor('order') && <span className="text-caption text-danger">{tasks.errorFor('order')}</span>}
    </fieldset>
  );
}

/**
 * P · Rencana: baris LAB/OBAT/KONTROL + tautan ke CPOE kunjungan. Tautan CPOE dan order cepat skenario hanya untuk
 * posisi yang boleh menulis order (`canOrder`: dokter/dokter residen); perawat/bidan hanya melihat rencana.
 */
export function SoapPlan({
  plan,
  cpoeHref,
  tasks,
  canOrder,
}: {
  plan: readonly SoapPlanRow[];
  cpoeHref: string;
  tasks: ScenarioTasks;
  canOrder: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <span className="text-small font-semibold">P · Rencana</span>
        {canOrder && (
          <span className="flex flex-wrap gap-2">
            <Link
              href={cpoeHref}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-control border border-line-strong bg-white/90 px-3 text-small font-medium text-ink-900 no-underline hover:bg-brand-50/60"
            >
              <Icon name="flask" size={15} />
              Order penunjang
            </Link>
            <Link
              href={cpoeHref}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-control border border-line-strong bg-white/90 px-3 text-small font-medium text-ink-900 no-underline hover:bg-brand-50/60"
            >
              <Icon name="pill" size={15} />
              Tulis resep (CPOE)
            </Link>
          </span>
        )}
      </div>
      {canOrder && tasks.active && <ScenarioOrderChoice tasks={tasks} />}
      <ul className="m-0 flex list-none flex-col overflow-hidden rounded-control border border-line p-0">
        {plan.map((r) => (
          <li
            key={`${r.kind}-${r.text}`}
            className="flex flex-wrap items-center gap-3 border-b border-line-soft px-3 py-2.5 last:border-b-0"
          >
            <span
              className={cx(
                'w-[72px] flex-none rounded-md py-0.5 text-center text-[11px] font-bold tracking-[0.06em]',
                TAG[r.kind],
              )}
            >
              {r.kind}
            </span>
            <span className="min-w-[180px] flex-1">{r.text}</span>
            <span
              className={cx(
                'inline-flex items-center gap-1 text-caption font-medium',
                r.attention ? 'text-warning' : 'text-ink-500',
              )}
            >
              {r.attention && (
                <>
                  <Icon name="alert" size={13} strokeWidth={2.2} className="flex-none" />
                  <span className="sr-only">Perlu perhatian: </span>
                </>
              )}
              {r.note}
            </span>
          </li>
        ))}
        {plan.length === 0 && (
          <li className="px-3 py-2.5 text-small text-ink-500">
            {canOrder
              ? 'Belum ada rencana. Tambahkan order penunjang atau resep lewat CPOE.'
              : 'Belum ada rencana. Order penunjang dan resep ditulis dokter lewat CPOE.'}
          </li>
        )}
      </ul>
    </div>
  );
}
