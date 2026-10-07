import 'server-only';
import {
  type CpoeContext,
  cpoeContextSchema,
  type CpoeEncounterRef,
  cpoeEncounterRefSchema,
  type EncounterContext,
  encounterContextSchema,
  type OrderGroup,
  orderGroupSchema,
  type OrderSetView,
  orderSetViewSchema,
  type WorklistPatient,
  worklistSchema,
} from '@simrs/shared';
import { z } from 'zod';
import { demoCpoeAvailable, demoCpoeContext, demoCpoeEncounters } from '../../../demo/fixtures/klinis';
import { patientByEncounterId } from '../../../demo/fixtures/pasien';
import { applySentOrders } from '../../../klinis-order-toko';
import { readDomain } from '../../demo/state';
import { can, type SessionView } from '../../../session-view';
import { api } from '../../api';
import { scenarioRuns } from '../../demo/scenario-context';
import { assertDemo } from '../../demo-guard';
import { webEnv } from '../../web-env';
import { notImplemented } from '../not-implemented';

/**
 * K09 · Data layar Order & resep (CPOE). Mode presentasi: katalog dummy + order tersimpan di toko demo (`klinis-order`,
 * ADR-0085) + proyeksi pasien skenario (Tn. Suryo, Tn. Hartono) dari mesin Simulasi, divalidasi kontrak yang sama
 * dengan API kelak. Mode api (layar W2): banner kunjungan (`/encounters/:id/context`), order set, dan kiriman order
 * kunjungan dari API (izin + ABAC ditegakkan API).
 */

/** Konteks CPOE kunjungan; null bila kunjungan tidak dikenal (halaman → 404). */
export async function getCpoeContext(session: SessionView, encounterId: string): Promise<CpoeContext | null> {
  if (webEnv().dataSource === 'demo') {
    assertDemo();
    const runs = await scenarioRuns(session);
    const c = demoCpoeContext(encounterId, runs.results['rawat-jalan'], runs.results['igd-ranap']);
    if (!c) return null;
    // Order yang sudah ditandatangani tersimpan di toko demo (`klinis-order`); pasien skenario mengikuti Simulasi.
    if (patientByEncounterId(encounterId)?.scenario) return cpoeContextSchema.parse(c);
    const { state } = await readDomain('klinis-order');
    return cpoeContextSchema.parse(applySentOrders(c, state));
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
  // Mode api: halaman CPOE sendiri menjawab kunjungan tak dikenal/di luar akses dengan pesan tertulis (bukan 404).
  return z.uuid().safeParse(encounterId).success && can(session, 'order', 'read');
}

/** Mode api: banner pasien + kunjungan (`id` sudah divalidasi UUID oleh pemanggil). */
export function getEncounterContextApi(encounterId: string): Promise<EncounterContext> {
  return api(`/api/v1/encounters/${encounterId}/context`, { schema: encounterContextSchema });
}

/** Mode api: order set institusi aktif. */
export function getOrderSetsApi(): Promise<OrderSetView[]> {
  return api('/api/v1/orders/order-sets', { schema: z.array(orderSetViewSchema) });
}

/** Mode api: semua kiriman order kunjungan (terbaru dulu) dengan status, temuan CDS, dan resep. */
export function getEncounterOrdersApi(encounterId: string): Promise<OrderGroup[]> {
  return api(`/api/v1/encounters/${encounterId}/orders`, { schema: z.array(orderGroupSchema) });
}

/** Kunjungan yang bisa dibuka di CPOE mode api + jumlah order residen yang menunggu tinjauan saya. */
export interface CpoeApiEncounter extends WorklistPatient {
  reviewTasks: number;
}

/**
 * Mode api: pilihan kunjungan CPOE dari worklist K01 (`/api/v1/worklist`): pasien tempat saya DPJP/rawat bersama
 * (`dpjp`) + pasien di unit penugasan (`unit`), ABAC + audit per pasien oleh API. Kunjungan dengan order residen yang
 * menunggu tinjauan saya tampil teratas.
 */
export async function getCpoeEncountersApi(): Promise<CpoeApiEncounter[]> {
  const [mine, unit] = await Promise.all([
    api('/api/v1/worklist?view=dpjp', { schema: worklistSchema }),
    api('/api/v1/worklist?view=unit', { schema: worklistSchema }),
  ]);
  const reviews = new Map<string, number>();
  for (const task of mine.tasks) {
    if (task.kind === 'review_order' && task.encounterId) {
      reviews.set(task.encounterId, (reviews.get(task.encounterId) ?? 0) + 1);
    }
  }
  const byId = new Map<string, CpoeApiEncounter>();
  for (const p of [...mine.patients, ...unit.patients]) {
    if (!byId.has(p.encounterId))
      byId.set(p.encounterId, { ...p, reviewTasks: reviews.get(p.encounterId) ?? 0 });
  }
  return [...byId.values()].sort(
    (a, b) => b.reviewTasks - a.reviewTasks || a.name.localeCompare(b.name, 'id'),
  );
}
