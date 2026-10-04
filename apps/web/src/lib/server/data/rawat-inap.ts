import 'server-only';
import {
  type BedBoard,
  bedBoardSchema,
  type EdBoard,
  edBoardSchema,
  type InpatientDetail,
  inpatientDetailSchema,
  type InpatientSummary,
  inpatientSummarySchema,
} from '@simrs/shared';
import { redirect } from 'next/navigation';
import { patientByEncounterId } from '../../demo/fixtures/pasien';
import {
  demoBedRequests,
  demoBeds,
  demoEdBoardBase,
  demoInpatients,
  demoWards,
} from '../../demo/fixtures/rawat-inap';
import { DEMO_NOW } from '../../demo/fixtures/waktu';
import {
  applyScenarioBeds,
  hartonoBedRequest,
  hartonoEdItem,
  hartonoInpatient,
  ratnaBedRequest,
  ratnaInpatient,
  type ScenarioStepState,
  stepState,
} from '../../rawat-inap-scenario';
import type { SessionView } from '../../session-view';
import { nextLoginStep } from '../../session-view';
import { assertDemo } from '../demo-guard';
import { scenarioRuns } from '../demo/scenario-context';
import { getSession } from '../session';
import { webEnv } from '../web-env';
import { notImplemented } from './not-implemented';

/**
 * K03–K13 · Satu-satunya pintu data layar IGD, tempat tidur, rawat inap, resume, dan persetujuan tindakan. Mode
 * presentasi: fixture fiktif + proyeksi pasien skenario, divalidasi kontrak yang sama dengan API kelak; mode api
 * menunggu backend fase 3.
 */

/** Sesi lengkap untuk Server Action mode presentasi (pola `app/(staf)/simulasi/actions.ts`). */
export async function demoActionSession(): Promise<SessionView> {
  assertDemo();
  const s = await getSession();
  if (!s || nextLoginStep(s, false) !== 'selesai') redirect('/masuk');
  return s;
}

/** Keadaan langkah skenario yang dibawakan layar ini (untuk tombol asli layar yang memajukan skenario). */
export async function scenarioSteps(
  session: SessionView,
  wanted: ReadonlyArray<readonly [scenario: 'igd-ranap' | 'elektif-btn', stepId: string]>,
): Promise<ScenarioStepState[]> {
  if (webEnv().dataSource !== 'demo') return [];
  const runs = await scenarioRuns(session);
  return wanted.map(([scenario, stepId]) => stepState(runs.results[scenario], stepId, runs.rev));
}

/** K03 · Papan pelacakan IGD (Tn. Hartono muncul sejak skenario IGD dimulai sampai serah terima ke ruang). */
export async function getEdBoard(session: SessionView): Promise<EdBoard> {
  if (webEnv().dataSource === 'demo') {
    assertDemo();
    const runs = await scenarioRuns(session);
    const board = demoEdBoardBase(DEMO_NOW);
    const hartono = hartonoEdItem(runs.results['igd-ranap'], board.asOf);
    if (hartono) board.items.splice(1, 0, hartono);
    return edBoardSchema.parse(board);
  }
  return notImplemented('IGD');
}

/** K05 · Papan tempat tidur: ruang dari `BANGSAL`, bed + permintaan, ditumpangi bed/permintaan pasien skenario. */
export async function getBedBoard(session: SessionView): Promise<BedBoard> {
  if (webEnv().dataSource === 'demo') {
    assertDemo();
    const runs = await scenarioRuns(session);
    const igd = runs.results['igd-ranap'];
    const elektif = runs.results['elektif-btn'];
    const beds = applyScenarioBeds(demoBeds(), igd, elektif);
    const requests = [hartonoBedRequest(igd), ratnaBedRequest(elektif)].filter(
      (r): r is NonNullable<typeof r> => r !== null,
    );
    return bedBoardSchema.parse({
      asOf: DEMO_NOW,
      wards: demoWards(),
      beds,
      requests: [...requests, ...demoBedRequests(beds)],
    });
  }
  return notImplemented('tempat tidur');
}

async function allInpatients(session: SessionView): Promise<InpatientDetail[]> {
  const runs = await scenarioRuns(session);
  const scenario = [hartonoInpatient(runs.results['igd-ranap']), ratnaInpatient(runs.results['elektif-btn'])];
  return [...scenario.filter((x): x is InpatientDetail => x !== null), ...demoInpatients()];
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
