import 'server-only';
import {
  CRITICAL_HISTORY_7D,
  CRITICAL_RULES,
  criticalFromLab,
  demoOtherCriticals,
} from '../../../demo/fixtures/penunjang-kritis';
import { DEMO_NOW } from '../../../demo/fixtures/waktu';
import { applyStoredReports, type CriticalItem, sortCritical } from '../../../penunjang-kritis';
import type { SessionView } from '../../../session-view';
import { scenarioRuns } from '../../demo/scenario-context';
import { readDomain } from '../../demo/state';
import { notImplemented } from '../not-implemented';
import { getLabWorklist } from './lab';
import { isDemoData } from './shared';

/** S09 · Data Pusat hasil kritis. Mode presentasi: dummy + nilai kritis worklist Lab; mode api diisi potongan 4.3. */

export interface CriticalCenter {
  asOf: string;
  items: CriticalItem[];
  history7d: readonly number[];
  rules: typeof CRITICAL_RULES;
}

/** Pusat hasil kritis: fixture + nilai kritis worklist Lab + laporan tersimpan di toko demo (ADR-0085). */
export async function getCriticalCenter(session: SessionView): Promise<CriticalCenter> {
  if (!isDemoData()) return notImplemented('pusat hasil kritis');
  const { results } = await scenarioRuns(session);
  const lab = await getLabWorklist(results);
  const fromLab = lab.samples.flatMap((s) => {
    const c = criticalFromLab(s);
    return c ? [c] : [];
  });
  const { state } = await readDomain('hasil-kritis');
  const support = await readDomain('penunjang');
  return {
    asOf: DEMO_NOW,
    items: sortCritical(
      applyStoredReports(
        [
          ...fromLab,
          ...demoOtherCriticals().filter((i) => !support.state.criticals.some((x) => x.id === i.id)),
          ...support.state.criticals,
        ],
        state,
      ),
    ),
    history7d: CRITICAL_HISTORY_7D,
    rules: CRITICAL_RULES,
  };
}

export async function findCriticalItem(session: SessionView, id: string): Promise<CriticalItem | undefined> {
  return (await getCriticalCenter(session)).items.find((i) => i.id === id);
}
