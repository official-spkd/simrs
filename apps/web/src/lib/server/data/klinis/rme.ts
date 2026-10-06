import 'server-only';
import { notFound } from 'next/navigation';
import { DEFAULT_RME_ENCOUNTER, type RmeChart, rmeChartByEncounter } from '../../../demo/fixtures/rme-pasien';
import { assertDemo } from '../../demo-guard';

/**
 * Fase 3 · Data layar bagan RME FE2 (K01, K06–K08, K10–K15). Hanya mode presentasi (ADR-0023): fixture fiktif,
 * tanpa API; backend menyusul per potongan rencana fase 3. Halaman sudah memanggil `requireDemoScreen`; gerbang di
 * sini menjaga bila modul dipakai dari tempat lain.
 */

/** Bagan pasien dari `?pasien=`: kosong → pasien bawaan; id tak dikenal → 404. */
export function rmeChartFor(pasien: string | string[] | undefined): RmeChart {
  assertDemo();
  const wanted = typeof pasien === 'string' && pasien ? pasien : DEFAULT_RME_ENCOUNTER;
  const chart = rmeChartByEncounter(wanted);
  if (!chart) notFound();
  return chart;
}
