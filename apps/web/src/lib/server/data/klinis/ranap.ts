import 'server-only';
import {
  type InpatientDetail,
  inpatientDetailSchema,
  type InpatientSummary,
  inpatientSummarySchema,
} from '@simrs/shared';
import type { ScenarioId } from '../../../demo/engine/types';
import { patientByEncounterId } from '../../../demo/fixtures/pasien';
import { demoInpatients } from '../../../demo/fixtures/rawat-inap';
import { hartonoInpatient, ratnaInpatient, type ScenarioStepState } from '../../../rawat-inap-scenario';
import type { SessionView } from '../../../session-view';
import { scenarioRuns } from '../../demo/scenario-context';
import { assertDemo } from '../../demo-guard';
import { webEnv } from '../../web-env';
import { notImplemented } from '../not-implemented';
import { readRekam, withRekam } from './rekam';
import { scenarioSteps } from './shared';

/**
 * K04/K07/K12 · Data layar Rawat inap (daftar pasien + rekam rawat inap: CPPT, eMAR, EWS). Mode presentasi: rekam
 * fiktif + rekam tersimpan di toko demo (`rekam-medis`, ADR-0085) + proyeksi pasien skenario (Tn. Hartono, Ny. Ratna),
 * divalidasi kontrak yang sama dengan API kelak; mode api
 * menunggu backend fase 3 (potongan 3.2b/3.5, layar W4; halaman menampilkan "Belum tersambung").
 */

/**
 * Langkah skenario yang membawakan pasien rawat inap ini (Tn. Hartono: rawat inap; Ny. Ratna: pasca operasi), untuk
 * giliran tugas `emar` dan lompatan hari. Null = bukan pasien skenario rawat inap.
 */
export async function inpatientScenarioStep(
  session: SessionView,
  scenario: ScenarioId | undefined,
): Promise<ScenarioStepState | null> {
  if (scenario !== 'igd-ranap' && scenario !== 'elektif-btn') return null;
  const [step] = await scenarioSteps(session, [
    scenario === 'igd-ranap' ? ['igd-ranap', 'rawat-inap'] : ['elektif-btn', 'pasca-operasi'],
  ]);
  return step ?? null;
}

async function allInpatients(session: SessionView): Promise<InpatientDetail[]> {
  const [runs, { state }] = await Promise.all([scenarioRuns(session), readRekam()]);
  const scenario = [hartonoInpatient(runs.results['igd-ranap']), ratnaInpatient(runs.results['elektif-btn'])];
  // Pasien fixture memakai rekam tersimpan di toko demo (CPPT, co-sign, observasi, askep); pasien skenario tidak.
  return [
    ...scenario.filter((x): x is InpatientDetail => x !== null),
    ...demoInpatients().map((d) => withRekam(d, state)),
  ];
}

/** K04 · Daftar pasien rawat inap (pasien skenario masuk daftar setelah serah terima / SEP rawat inap). */
export async function getInpatientList(session: SessionView): Promise<InpatientSummary[]> {
  if (webEnv().dataSource === 'demo') {
    assertDemo();
    const list = (await allInpatients(session)).map((d) => d.summary);
    return inpatientSummarySchema.array().parse(list);
  }
  return notImplemented('rawat inap');
}

export type InpatientLookup =
  | { kind: 'dirawat'; detail: InpatientDetail }
  /** Pasien skenario yang belum masuk ruang rawat (masih di IGD / admisi). */
  | { kind: 'belum-dirawat'; patientId: string }
  | null;

/** K04/K07/K12 · Rekam rawat inap satu kunjungan; null = kunjungan tidak dikenal (halaman → 404). */
export async function getInpatient(session: SessionView, encounterId: string): Promise<InpatientLookup> {
  if (webEnv().dataSource === 'demo') {
    assertDemo();
    const found = (await allInpatients(session)).find((d) => d.summary.encounterId === encounterId);
    if (found) return { kind: 'dirawat', detail: inpatientDetailSchema.parse(found) };
    const p = patientByEncounterId(encounterId);
    if (p?.scenario === 'igd-ranap' || p?.scenario === 'elektif-btn') {
      return { kind: 'belum-dirawat', patientId: p.id };
    }
    return null;
  }
  return notImplemented('rawat inap');
}
