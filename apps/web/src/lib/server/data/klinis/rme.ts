import 'server-only';
import { notFound } from 'next/navigation';
import { DEFAULT_RME_ENCOUNTER, type RmeChart, rmeChartByEncounter } from '../../../demo/fixtures/rme-pasien';
import type { RekamState } from '../../../rme-toko';
import { assertDemo } from '../../demo-guard';
import { readRekam, withRekam } from './rekam';

/**
 * Fase 3 · Data layar bagan RME FE2 (K01, K06–K08, K10–K15). Hanya mode presentasi (ADR-0023): fixture fiktif +
 * rekam tersimpan di toko demo (`rekam-medis`, ADR-0085), tanpa API; backend menyusul per potongan rencana fase 3.
 * Halaman sudah memanggil `requireDemoScreen`; gerbang di sini menjaga bila modul dipakai dari tempat lain.
 */

/** Bagan pasien dari `?pasien=` (fixture saja): kosong → pasien bawaan; id tak dikenal → 404. */
export function rmeChartFor(
  pasien: string | string[] | undefined,
  fallback: string = DEFAULT_RME_ENCOUNTER,
): RmeChart {
  assertDemo();
  const wanted = typeof pasien === 'string' && pasien ? pasien : fallback;
  const chart = rmeChartByEncounter(wanted);
  if (!chart) notFound();
  return chart;
}

export interface RmeChartView {
  chart: RmeChart;
  /** Keadaan toko `rekam-medis` (untuk bagian bagan yang tidak ada di rekam rawat inap). */
  state: RekamState;
  /** Revisi toko yang dilihat layar; dikirim bersama setiap aksi. */
  rev: number;
}

/**
 * Bagan pasien + rekam tersimpan: rekam rawat inap (CPPT, co-sign, observasi, askep) sudah diterapkan, sama dengan
 * yang tampil di layar Rawat inap.
 */
export async function rmeChart(
  pasien: string | string[] | undefined,
  fallback: string = DEFAULT_RME_ENCOUNTER,
): Promise<RmeChartView> {
  const base = rmeChartFor(pasien, fallback);
  const { state, rev } = await readRekam();
  const chart = base.inpatient ? { ...base, inpatient: withRekam(base.inpatient, state) } : base;
  return { chart, state, rev };
}

/** Bagan kunjungan dari id (Server Action): null bila tidak dikenal (tanpa 404). */
export async function rmeChartById(encounterId: string): Promise<RmeChartView | null> {
  assertDemo();
  const base = rmeChartByEncounter(encounterId);
  if (!base) return null;
  const { state, rev } = await readRekam();
  const chart = base.inpatient ? { ...base, inpatient: withRekam(base.inpatient, state) } : base;
  return { chart, state, rev };
}
