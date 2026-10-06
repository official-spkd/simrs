'use client';

import { cx, Icon } from '@simrs/ui';
import Link from 'next/link';
import { useState } from 'react';
import type { ScenarioHere } from '@/lib/server/demo/scenario-context';
import { useDemoRunner } from './demo-sync';
import { ScenarioTaskCard } from './scenario-task-card';

/** Panel tugas satu skenario di layar asli (bisa diciutkan agar tidak menutupi layar saat presentasi). */
export function ScenarioStepPanel({ here, rev }: { here: ScenarioHere; rev: number }) {
  const [open, setOpen] = useState(true);
  const { run, pending, error } = useDemoRunner(rev);
  const { step } = here;
  return (
    <section
      aria-label={`Simulasi ${here.label}`}
      className="overflow-hidden rounded-card border border-brand-200 bg-white shadow-[0_4px_16px_color-mix(in_srgb,_var(--color-brand-600)_10%,_transparent)]"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 bg-[linear-gradient(100deg,color-mix(in_srgb,_var(--color-brand-600)_10%,_transparent),#FFFFFF_60%)] px-4 py-3">
        <span className="flex min-w-0 flex-col">
          <span className="text-caption font-semibold text-brand-700">
            Simulasi · {here.label} · Langkah {step.no}
          </span>
          <span className="font-semibold">
            {here.patientName}{' '}
            <span className="font-mono text-small font-normal text-ink-500">RM {here.rm}</span> · {step.title}
          </span>
        </span>
        <span className="flex items-center gap-2">
          <Link href="/simulasi" className="inline-flex min-h-11 items-center text-small font-semibold">
            Buka Simulasi
          </Link>
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            className="flex min-h-11 cursor-pointer items-center gap-1 rounded-[9px] border border-line-strong bg-white px-2.5 font-[inherit] text-small"
          >
            <Icon name={open ? 'chevronUp' : 'chevronDown'} size={14} />
            {open ? 'Ciutkan' : 'Tampilkan tugas'}
          </button>
        </span>
      </div>
      {open && (
        <div className="flex flex-col gap-2.5 px-4 py-3">
          {step.tasks.map((t, i) => (
            <ScenarioTaskCard
              key={`${here.scenario}.${step.index}.${t.id}`}
              task={t}
              index={i}
              step={step.index}
              rev={rev}
              scenario={here.scenario}
            />
          ))}
          {/* Tombol lanjut di kiri: pojok kanan bawah layar dipakai tombol panduan melayang (`DemoGuide`). */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <button
              type="button"
              disabled={!step.canNext || pending}
              onClick={() => run({ type: 'next', scenario: here.scenario })}
              className={cx(
                'min-h-11 rounded-control border px-4 font-[inherit] font-semibold',
                step.canNext
                  ? 'cursor-pointer border-brand-800 bg-brand-600 text-white'
                  : 'cursor-not-allowed border-line-strong bg-line text-ink-500',
              )}
            >
              {step.nextLabel}
            </button>
            <span className="text-small text-ink-700">{step.footNote}</span>
          </div>
          {error && (
            <span role="alert" className="text-caption text-danger">
              {error.message}
            </span>
          )}
        </div>
      )}
    </section>
  );
}
