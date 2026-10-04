'use client';

import { useDemoRunner } from '@/components/demo-sync';
import type { SimTaskView } from '@/lib/demo/simulasi-view';
import type { ScenarioHere } from '@/lib/server/demo/scenario-context';

/** Langkah skenario aktif yang dibawakan layar ini untuk pasien yang sedang dibuka (null = pasien biasa). */
export interface ScenarioBinding {
  here: ScenarioHere;
  rev: number;
}

/**
 * Tombol asli layar klinis memajukan skenario Simulasi (ADR-0023): tugas hanya dijalankan bila mesin menyatakannya
 * `enabled` (giliran kerja yang sama dengan layar Simulasi); pesan galat validasi datang dari mesin.
 */
export function useScenarioTasks(binding: ScenarioBinding | null) {
  const runner = useDemoRunner(binding?.rev ?? 0);
  const task = (id: string): SimTaskView | undefined => binding?.here.step.tasks.find((t) => t.id === id);
  const enabled = (id: string) => Boolean(task(id)?.enabled) && !runner.pending;
  const run = (id: string, value: true | string, onDone?: (ok: boolean) => void) => {
    const t = task(id);
    if (!binding || !t?.enabled) return;
    runner.run(
      { type: 'task', step: binding.here.step.index, task: id, value, scenario: binding.here.scenario },
      onDone,
    );
  };
  const errorFor = (id: string) => (runner.error?.task === id ? runner.error.message : null);
  return {
    active: binding !== null,
    task,
    enabled,
    run,
    errorFor,
    pending: runner.pending,
    error: runner.error,
  };
}

export type ScenarioTasks = ReturnType<typeof useScenarioTasks>;
