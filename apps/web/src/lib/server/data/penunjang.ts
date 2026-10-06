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
import { prescriptionsWithStock, type SupportState } from '../../penunjang-demo';
import { applyStoredReportToSample } from '../../penunjang-kritis';
import type { SessionView } from '../../session-view';
import { scenarioRuns, scenariosHere } from '../demo/scenario-context';
import { readDomain } from '../demo/state';
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

export type StoredLabWorklist = LabWorklist & { rev: number; stored: SupportState['labs'] };
export type StoredPharmacyQueue = PharmacyQueue & { rev: number; stored: SupportState['rx'] };
export type StoredRadiologyWorklist = RadiologyWorklist & { rev: number };

/**
 * Worklist laboratorium; `scenario` = hasil replay simulasi sesi ini (`scenarioRuns(session).results`). Laporan
 * nilai kritis yang tersimpan di toko demo (domain `hasil-kritis`, ADR-0085) diterapkan ke sampelnya.
 */
export async function getLabWorklist(scenario: ScenarioResults): Promise<StoredLabWorklist> {
  if (webEnv().dataSource === 'demo') {
    assertDemo();
    const base = demoLabWorklist(scenarioLabSamples(scenario));
    const { state } = await readDomain('hasil-kritis');
    const support = await readDomain('penunjang');
    const persisted = new Map(support.state.samples.map((s) => [s.id, s]));
    return {
      ...labWorklistSchema.parse({
        ...base,
        samples: base.samples.map((s) => applyStoredReportToSample(persisted.get(s.id) ?? s, state)),
      }),
      rev: support.rev,
      stored: support.state.labs,
    };
  }
  return notImplemented('laboratorium');
}

/** Antrean resep farmasi (telaah, penyiapan, serah terima) termasuk resep pasien skenario. */
export async function getPharmacyQueue(scenario: ScenarioResults): Promise<StoredPharmacyQueue> {
  if (webEnv().dataSource === 'demo') {
    assertDemo();
    const base = demoPharmacyQueue(scenarioPrescriptions(scenario));
    const { state, rev } = await readDomain('penunjang');
    const persisted = new Map(prescriptionsWithStock(state).map((rx) => [rx.id, rx]));
    return {
      ...pharmacyQueueSchema.parse({
        ...base,
        prescriptions: base.prescriptions.map((rx) => persisted.get(rx.id) ?? rx),
      }),
      rev,
      stored: state.rx,
    };
  }
  return notImplemented('farmasi');
}

/** Papan modalitas dan worklist radiologi termasuk pemeriksaan pasien skenario (foto toraks IGD). */
export async function getRadiologyWorklist(scenario: ScenarioResults): Promise<StoredRadiologyWorklist> {
  if (webEnv().dataSource === 'demo') {
    assertDemo();
    const base = demoRadiologyWorklist(scenarioRadiologyExams(scenario));
    const { state, rev } = await readDomain('penunjang');
    const persisted = new Map(state.exams.map((exam) => [exam.id, exam]));
    return {
      ...radiologyWorklistSchema.parse({
        ...base,
        exams: base.exams.map((exam) => persisted.get(exam.id) ?? exam),
      }),
      rev,
    };
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
