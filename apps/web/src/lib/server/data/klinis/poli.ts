import 'server-only';
import { type PoliEncounter, poliEncounterSchema, type PoliWorklist, poliWorklistSchema } from '@simrs/shared';
import { demoPoliEncounter, demoPoliWorklist } from '../../../demo/fixtures/klinis';
import type { SessionView } from '../../../session-view';
import { scenarioRuns } from '../../demo/scenario-context';
import { assertDemo } from '../../demo-guard';
import { webEnv } from '../../web-env';
import { notImplemented } from '../not-implemented';

/**
 * K01/K02 · Data layar Pemeriksaan poli. Mode presentasi: data dummy + proyeksi pasien skenario rawat jalan (Tn.
 * Suryo) dari mesin Simulasi, divalidasi kontrak yang sama dengan API kelak; mode api menunggu backend fase 3
 * (layar W1, halaman menampilkan "Belum tersambung").
 */

export async function getPoliWorklist(session: SessionView): Promise<PoliWorklist> {
  if (webEnv().dataSource === 'demo') {
    assertDemo();
    const runs = await scenarioRuns(session);
    return poliWorklistSchema.parse(demoPoliWorklist(runs.results['rawat-jalan']));
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
    const runs = await scenarioRuns(session);
    const e = demoPoliEncounter(patientId, runs.results['rawat-jalan']);
    return e ? poliEncounterSchema.parse(e) : null;
  }
  return notImplemented('pemeriksaan poli');
}
