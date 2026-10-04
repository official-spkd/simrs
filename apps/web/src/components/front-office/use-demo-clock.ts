import { formatJam } from '@simrs/shared';
import { useEffect, useState } from 'react';

/**
 * Jam dinding perangkat (anjungan, TV) pada hari demo: mulai dari `DEMO_NOW` lalu berjalan sesuai waktu nyata
 * sejak layar dibuka, sehingga tanggal tetap hari presentasi (Senin, 5 Okt 2026) tetapi jam tetap hidup.
 * Render pertama sama di server dan klien (tanpa selisih hidrasi).
 */
export function useDemoClock(baseIso: string): { time: string; ms: number } {
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    const t0 = Date.now();
    const id = setInterval(() => setOffset(Date.now() - t0), 1000);
    return () => clearInterval(id);
  }, []);
  const ms = Date.parse(baseIso) + offset;
  return { time: formatJam(new Date(ms)), ms };
}
