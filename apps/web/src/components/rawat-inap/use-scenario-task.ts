'use client';

import { useCallback } from 'react';
import { useDemoRunner } from '@/components/demo-sync';
import type { ScenarioStepState } from '@/lib/rawat-inap-scenario';

/**
 * Tombol asli layar yang memajukan skenario Simulasi (ADR-0023): hanya bila tugas itu sedang gilirannya
 * (`enabled`); selain itu komponen berperilaku lokal. Aturan gerbang tetap ditegakkan mesin di server.
 */
export function useScenarioTask(rev: number) {
  const { run, pending, error, clearError } = useDemoRunner(rev);
  const runTask = useCallback(
    (
      s: ScenarioStepState | undefined,
      task: string,
      value: true | string,
      onDone?: (ok: boolean) => void,
    ): boolean => {
      if (!s?.tasks[task]?.enabled) return false;
      run({ type: 'task', step: s.step, task, value, scenario: s.scenario }, onDone);
      return true;
    },
    [run],
  );
  return { runTask, pending, error, clearError };
}

/** Tugas ini sedang gilirannya di skenario? */
export function taskEnabled(s: ScenarioStepState | undefined, task: string): boolean {
  return !!s?.tasks[task]?.enabled;
}

export function taskDone(s: ScenarioStepState | undefined, task: string): boolean {
  return !!s?.tasks[task]?.done;
}
