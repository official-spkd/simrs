import 'server-only';
import { type RadiologyExam, type RadiologyWorklist, radiologyWorklistSchema } from '@simrs/shared';
import { demoRadiologyWorklist } from '../../../demo/fixtures/penunjang';
import type { SupportState } from '../../../penunjang-demo';
import type { ScenarioResults } from '../../../penunjang-skenario';
import { scenarioRadiologyExams } from '../../../penunjang-skenario-radiologi';
import type { SessionView } from '../../../session-view';
import { scenarioRuns } from '../../demo/scenario-context';
import { readDomain } from '../../demo/state';
import { notImplemented } from '../not-implemented';
import { isDemoData } from './shared';

/**
 * S03 · Data layar Radiologi. Mode presentasi: papan modalitas dummy + pemeriksaan pasien skenario + keadaan
 * tersimpan di toko demo `penunjang`. Mode api diisi potongan 4.4.
 */

export type StoredRadiologyWorklist = RadiologyWorklist & {
  rev: number;
  incoming: SupportState['incomingOrders'];
};

/** Papan modalitas dan worklist radiologi termasuk pemeriksaan pasien skenario (foto toraks IGD). */
export async function getRadiologyWorklist(scenario: ScenarioResults): Promise<StoredRadiologyWorklist> {
  if (isDemoData()) {
    const base = demoRadiologyWorklist(scenarioRadiologyExams(scenario));
    const { state, rev } = await readDomain('penunjang');
    const persisted = new Map(state.exams.map((exam) => [exam.id, exam]));
    return {
      ...radiologyWorklistSchema.parse({
        ...base,
        exams: [
          ...base.exams.map((exam) => persisted.get(exam.id) ?? exam),
          ...state.exams.filter((exam) => !base.exams.some((x) => x.id === exam.id)),
        ],
      }),
      rev,
      incoming: state.incomingOrders,
    };
  }
  return notImplemented('radiologi');
}

/** Rekaman pemeriksaan untuk Server Action (klien hanya mengirim id; id tidak dikenal → undefined). */
export async function findRadiologyExam(
  session: SessionView,
  id: string,
): Promise<RadiologyExam | undefined> {
  const { results } = await scenarioRuns(session);
  return (await getRadiologyWorklist(results)).exams.find((e) => e.id === id);
}
