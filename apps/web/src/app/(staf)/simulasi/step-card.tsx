'use client';

import { cx } from '@simrs/ui';
import Link from 'next/link';
import { useDemoRunner } from '@/components/demo-sync';
import { OpenScreenButton } from '@/components/open-screen-button';
import { ScenarioTaskCard } from '@/components/scenario-task-card';
import type { ScenarioId } from '@/lib/demo/engine/types';
import type { SimStepView } from '@/lib/demo/simulasi-view';
import type { ReactNode } from 'react';

/** Kartu langkah aktif/ditinjau: tugas berurutan, gerbang keselamatan merah, tombol lanjut ke tahap berikutnya. */
export function StepCard({
  step,
  rev,
  activeHref,
  finished,
}: {
  step: SimStepView;
  rev: number;
  activeHref: string;
  /** Simulasi selesai: tautan kembali menuju ringkasan (mockup "Lihat ringkasan"). */
  finished: boolean;
}) {
  const { run, pending, error } = useDemoRunner(rev);
  return (
    <div className="overflow-hidden rounded-card border border-line bg-white">
      <div className="flex flex-col gap-1.5 border-b border-line bg-[linear-gradient(100deg,rgba(15,118,110,0.07),#FFFFFF_60%)] px-[18px] py-4">
        <span className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[12.5px] text-ink-500">
            Langkah {step.no} · {step.stage}
          </span>
          <span className="rounded-full bg-brand-50 px-2.5 py-0.5 text-caption font-semibold text-brand-700">
            Peran: {step.actor}
            {step.roleName ? ` (posisi ${step.roleName})` : ''}
          </span>
        </span>
        <h2 className="m-0 text-[19px] font-semibold">{step.title}</h2>
        <p className="m-0 max-w-[760px] text-[13.5px] text-ink-700">{step.desc}</p>
        {step.screen && <OpenScreenButton screen={step.screen} role={step.role} roleName={step.roleName} />}
      </div>

      {step.past && (
        <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-info-border bg-info-bg px-[18px] py-2.5 text-small text-info">
          <span>Langkah ini sudah selesai. Anda sedang meninjau hasilnya.</span>
          <Link
            href={activeHref}
            className="flex min-h-11 items-center rounded-[9px] border border-info bg-white px-3 font-semibold text-info no-underline"
          >
            {finished ? 'Lihat ringkasan' : 'Kembali ke langkah aktif'}
          </Link>
        </div>
      )}

      <div className="flex flex-col gap-2.5 px-[18px] py-4">
        {step.tasks.map((t, i) => (
          <ScenarioTaskCard key={`${step.index}.${t.id}`} task={t} index={i} step={step.index} rev={rev} />
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-subtle px-[18px] py-3.5">
        <span className="text-small text-ink-700">{step.footNote}</span>
        {!step.past && (
          <span className="flex flex-col items-end gap-1">
            <button
              type="button"
              disabled={!step.canNext || pending}
              onClick={() => run({ type: 'next' })}
              className={cx(
                'min-h-11 rounded-control border px-[18px] font-[inherit] font-semibold',
                step.canNext
                  ? 'cursor-pointer border-brand-800 bg-brand-600 text-white'
                  : 'cursor-not-allowed border-line-strong bg-[#E9EDF1] text-ink-500',
              )}
            >
              {step.nextLabel}
            </button>
            {error && (
              <span role="alert" className="text-caption text-danger">
                {error.message}
              </span>
            )}
          </span>
        )}
      </div>
    </div>
  );
}

/** Tombol di kartu ringkasan: ulangi skenario ini, atau coba skenario berikutnya dari awal. */
export function SummaryActions({
  rev,
  scenario,
  nextScenario,
  children,
}: {
  rev: number;
  scenario: ScenarioId;
  nextScenario: { id: ScenarioId; label: string };
  /** Tautan lanjutan di baris yang sama (mockup: "Lihat dari sisi pasien", "Dasbor direksi"). */
  children?: ReactNode;
}) {
  const { run, pending } = useDemoRunner(rev);
  return (
    <div className="flex flex-wrap gap-2.5 border-t border-line px-[18px] py-3.5">
      <button
        type="button"
        disabled={pending}
        onClick={() => run({ type: 'reset', scenario })}
        className="min-h-11 cursor-pointer rounded-control border border-brand-800 bg-brand-600 px-4 font-[inherit] font-semibold text-white"
      >
        Ulangi skenario
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => run({ type: 'reset', scenario: nextScenario.id })}
        className="min-h-11 cursor-pointer rounded-control border border-line-strong bg-white px-4 font-[inherit] font-medium text-ink-900"
      >
        Coba skenario {nextScenario.label}
      </button>
      {children}
    </div>
  );
}
