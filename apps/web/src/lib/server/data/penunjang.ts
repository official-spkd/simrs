import 'server-only';
import { type LabWorklist, labWorklistSchema } from '@simrs/shared';
import { demoLabWorklist } from '../../demo/fixtures/penunjang';
import {
  type ScenarioResults,
  type ScenarioTaskHook,
  scenarioLabSamples,
  scenarioPatientMap,
} from '../../penunjang-skenario';
import type { SessionView } from '../../session-view';
import { scenarioRuns, scenariosHere } from '../demo/scenario-context';
import { assertDemo } from '../demo-guard';
import { webEnv } from '../web-env';
import { notImplemented } from './not-implemented';

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

/**
 * S01–S09 · Data layar penunjang (laboratorium, farmasi, radiologi). Satu-satunya pintu data halaman domain ini:
 * mode presentasi memakai data dummy + proyeksi pasien skenario (divalidasi kontrak yang sama dengan API kelak),
 * mode api menunggu backend fase 4.
 */

/** Worklist laboratorium; `scenario` = hasil replay simulasi sesi ini (`scenarioRuns(session).results`). */
export async function getLabWorklist(scenario: ScenarioResults): Promise<LabWorklist> {
  if (webEnv().dataSource === 'demo') {
    assertDemo();
    return labWorklistSchema.parse(demoLabWorklist(scenarioLabSamples(scenario)));
  }
  return notImplemented('laboratorium');
}
