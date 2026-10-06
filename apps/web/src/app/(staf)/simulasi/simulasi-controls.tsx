'use client';

import { Icon, TabList } from '@simrs/ui';
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
  idBase,
}: {
  rev: number;
  scenario: ScenarioId;
  tabs: Array<{ id: ScenarioId; label: string }>;
  finished: boolean;
  activeStep: number;
  stages: string[];
  /** Pasangan `aria-controls` ↔ panel skenario di halaman (`TabPanel` dengan idBase sama). */
  idBase: string;
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
        <TabList
          variant="segmen"
          idBase={idBase}
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
              ? 'flex min-h-11 cursor-pointer items-center gap-2 rounded-control border border-brand-700 bg-white px-3.5 font-[inherit] font-semibold text-brand-700'
              : 'flex min-h-11 cursor-pointer items-center gap-2 rounded-control border border-transparent bg-btn-primary px-3.5 font-[inherit] font-semibold text-white shadow-button'
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
            <div className="glass absolute right-0 z-20 mt-1 flex w-64 flex-col rounded-card border border-white/95 p-1 shadow-float animate-pal-in">
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
                  className="min-h-11 cursor-pointer rounded-control border-0 bg-transparent px-3 text-left font-[inherit] text-small hover:bg-brand-50/60"
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
