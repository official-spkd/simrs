import 'server-only';
import {
  type PoliEncounter,
  poliEncounterSchema,
  type PoliVisit,
  poliVisitSchema,
  type PoliWorklist,
  type PoliWorklistApi,
  poliWorklistApiSchema,
  poliWorklistSchema,
} from '@simrs/shared';
import { api } from '../../api';
import { demoPoliEncounter, demoPoliWorklist } from '../../../demo/fixtures/klinis';
import { applyPoliEncounter, applyPoliQueue } from '../../../klinis-poli-toko';
import type { SessionView } from '../../../session-view';
import { scenarioRuns } from '../../demo/scenario-context';
import { readDomain } from '../../demo/state';
import { assertDemo } from '../../demo-guard';
import { webEnv } from '../../web-env';
import { notImplemented } from '../not-implemented';
import { patientById } from '../../../demo/fixtures/pasien';

/**
 * K01/K02 · Data layar Pemeriksaan poli. Mode presentasi: data dummy + keadaan toko demo (`klinis-poli`, ADR-0085)
 * + proyeksi pasien skenario rawat jalan (Tn. Suryo) dari mesin Simulasi, divalidasi kontrak yang sama dengan API. Mode
 * api (W1): `GET /api/v1/poli/worklist` dan `GET /api/v1/encounters/:id/poli-visit` (bentuk kontrak sama + bagian
 * `api` untuk aksi).
 */

export async function getPoliWorklist(session: SessionView): Promise<PoliWorklist> {
  if (webEnv().dataSource === 'demo') {
    assertDemo();
    const [runs, { state }] = await Promise.all([scenarioRuns(session), readDomain('klinis-poli')]);
    return poliWorklistSchema.parse(applyPoliQueue(demoPoliWorklist(runs.results['rawat-jalan']), state));
  }
  return notImplemented('pemeriksaan poli');
}

/** Ringkasan kunjungan pasien di antrean poli hari ini; null bila pasien tidak ada di antrean. */
export async function getPoliEncounter(
  session: SessionView,
  patientId: string,
): Promise<PoliEncounter | null> {
  if (webEnv().dataSource === 'demo') {
    assertDemo();
    const [runs, { state }] = await Promise.all([scenarioRuns(session), readDomain('klinis-poli')]);
    const e = demoPoliEncounter(patientId, runs.results['rawat-jalan']);
    if (!e) return null;
    // Pasien skenario (Tn. Suryo) mengikuti Simulasi; pasien lain memakai CPPT/tanda vital tersimpan di toko demo.
    return poliEncounterSchema.parse(isScenario(e) ? e : applyPoliEncounter(e, state));
  }
  return notImplemented('pemeriksaan poli');
}

function isScenario(e: PoliEncounter): boolean {
  return patientById(e.patient.id)?.scenario !== undefined;
}

/** Mode api · antrean poli hari ini untuk unit penugasan sesi. */
export function getPoliWorklistApi(): Promise<PoliWorklistApi> {
  return api('/api/v1/poli/worklist', { schema: poliWorklistApiSchema });
}

/** Mode api · kunjungan rawat jalan dalam bentuk layar poli. */
export function getPoliVisitApi(encounterId: string): Promise<PoliVisit> {
  return api(`/api/v1/encounters/${encodeURIComponent(encounterId)}/poli-visit`, { schema: poliVisitSchema });
}
