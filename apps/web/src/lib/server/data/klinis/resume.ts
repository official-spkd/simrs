import 'server-only';
import {
  type DeathCertificate,
  deathCertificateSchema,
  type DischargeSummary,
  dischargeSummarySchema,
  type DischargeSummaryView,
  dischargeSummaryViewSchema,
  type Worklist,
  worklistSchema,
} from '@simrs/shared';
import { api } from '../../api';
import { ApiError } from '../../api-core';
import { ENCOUNTER_ID } from '../../../demo/fixtures/ids';
import { patientByEncounterId } from '../../../demo/fixtures/pasien';
import { demoEndangResume, demoInpatients } from '../../../demo/fixtures/rawat-inap';
import { applyResume } from '../../../rawat-inap-resume-toko';
import { hartonoResume, isDone, ratnaResume } from '../../../rawat-inap-scenario';
import type { SessionView } from '../../../session-view';
import { scenarioRuns } from '../../demo/scenario-context';
import { readDomain } from '../../demo/state';
import { assertDemo } from '../../demo-guard';
import { webEnv } from '../../web-env';
import { notImplemented } from '../not-implemented';

/**
 * K13 · Data layar Resume medis. Mode presentasi: resume fiktif + keadaan toko demo (`resume-medis`) + draf resume
 * pasien skenario, divalidasi kontrak yang sama dengan API (`summary` di `dischargeSummaryViewSchema`). Mode api (W5b):
 * `GET /api/v1/encounters/:id/discharge-summary` + banner `GET /api/v1/encounters/:id/context`.
 */

export type DischargeLookup =
  | { kind: 'resume'; summary: DischargeSummary; scenario: boolean }
  /** Pasien rawat inap yang belum direncanakan pulang. */
  | { kind: 'belum-disiapkan'; patientId: string }
  | null;

/**
 * Resume medis pulang; null = kunjungan tidak dikenal (halaman → 404). Pasien skenario baru punya draf resume
 * setelah dirawat (Tn. Hartono: serah terima `admisi.transfer`; Ny. Ratna: SEP rawat inap `admisi.sep`).
 */
export async function getDischargeSummary(
  session: SessionView,
  encounterId: string,
): Promise<DischargeLookup> {
  if (webEnv().dataSource === 'demo') {
    assertDemo();
    const runs = await scenarioRuns(session);
    if (encounterId === ENCOUNTER_ID.endang) {
      // Butir, rekonsiliasi, dan TTE tersimpan di toko demo (`resume-medis`, ADR-0085).
      const { state } = await readDomain('resume-medis');
      const summary = applyResume(demoEndangResume(), state);
      return { kind: 'resume', summary: dischargeSummarySchema.parse(summary), scenario: false };
    }
    const scenarioResume = [
      {
        enc: ENCOUNTER_ID.hartono,
        R: runs.results['igd-ranap'],
        admitted: ['admisi', 'transfer'],
        build: hartonoResume,
      },
      {
        enc: ENCOUNTER_ID.ratna,
        R: runs.results['elektif-btn'],
        admitted: ['admisi', 'sep'],
        build: ratnaResume,
      },
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

/** Mode api · resume kunjungan (final beku, atau draf/pratinjau dari sumber terkini). */
export function getDischargeSummaryApi(encounterId: string): Promise<DischargeSummaryView> {
  return api(`/api/v1/encounters/${encodeURIComponent(encounterId)}/discharge-summary`, {
    schema: dischargeSummaryViewSchema,
  });
}

/** Mode api · pasien yang saya rawat sebagai DPJP/rawat bersama (pintu daftar resume). */
export function getResumeWorklistApi(): Promise<Worklist> {
  return api('/api/v1/worklist?view=dpjp', { schema: worklistSchema });
}

/** Mode api · surat keterangan kematian kunjungan (keputusan K-1); null bila belum dibuat. */
export async function getDeathCertificateApi(encounterId: string): Promise<DeathCertificate | null> {
  try {
    return await api(`/api/v1/encounters/${encodeURIComponent(encounterId)}/death-certificate`, {
      schema: deathCertificateSchema,
    });
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}
