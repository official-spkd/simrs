import 'server-only';
import { type BedBoard, bedBoardSchema, type EdBoard, edBoardSchema } from '@simrs/shared';
import { redirect } from 'next/navigation';
import { demoBedRequests, demoBeds, demoEdBoardBase, demoWards } from '../../demo/fixtures/rawat-inap';
import { DEMO_NOW } from '../../demo/fixtures/waktu';
import {
  applyScenarioBeds,
  hartonoBedRequest,
  hartonoEdItem,
  ratnaBedRequest,
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
