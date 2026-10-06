import 'server-only';
import { notFound } from 'next/navigation';
import { assessmentResponsesFor } from '../../../demo/fixtures/rme-asesmen';
import { allergyList, encounterCoding, problemList } from '../../../demo/fixtures/rme-diagnosis';
import { EDU_RECORDS } from '../../../demo/fixtures/rme-edukasi';
import type { AssessmentResponse } from '../../../rme-asesmen';
import type { EduRecord } from '../../../rme-edukasi';
import {
  chartPatient,
  DEFAULT_RME_ENCOUNTER,
  type RmeChart,
  rmeChartByEncounter,
} from '../../../demo/fixtures/rme-pasien';
import { type DiagnosisLists, diagnosisLists } from '../../../rme-diagnosis-toko';
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

/** Daftar diagnosis/prosedur/masalah/alergi kunjungan: rekam awal + versi tersimpan. */
export function diagnosisListsOf(chart: RmeChart, state: RekamState): DiagnosisLists {
  const { dx, procedures } = encounterCoding(chart);
  const allergies = allergyList(chart, chartPatient(chart).alergi);
  return diagnosisLists(
    {
      dx,
      procs: procedures,
      problems: problemList(chart, dx),
      allergies: allergies.list,
      nkdaAt: allergies.nkdaAt,
    },
    state,
    chart.encounterId,
  );
}

/** Isian asesmen kunjungan: rekam awal + isian/koreksi tersimpan. */
export function assessmentsOf(chart: RmeChart, state: RekamState): AssessmentResponse[] {
  return [
    ...assessmentResponsesFor({ ...chart, riwayat: chartPatient(chart).riwayat }),
    ...state.assessments.filter((r) => r.encounterId === chart.encounterId),
  ];
}

/** Catatan edukasi kunjungan: rekam awal + catatan tersimpan. */
export function eduRecordsOf(encounterId: string, state: RekamState): EduRecord[] {
  return [
    ...(EDU_RECORDS[encounterId] ?? []),
    ...state.edu.filter((r) => r.encounterId === encounterId).map(({ encounterId: _e, ...r }) => r),
  ];
}

/** Diagnosis kunjungan untuk Server Action (null bila kunjungan tidak dikenal). */
export async function diagnosisView(encounterId: string) {
  const view = await rmeChartById(encounterId);
  return view ? { ...view, lists: diagnosisListsOf(view.chart, view.state) } : null;
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
