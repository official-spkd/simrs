import 'server-only';
import {
  type BedBoard,
  bedBoardSchema,
  type ConsentDocument,
  consentDocumentSchema,
  type DischargeSummary,
  dischargeSummarySchema,
  type EdBoard,
  edBoardSchema,
  type EdTrackingItem,
  type InpatientDetail,
  inpatientDetailSchema,
  type InpatientSummary,
  inpatientSummarySchema,
} from '@simrs/shared';
import { redirect } from 'next/navigation';
import type { ScenarioId } from '../../demo/engine/types';
import { patientByEncounterId } from '../../demo/fixtures/pasien';
import {
  demoBedRequests,
  demoBeds,
  demoEdBoardBase,
  demoEndangResume,
  demoHendroConsent,
  demoInpatients,
  demoWards,
} from '../../demo/fixtures/rawat-inap';
import { DEMO_NOW, demoNow } from '../../demo/fixtures/waktu';
import { walkInFromId } from '../../rawat-inap';
import {
  applyScenarioBeds,
  consentScenarioWait,
  hartonoBedRequest,
  hartonoConsent,
  hartonoEdItem,
  hartonoInpatient,
  hartonoResume,
  isDone,
  ratnaBedRequest,
  ratnaConsent,
  ratnaInpatient,
  ratnaResume,
  reached,
  scenarioNow,
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

/**
 * K11 · Giliran tablet persetujuan: dokumen milik skenario hanya diproses pada giliran tugasnya (`wait` = alasan
 * menunggu, null = boleh); `step` dipakai tombol TTE untuk memajukan skenario.
 */
export async function consentTurn(
  session: SessionView,
  doc: Pick<ConsentDocument, 'id' | 'status'>,
): Promise<{ step: ScenarioStepState | null; wait: string | null }> {
  const [step] = doc.id === 'pk-hartono' ? await scenarioSteps(session, [['igd-ranap', 'tata-laksana']]) : [];
  return { step: step ?? null, wait: consentScenarioWait(doc, step?.tasks.consent) };
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

/**
 * Satu pasien IGD untuk gerbang triase sisi server: dari papan (data server), atau bawaan pasien datang sendiri
 * dari id sementaranya. Null = tidak dikenal.
 */
export async function getEdItem(session: SessionView, encounterId: string): Promise<EdTrackingItem | null> {
  const board = await getEdBoard(session);
  return board.items.find((p) => p.encounterId === encounterId) ?? walkInFromId(encounterId, board.asOf);
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

export type DischargeLookup =
  | { kind: 'resume'; summary: DischargeSummary; scenario: boolean }
  /** Pasien rawat inap yang belum direncanakan pulang. */
  | { kind: 'belum-disiapkan'; patientId: string }
  | null;

/**
 * K13 · Resume medis pulang; null = kunjungan tidak dikenal (halaman → 404). Pasien skenario baru punya draf resume
 * setelah dirawat (Tn. Hartono: serah terima `admisi.transfer`; Ny. Ratna: SEP rawat inap `admisi.sep`).
 */
export async function getDischargeSummary(
  session: SessionView,
  encounterId: string,
): Promise<DischargeLookup> {
  if (webEnv().dataSource === 'demo') {
    assertDemo();
    const runs = await scenarioRuns(session);
    if (encounterId === 'kj-endang') {
      return { kind: 'resume', summary: dischargeSummarySchema.parse(demoEndangResume()), scenario: false };
    }
    const scenarioResume = [
      {
        enc: 'kj-hartono',
        R: runs.results['igd-ranap'],
        admitted: ['admisi', 'transfer'],
        build: hartonoResume,
      },
      { enc: 'kj-ratna', R: runs.results['elektif-btn'], admitted: ['admisi', 'sep'], build: ratnaResume },
    ] as const;
    const sr = scenarioResume.find((x) => x.enc === encounterId);
    if (sr) {
      if (!isDone(sr.R, sr.admitted[0], sr.admitted[1])) {
        const patientId = patientByEncounterId(encounterId)?.id;
        return patientId ? { kind: 'belum-disiapkan', patientId } : null;
      }
      return { kind: 'resume', summary: dischargeSummarySchema.parse(sr.build(sr.R)), scenario: true };
    }
    const inpatient = demoInpatients().find((d) => d.summary.encounterId === encounterId);
    return inpatient ? { kind: 'belum-disiapkan', patientId: inpatient.summary.patientId } : null;
  }
  return notImplemented('resume medis');
}

/**
 * K11 · Dokumen persetujuan tindakan di tablet; null = dokumen tidak dikenal (halaman → 404). Persetujuan Tn.
 * Hartono baru ada setelah langkah tata laksana dimulai (sebelum itu belum ada tindakan yang disetujui).
 */
export async function getConsentDocument(session: SessionView, id: string): Promise<ConsentDocument | null> {
  if (webEnv().dataSource === 'demo') {
    assertDemo();
    const runs = await scenarioRuns(session);
    const igd = runs.results['igd-ranap'];
    const doc =
      id === 'pk-hartono'
        ? reached(igd, 'tata-laksana')
          ? hartonoConsent(igd)
          : null
        : id === 'pk-ratna'
          ? ratnaConsent(runs.results['elektif-btn'])
          : id === 'pk-hendro'
            ? demoHendroConsent()
            : null;
    return doc ? consentDocumentSchema.parse(doc) : null;
  }
  return notImplemented('persetujuan tindakan');
}
