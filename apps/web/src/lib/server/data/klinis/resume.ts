import 'server-only';
import { type DischargeSummary, dischargeSummarySchema } from '@simrs/shared';
import { ENCOUNTER_ID } from '../../../demo/fixtures/ids';
import { patientByEncounterId } from '../../../demo/fixtures/pasien';
import { demoEndangResume, demoInpatients } from '../../../demo/fixtures/rawat-inap';
import { hartonoResume, isDone, ratnaResume } from '../../../rawat-inap-scenario';
import type { SessionView } from '../../../session-view';
import { scenarioRuns } from '../../demo/scenario-context';
import { assertDemo } from '../../demo-guard';
import { webEnv } from '../../web-env';
import { notImplemented } from '../not-implemented';

/**
 * K13 · Data layar Resume medis. Mode presentasi: resume fiktif + draf resume pasien skenario, divalidasi kontrak
 * yang sama dengan API kelak; mode api menunggu backend fase 3 (potongan 3.6, layar W5b; halaman menampilkan "Belum
 * tersambung").
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
      return { kind: 'resume', summary: dischargeSummarySchema.parse(demoEndangResume()), scenario: false };
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
