'use client';

import { Icon, Segmented } from '@simrs/ui';
import { useEffect, useRef, useState } from 'react';
import { useDemoRunner } from '@/components/demo-sync';
import type { ScenarioId } from '@/lib/demo/engine/types';

/** Jeda putar otomatis (≥ 2 detik agar penonton sempat membaca dan API tidak dibanjiri permintaan). */
const AUTO_MS = 2000;

/** Kontrol presenter: tab skenario, putar otomatis, mulai ulang, lompat ke tahap (mockup Simulasi). */
export function SimulasiControls({
  rev,
  scenario,
  tabs,
  finished,
  activeStep,
  stages,
}: {
  rev: number;
  scenario: ScenarioId;
  tabs: Array<{ id: ScenarioId; label: string }>;
  finished: boolean;
  activeStep: number;
  stages: string[];
}) {
  const { run, pending, error } = useDemoRunner(rev);
  const [auto, setAuto] = useState(false);
  const jumpMenu = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    if (finished) setAuto(false);
  }, [finished]);

  useEffect(() => {
    if (!auto || pending || finished) return;
    const t = setTimeout(() => run({ type: 'auto' }, (ok) => !ok && setAuto(false)), AUTO_MS);
    return () => clearTimeout(t);
  }, [auto, pending, finished, rev, run]);

  function toggleAuto() {
    if (finished) {
      run({ type: 'reset', scenario }, (ok) => ok && setAuto(true));
      return;
    }
    setAuto((a) => !a);
  }

  const future = stages.map((stage, i) => ({ stage, i })).filter((s) => s.i > activeStep);

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap items-center gap-2.5">
        <Segmented
          label="Skenario"
          value={scenario}
          items={tabs}
          disabled={pending}
          onChange={(id) => {
            setAuto(false);
            run({ type: 'select', scenario: id as ScenarioId });
          }}
        />
        <button
          type="button"
          onClick={toggleAuto}
          aria-pressed={auto}
          className={
            auto
              ? 'flex min-h-11 cursor-pointer items-center gap-2 rounded-control border border-brand-800 bg-white px-3.5 font-[inherit] font-semibold text-brand-700'
              : 'flex min-h-11 cursor-pointer items-center gap-2 rounded-control border border-brand-800 bg-brand-600 px-3.5 font-[inherit] font-semibold text-white'
          }
        >
          <Icon name={auto ? 'pause' : 'play'} size={16} />
          {auto ? 'Jeda' : finished ? 'Putar ulang otomatis' : 'Putar otomatis'}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setAuto(false);
            run({ type: 'reset', scenario });
          }}
          className="min-h-11 cursor-pointer rounded-control border border-line-strong bg-white px-3.5 font-[inherit] font-medium text-ink-900"
        >
          Mulai ulang
        </button>
        {!finished && future.length > 0 && (
          <details ref={jumpMenu} className="relative">
            <summary className="flex min-h-11 cursor-pointer list-none items-center rounded-control border border-line-strong bg-white px-3.5 font-medium">
              Lompat ke tahap
            </summary>
            <div className="absolute right-0 z-20 mt-1 flex w-64 flex-col rounded-card border border-line bg-white p-1 shadow-lg">
              <span className="px-3 py-2 text-caption text-ink-500">
                Tugas sebelumnya dikerjakan otomatis dengan pilihan bawaan.
              </span>
              {future.map((s) => (
                <button
                  key={s.i}
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    setAuto(false);
                    if (jumpMenu.current) jumpMenu.current.open = false;
                    run({ type: 'jump', scenario, step: s.i });
                  }}
                  className="min-h-11 cursor-pointer rounded-control border-0 bg-transparent px-3 text-left font-[inherit] text-small hover:bg-muted"
                >
                  {s.i + 1}. {s.stage}
                </button>
              ))}
            </div>
          </details>
        )}
      </div>
      {error && !error.task && (
        <span role="alert" className="text-small text-danger">
          {error.message}
        </span>
      )}
    </div>
  );
}
