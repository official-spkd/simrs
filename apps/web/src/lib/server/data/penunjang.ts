import 'server-only';
import {
  type LabSample,
  type LabWorklist,
  labWorklistSchema,
  type PharmacyPrescription,
  type PharmacyQueue,
  pharmacyQueueSchema,
  type RadiologyExam,
  type RadiologyWorklist,
  radiologyWorklistSchema,
} from '@simrs/shared';
import { demoLabWorklist, demoPharmacyQueue, demoRadiologyWorklist } from '../../demo/fixtures/penunjang';
import { scenarioRadiologyExams } from '../../penunjang-skenario-radiologi';
import { scenarioPrescriptions } from '../../penunjang-skenario-farmasi';
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

/** Antrean resep farmasi (telaah, penyiapan, serah terima) termasuk resep pasien skenario. */
export async function getPharmacyQueue(scenario: ScenarioResults): Promise<PharmacyQueue> {
  if (webEnv().dataSource === 'demo') {
    assertDemo();
    return pharmacyQueueSchema.parse(demoPharmacyQueue(scenarioPrescriptions(scenario)));
  }
  return notImplemented('farmasi');
}

/** Papan modalitas dan worklist radiologi termasuk pemeriksaan pasien skenario (foto toraks IGD). */
export async function getRadiologyWorklist(scenario: ScenarioResults): Promise<RadiologyWorklist> {
  if (webEnv().dataSource === 'demo') {
    assertDemo();
    return radiologyWorklistSchema.parse(demoRadiologyWorklist(scenarioRadiologyExams(scenario)));
  }
  return notImplemented('radiologi');
}

/*
 * Rekaman untuk Server Action: dicari server lewat jalur data yang sama dengan halaman (fixture + proyeksi pasien
 * skenario sesi ini), sehingga action tidak memercayai atribut keselamatan kiriman klien (kontras, modalitas,
 * nilai kritis, peringatan CDS, obat high alert). Klien hanya mengirim id; id yang tidak dikenal → undefined.
 */

export async function findLabSample(session: SessionView, id: string): Promise<LabSample | undefined> {
  const { results } = await scenarioRuns(session);
  return (await getLabWorklist(results)).samples.find((s) => s.id === id);
}

export async function findPrescription(
  session: SessionView,
  id: string,
): Promise<PharmacyPrescription | undefined> {
  const { results } = await scenarioRuns(session);
  return (await getPharmacyQueue(results)).prescriptions.find((rx) => rx.id === id);
}

export async function findRadiologyExam(
  session: SessionView,
  id: string,
): Promise<RadiologyExam | undefined> {
  const { results } = await scenarioRuns(session);
  return (await getRadiologyWorklist(results)).exams.find((e) => e.id === id);
}
