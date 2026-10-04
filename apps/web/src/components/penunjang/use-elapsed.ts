'use client';

import { useEffect, useState } from 'react';

/**
 * Detik berjalan untuk timer nilai kritis: mulai dari `initialSeconds` (dari data) dan bertambah tiap detik selama
 * `running`. Jangkar diulang bila data membawa nilai awal baru (mis. setelah langkah simulasi maju).
 */
export function useElapsed(initialSeconds: number, running: boolean): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    setTick(0);
    if (!running) return;
    const start = Date.now();
    const timer = setInterval(() => setTick(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [initialSeconds, running]);
  return initialSeconds + (running ? tick : 0);
}
