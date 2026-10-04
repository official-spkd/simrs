'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useDemoRunner } from '@/components/demo-sync';
import type { ScenarioHook } from '@/lib/btn-skenario';

/**
 * Tombol asli layar TPDI × BTN yang juga memajukan skenario "Elektif · TPDI × BTN" (ADR-0023): hanya bila tugas
 * itu giliran di langkah aktif (`hook.enabled`), selain itu tombol berperilaku lokal saja.
 */
export function useScenarioTask(hook: ScenarioHook | null) {
  const { run, pending, error } = useDemoRunner(hook?.rev ?? 0);
  const can = useCallback(
    (stepId: string, task: string) => !!hook && hook.stepId === stepId && hook.enabled.includes(task),
    [hook],
  );
  const fire = useCallback(
    (stepId: string, task: string, value: true | string = true, onDone?: (ok: boolean) => void): boolean => {
      if (!hook || hook.stepId !== stepId || !hook.enabled.includes(task)) return false;
      run({ type: 'task', step: hook.stepIndex, task, value, scenario: 'elektif-btn' }, onDone);
      return true;
    },
    [hook, run],
  );
  return { can, fire, pending, error };
}

/**
 * Jam demo: mulai dari "sekarang" data layar (mis. 10.45) lalu berjalan mengikuti waktu nyata sejak halaman dibuka,
 * agar catatan "Tercatat 10.47" selaras dengan garis waktu layar, bukan jam komputer presenter.
 */
export function useDemoClock(nowIso: string): () => string {
  const mountedAt = useRef(0);
  useEffect(() => {
    mountedAt.current = Date.now();
  }, []);
  return useCallback(() => {
    const elapsed = mountedAt.current ? Math.max(0, Date.now() - mountedAt.current) : 0;
    return new Date(Date.parse(nowIso) + elapsed).toISOString();
  }, [nowIso]);
}
