import 'server-only';
import {
  APLICARE_LAST_SYNC,
  BPJS_SERVICES,
  demoBedClasses,
  demoBookings,
  demoHfis,
} from '../../demo/fixtures/integrasi-bpjs';
import { demoAccessLog, demoApiClients } from '../../demo/fixtures/integrasi-api-publik';
import { demoKemenkesReports } from '../../demo/fixtures/integrasi-kemenkes';
import {
  DEVICES,
  type GatewayDevice,
  PRESET_MESSAGES,
  type PresetMessage,
  PROCESSED_TODAY,
} from '../../demo/fixtures/integrasi-perangkat';
import { demoLabSamples } from '../../demo/fixtures/penunjang';
import { demoSatusehatVisits } from '../../demo/fixtures/integrasi-satusehat';
import { DEMO_NOW, DEMO_TODAY } from '../../demo/fixtures/waktu';
import type { AccessLog, ApiClient } from '../../integrasi-api-publik';
import type { KemenkesReport } from '../../integrasi-kemenkes';
import type { Specimen } from '../../integrasi-perangkat';
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

export async function getKemenkesReports(): Promise<{ asOf: string; reports: KemenkesReport[] }> {
  if (!isDemo()) return notImplemented('konektor Kemenkes');
  return { asOf: DEMO_NOW, reports: demoKemenkesReports() };
}

export interface GatewayData {
  asOf: string;
  devices: readonly GatewayDevice[];
  presets: readonly PresetMessage[];
  processed: readonly string[];
  specimens: Specimen[];
}

/** Spesimen yang dikenal gateway = worklist Laboratorium hari demo (nomor lab + sudah diterima atau belum). */
export async function getDeviceGateway(): Promise<GatewayData> {
  if (!isDemo()) return notImplemented('device gateway');
  return {
    asOf: DEMO_NOW,
    devices: DEVICES,
    presets: PRESET_MESSAGES,
    processed: PROCESSED_TODAY,
    specimens: demoLabSamples().map((s) => ({
      labNo: s.labNo,
      patientName: s.patient.name,
      received: s.receivedAt !== null,
    })),
  };
}

export async function getApiClients(): Promise<{
  asOf: string;
  today: string;
  clients: ApiClient[];
  log: AccessLog[];
}> {
  if (!isDemo()) return notImplemented('API publik dan FHIR');
  return { asOf: DEMO_NOW, today: DEMO_TODAY, clients: demoApiClients(), log: demoAccessLog() };
}
