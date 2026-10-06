import 'server-only';
import { BPJS_SERVICES } from '../../demo/fixtures/integrasi-bpjs';
import {
  PRESET_MESSAGES,
  type GatewayDevice,
  type PresetMessage,
} from '../../demo/fixtures/integrasi-perangkat';
import { DEMO_NOW, DEMO_TODAY } from '../../demo/fixtures/waktu';
import type { IntegrationState } from '../../integrasi-demo';
import type { Specimen } from '../../integrasi-perangkat';
import { readDomain } from '../demo/state';
import { assertDemo } from '../demo-guard';

/** Satu proyeksi toko per RS untuk seluruh konektor mode presentasi. */
export async function getSatusehatVisits() {
  assertDemo();
  const { state, rev } = await readDomain('integrasi');
  return { asOf: DEMO_NOW, visits: state.visits, fixed: state.fixed, audit: state.audit, rev };
}
export interface BpjsData {
  asOf: string;
  rev: number;
  services: typeof BPJS_SERVICES;
  bookings: IntegrationState['bookings'];
  beds: IntegrationState['beds'];
  aplicareLastSync: string;
  hfis: IntegrationState['hfis'];
  down: IntegrationState['down'];
  backlog: IntegrationState['backlog'];
  synchronized: IntegrationState['synchronized'];
}
export async function getBpjsConnector(): Promise<BpjsData> {
  assertDemo();
  const { state, rev } = await readDomain('integrasi');
  return {
    asOf: DEMO_NOW,
    rev,
    services: BPJS_SERVICES,
    bookings: state.bookings,
    beds: state.beds,
    aplicareLastSync: state.aplicareLastSync,
    hfis: state.hfis,
    down: state.down,
    backlog: state.backlog,
    synchronized: state.synchronized,
  };
}
export async function getKemenkesReports() {
  assertDemo();
  const { state, rev } = await readDomain('integrasi');
  return { asOf: DEMO_NOW, reports: state.reports, rev };
}
export interface GatewayData {
  asOf: string;
  rev: number;
  devices: readonly GatewayDevice[];
  presets: readonly PresetMessage[];
  processed: readonly string[];
  specimens: Specimen[];
  log: IntegrationState['gatewayLog'];
}
export async function getDeviceGateway(): Promise<GatewayData> {
  assertDemo();
  const { state, rev } = await readDomain('integrasi');
  const support = await readDomain('penunjang');
  return {
    asOf: DEMO_NOW,
    rev,
    devices: state.devices,
    presets: PRESET_MESSAGES,
    processed: state.processed,
    log: state.gatewayLog,
    specimens: support.state.samples.map((s) => ({
      labNo: s.labNo,
      patientName: s.patient.name,
      received: !!s.receivedAt,
    })),
  };
}
export async function getApiClients() {
  assertDemo();
  const { state, rev } = await readDomain('integrasi');
  return { asOf: DEMO_NOW, today: DEMO_TODAY, clients: state.clients, log: state.apiLog, rev };
}
