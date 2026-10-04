'use client';

import { useCallback } from 'react';
import { useDemoRunner } from '@/components/demo-sync';
import type { ScenarioId } from '@/lib/demo/engine/types';
import type { ScenarioTaskHook } from '@/lib/penunjang-skenario';

/**
 * Tombol asli layar penunjang yang memajukan skenario (pembangun-layar §6): hanya bila tugas itu sedang giliran di
 * langkah aktif layar ini; selain itu tombol berperilaku lokal atau dinonaktifkan dengan alasan.
 */
export function useScenarioTasks(hook: ScenarioTaskHook) {
  const { run, pending, error, clearError } = useDemoRunner(hook.rev);

  const scenarioOf = useCallback(
    (patientId: string): ScenarioId | null => hook.patients[patientId] ?? null,
    [hook],
  );

  const enabled = useCallback(
    (scenario: ScenarioId | null, task: string): boolean =>
      !!scenario && (hook.steps[scenario]?.enabled.includes(task) ?? false),
    [hook],
  );

  const runTask = useCallback(
    (scenario: ScenarioId, task: string, value: true | string = true, onDone?: (ok: boolean) => void) => {
      const s = hook.steps[scenario];
      if (!s) return;
      run({ type: 'task', step: s.step, task, value, scenario }, onDone);
    },
    [hook, run],
  );

  return { scenarioOf, enabled, runTask, pending, error, clearError };
}

export type ScenarioTasks = ReturnType<typeof useScenarioTasks>;

/** Alasan tombol skenario nonaktif (status tidak hanya lewat warna). */
export const NOT_YOUR_TURN =
  'Belum gilirannya di simulasi: selesaikan langkah sebelumnya atau tekan Lanjut di panel simulasi.';
