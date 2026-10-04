import 'server-only';
import {
  type CpoeContext,
  cpoeContextSchema,
  type CpoeEncounterRef,
  cpoeEncounterRefSchema,
  type PoliEncounter,
  poliEncounterSchema,
  type PoliWorklist,
  poliWorklistSchema,
} from '@simrs/shared';
import { z } from 'zod';
import {
  demoCpoeContext,
  demoCpoeEncounters,
  demoPoliEncounter,
  demoPoliWorklist,
} from '../../demo/fixtures/klinis';
import type { SessionView } from '../../session-view';
import { assertDemo } from '../demo-guard';
import { scenarioRuns } from '../demo/scenario-context';
import { webEnv } from '../web-env';
import { notImplemented } from './not-implemented';

/**
 * K01/K02/K09 · Satu-satunya pintu data layar Pemeriksaan poli dan CPOE. Mode presentasi: data dummy + proyeksi
 * pasien skenario (Tn. Suryo, Tn. Hartono) dari mesin Simulasi, divalidasi kontrak yang sama dengan API kelak;
 * mode api menunggu backend fase 3.
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

/** Konteks CPOE kunjungan; null bila kunjungan tidak dikenal (halaman → 404). */
export async function getCpoeContext(session: SessionView, encounterId: string): Promise<CpoeContext | null> {
  if (webEnv().dataSource === 'demo') {
    assertDemo();
    const runs = await scenarioRuns(session);
    const c = demoCpoeContext(encounterId, runs.results['rawat-jalan'], runs.results['igd-ranap']);
    return c ? cpoeContextSchema.parse(c) : null;
  }
  return notImplemented('CPOE');
}

export async function getCpoeEncounters(session: SessionView): Promise<CpoeEncounterRef[]> {
  if (webEnv().dataSource === 'demo') {
    assertDemo();
    const runs = await scenarioRuns(session);
    return z.array(cpoeEncounterRefSchema).parse(demoCpoeEncounters(runs.results['rawat-jalan']));
  }
  return notImplemented('CPOE');
}
