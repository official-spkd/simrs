import 'server-only';
import { type ScenarioResults, type ScenarioTaskHook, scenarioPatientMap } from '../../../penunjang-skenario';
import type { SessionView } from '../../../session-view';
import { scenarioRuns, scenariosHere } from '../../demo/scenario-context';
import { assertDemo } from '../../demo-guard';
import { webEnv } from '../../web-env';

/**
 * S01–S10 · Bagian bersama data layar penunjang (rencana fase 4 potongan 4.0c). Data per layar ada di modul
 * `lab`, `farmasi`, `radiologi`, `kamar-operasi`, `kritis`, `depo`, `bank-darah`, `gizi`, `mikro`, `diagnostik`:
 * mode presentasi memakai data dummy + proyeksi pasien skenario (divalidasi kontrak yang sama dengan API kelak), mode
 * api diisi potongan fase 4 (sampai itu halaman menampilkan "Belum tersambung" dan fungsi data gagal keras).
 */

/** Mode presentasi aktif (dengan pengaman `assertDemo`); false di mode api. */
export function isDemoData(): boolean {
  if (webEnv().dataSource !== 'demo') return false;
  assertDemo();
  return true;
}

/** Keadaan simulasi sesi ini untuk layar `screen`: hasil replay (proyeksi pasien) + kait tugas giliran. */
export async function penunjangScenario(
  session: SessionView,
  screen: string,
): Promise<{ results: ScenarioResults; hook: ScenarioTaskHook }> {
  const runs = await scenarioRuns(session);
  const steps: ScenarioTaskHook['steps'] = {};
  for (const h of scenariosHere(runs, screen)) {
    steps[h.scenario] = {
      step: h.step.index,
      enabled: h.step.tasks.filter((t) => t.enabled).map((t) => t.id),
    };
  }
  return { results: runs.results, hook: { rev: runs.rev, steps, patients: scenarioPatientMap() } };
}
