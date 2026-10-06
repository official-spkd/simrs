import 'server-only';
import {
  APLICARE_LAST_SYNC,
  BPJS_SERVICES,
  demoBedClasses,
  demoBookings,
  demoHfis,
} from '../../demo/fixtures/integrasi-bpjs';
import { demoSatusehatVisits } from '../../demo/fixtures/integrasi-satusehat';
import { DEMO_NOW } from '../../demo/fixtures/waktu';
import type { BedClassRow, BookingTasks, BpjsService, HfisRow } from '../../integrasi-bpjs';
import type { Visit } from '../../integrasi-satusehat';
import { assertDemo } from '../demo-guard';
import { webEnv } from '../web-env';
import { notImplemented } from './not-implemented';

/**
 * I02–I04, I06, I12 · Pintu data layar konektor integrasi (SATUSEHAT, BPJS, Kemenkes, perangkat medis, API publik).
 * Mode presentasi: data dummy fiktif (ADR-0023); mode api menunggu backend fase 7. Server Action mencari rekaman
 * lewat fixture yang sama (klien hanya mengirim id).
 */

const isDemo = () => {
  if (webEnv().dataSource !== 'demo') return false;
  assertDemo();
  return true;
};

export async function getSatusehatVisits(): Promise<{ asOf: string; visits: Visit[] }> {
  if (!isDemo()) return notImplemented('konektor SATUSEHAT');
  return { asOf: DEMO_NOW, visits: demoSatusehatVisits() };
}

export interface BpjsData {
  asOf: string;
  services: readonly BpjsService[];
  bookings: BookingTasks[];
  beds: BedClassRow[];
  aplicareLastSync: string;
  hfis: HfisRow[];
}

export async function getBpjsConnector(): Promise<BpjsData> {
  if (!isDemo()) return notImplemented('konektor BPJS');
  return {
    asOf: DEMO_NOW,
    services: BPJS_SERVICES,
    bookings: demoBookings(),
    beds: demoBedClasses(),
    aplicareLastSync: APLICARE_LAST_SYNC,
    hfis: demoHfis(),
  };
}
