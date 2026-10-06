import 'server-only';
import {
  DESTRUCTION_ACTORS,
  LOAN_UNITS,
  RECORD_FILES,
  RECORD_LOANS,
  RETENTION_BATCHES,
  ROI_APPROVERS,
  ROI_REQUESTS,
} from '../../demo/fixtures/rekam-medis-adm';
import {
  GRANTED_PRIVILEGES,
  ORDER_GUARD_EVENTS,
  PRIVILEGE_APPLICATIONS,
} from '../../demo/fixtures/kredensial';
import { ASSETS, CALIBRATION_LABS, REPAIR_TICKETS, TECHNICIANS } from '../../demo/fixtures/aset';
import { patientById } from '../../demo/fixtures/pasien';
import { AMS_REQUESTS, GYSSENS_DONE, GYSSENS_PENDING, RESTRICTIONS } from '../../demo/fixtures/ppra';
import {
  PAYROLL_APPROVERS,
  PAYROLL_INPUTS,
  PAYROLL_PERIOD,
  PAYROLL_PREPARER,
  SERVICE_FEES,
} from '../../demo/fixtures/penggajian';
import { draftRoster, EMPLOYEES, ROSTER_STAFF, ROSTER_UNIT } from '../../demo/fixtures/pegawai';
import {
  BUNDLE_AUDITS,
  BUNDLES,
  HAI_MONTH,
  HAI_SUSPECTS,
  handHygieneObservations,
  ISOLATION_REQUESTS,
  ISOLATION_ROOMS,
  ppeAudits,
} from '../../demo/fixtures/ppi';
import { assertDemo } from '../demo-guard';
import { webEnv } from '../web-env';
import { notImplemented } from './not-implemented';

/**
 * Fase 8–9 · Pintu data layar back office (B02–B13, I09 command center, I11 dataset riset). Mode presentasi: data
 * dummy fiktif (ADR-0023); mode api menunggu backend fase 8–9 (registri layar berstatus `demo`, jalur ini tidak
 * tercapai di luar presentasi).
 */

function demoOnly(domain: string): void {
  if (webEnv().dataSource !== 'demo') notImplemented(domain);
  assertDemo();
}

/** B09 · peminjaman berkas, pelepasan informasi/hak subjek data, retensi dan pemusnahan. */
export async function getRecordsAdmin() {
  demoOnly('rekam medis administratif');
  return {
    files: RECORD_FILES,
    loans: RECORD_LOANS,
    loanUnits: LOAN_UNITS,
    requests: ROI_REQUESTS.map((r) => {
      const p = patientById(r.patientId);
      return { ...r, patientName: p?.nama ?? '—', rm: p?.rm ?? '—' };
    }),
    approvers: ROI_APPROVERS,
    batches: RETENTION_BATCHES,
    destructionActors: DESTRUCTION_ACTORS,
  };
}
export type RecordsAdminData = Awaited<ReturnType<typeof getRecordsAdmin>>;

/** B03 · pegawai + izin praktik, dan draf jadwal dinas minggu depan satu unit. */
export async function getHr() {
  demoOnly('SDM dan kepegawaian');
  return { employees: EMPLOYEES, roster: ROSTER_UNIT, rosterStaff: ROSTER_STAFF, draft: draftRoster() };
}
export type HrData = Awaited<ReturnType<typeof getHr>>;

/** B04 · pengajuan kewenangan klinis, RKK berlaku, dan izin praktik praktisi (gerbang verifikasi/CPOE). */
export async function getCredentialing() {
  demoOnly('kredensial dan kewenangan klinis');
  return {
    applications: PRIVILEGE_APPLICATIONS,
    granted: GRANTED_PRIVILEGES,
    employees: EMPLOYEES,
    guardEvents: ORDER_GUARD_EVENTS,
  };
}

/** B07 · surveilans HAIs, observasi kebersihan tangan, audit bundle/APD, dan isolasi bulan berjalan. */
export async function getPpi() {
  demoOnly('PPI');
  return {
    month: HAI_MONTH,
    suspects: HAI_SUSPECTS,
    handHygiene: handHygieneObservations(),
    ppe: ppeAudits(),
    bundles: BUNDLES,
    bundleAudits: BUNDLE_AUDITS,
    rooms: ISOLATION_ROOMS,
    isolationRequests: ISOLATION_REQUESTS,
  };
}
export type PpiData = Awaited<ReturnType<typeof getPpi>>;

/** B02 · register aset, kalibrasi, dan tiket perbaikan. */
export async function getAssets() {
  demoOnly('aset dan pemeliharaan');
  return { assets: ASSETS, labs: CALIBRATION_LABS, tickets: REPAIR_TICKETS, technicians: TECHNICIANS };
}
export type AssetData = Awaited<ReturnType<typeof getAssets>>;

/** B05 · run gaji periode berjalan (angka simulasi). */
export async function getPayroll() {
  demoOnly('penggajian');
  return {
    period: PAYROLL_PERIOD,
    inputs: PAYROLL_INPUTS,
    serviceFees: SERVICE_FEES,
    preparer: PAYROLL_PREPARER,
    approvers: PAYROLL_APPROVERS,
  };
}

/** B08 · persetujuan antibiotik cadangan, audit Gyssens, katalog restriksi. */
export async function getAms() {
  demoOnly('PPRA');
  return { requests: AMS_REQUESTS, restrictions: RESTRICTIONS, pending: GYSSENS_PENDING, done: GYSSENS_DONE };
}
