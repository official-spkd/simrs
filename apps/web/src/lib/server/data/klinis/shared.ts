import 'server-only';
import { redirect } from 'next/navigation';
import { patientByEncounterId } from '../../../demo/fixtures/pasien';
import { demoNow } from '../../../demo/fixtures/waktu';
import { scenarioNow, type ScenarioStepState, stepState } from '../../../rawat-inap-scenario';
import { nextLoginStep, type SessionView } from '../../../session-view';
import { scenarioRuns } from '../../demo/scenario-context';
import { assertDemo } from '../../demo-guard';
import { getSession } from '../../session';
import { webEnv } from '../../web-env';

/**
 * Bagian bersama data layar klinis (K01–K13) untuk modul per layar (`poli`, `cpoe`, `igd`, `bed`, `ranap`, `resume`,
 * `consent`): gerbang Server Action mode presentasi, keadaan langkah skenario yang dibawakan layar, dan jam
 * pencatatan kunjungan. Semuanya hanya bermakna di mode presentasi (ADR-0023).
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

/**
 * Jam pencatatan untuk kunjungan ini (cap waktu CPPT, eMAR, TTE): pasien skenario memakai jam simulasi skenarionya
 * agar catatan baru urut di lini masa skenario; pasien lain memakai jam demo berjalan (hari presentasi).
 */
export async function encounterClock(session: SessionView, encounterId: string): Promise<Date> {
  const scenario = patientByEncounterId(encounterId)?.scenario;
  if (webEnv().dataSource === 'demo' && (scenario === 'igd-ranap' || scenario === 'elektif-btn')) {
    const R = (await scenarioRuns(session)).results[scenario];
    return new Date(scenarioNow(R));
  }
  return demoNow();
}
