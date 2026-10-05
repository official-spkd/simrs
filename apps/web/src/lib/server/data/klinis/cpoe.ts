import 'server-only';
import {
  type CpoeContext,
  cpoeContextSchema,
  type CpoeEncounterRef,
  cpoeEncounterRefSchema,
} from '@simrs/shared';
import { z } from 'zod';
import { demoCpoeAvailable, demoCpoeContext, demoCpoeEncounters } from '../../../demo/fixtures/klinis';
import type { SessionView } from '../../../session-view';
import { scenarioRuns } from '../../demo/scenario-context';
import { assertDemo } from '../../demo-guard';
import { webEnv } from '../../web-env';
import { notImplemented } from '../not-implemented';

/**
 * K09 · Data layar Order & resep (CPOE). Mode presentasi: katalog dummy + proyeksi pasien skenario (Tn. Suryo, Tn.
 * Hartono) dari mesin Simulasi, divalidasi kontrak yang sama dengan API kelak; mode api menunggu backend fase 3
 * (potongan 3.4, layar W2; halaman menampilkan "Belum tersambung").
 */

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
    return z
      .array(cpoeEncounterRefSchema)
      .parse(demoCpoeEncounters(runs.results['rawat-jalan'], runs.results['igd-ranap']));
  }
  return notImplemented('CPOE');
}

/**
 * Ada konteks CPOE untuk kunjungan ini saat ini? (sama dengan `getCpoeContext(…) !== null`, tanpa membangun
 * konteksnya). Untuk layar lain (IGD, rawat inap, resume) agar tautan "Order" hanya tampil bila halaman CPOE
 * kunjungan itu bisa dibuka, bukan berujung 404.
 */
export async function hasCpoeContext(session: SessionView, encounterId: string): Promise<boolean> {
  if (webEnv().dataSource === 'demo') {
    assertDemo();
    const runs = await scenarioRuns(session);
    return demoCpoeAvailable(encounterId, runs.results['igd-ranap']);
  }
  return notImplemented('CPOE');
}
