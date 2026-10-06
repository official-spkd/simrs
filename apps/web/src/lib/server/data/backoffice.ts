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
import {
  ACCREDITATION_CHAPTERS,
  DISTRIBUTION_UNITS,
  DOC_APPROVERS,
  READ_RECEIPTS,
  REG_DOCS,
} from '../../demo/fixtures/regulasi';
import {
  CHEMO_PLAN,
  CHEMO_VERIFIERS,
  ONCOLOGY_PATIENT_ID,
  PRE_CHEMO_LABS,
} from '../../demo/fixtures/onkologi';
import {
  ACCESS_LOG_SEED,
  cohort,
  DATASET_APPROVERS,
  DATASET_FIELDS,
  DATASET_REQUEST,
} from '../../demo/fixtures/dataset-riset';
import { demoQueueBoard } from '../../demo/fixtures/front-office';
import { PO_RECEIPT_LINES, PO_SUPPLIER } from '../../demo/fixtures/logistik-terima';
import { dischargeRecords } from '../../demo/fixtures/mutu-transaksi';
import { patientById } from '../../demo/fixtures/pasien';
import { demoBeds, demoEdBoardBase, demoWards } from '../../demo/fixtures/rawat-inap';
import { DEMO_NOW } from '../../demo/fixtures/waktu';
import { LOGBOOK, TRAINEES } from '../../demo/fixtures/pendidikan';
import { OPEN_COMPLAINTS, recentComplaints, surveyResponses } from '../../demo/fixtures/pengalaman';
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
import { computeIndicators } from '../../mutu-transaksi';
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

/** B12 · dokumen regulasi berversi, distribusi baca, dan bukti akreditasi. */
export async function getRegDocs() {
  demoOnly('dokumen regulasi');
  return {
    docs: REG_DOCS,
    approvers: DOC_APPROVERS,
    units: DISTRIBUTION_UNITS,
    receipts: READ_RECEIPTS,
    chapters: ACCREDITATION_CHAPTERS,
  };
}

/** B13 · pengaduan terbuka, pengaduan 30 hari terakhir (INM-12), dan respons survei (INM-13). */
export async function getPatientExperience() {
  demoOnly('pengalaman pasien');
  return { complaints: OPEN_COMPLAINTS, recent: recentComplaints(), responses: surveyResponses() };
}

/** B10 · peserta didik, supervisor, tingkat supervisi, dan logbook. */
export async function getEducation() {
  demoOnly('pendidikan klinik');
  return { trainees: TRAINEES, logbook: LOGBOOK };
}

/**
 * I09 · Command center: bed per ruang (sama dengan Tempat tidur dan Dasbor), papan IGD, dan antrean poli dari
 * fixture layar asalnya; IGD hanya label bed + keluhan (tanpa nama pasien).
 */
export async function getCommandCenter() {
  demoOnly('command center');
  const ed = demoEdBoardBase();
  return {
    asOf: DEMO_NOW,
    wards: demoWards().map((w) => ({ code: w.code, name: w.name, beds: w.beds })),
    state: {
      minute: 0,
      beds: demoBeds().map((b) => ({ code: b.code, wardCode: b.wardCode, status: b.status })),
      ed: ed.items.map((i) => ({
        id: i.encounterId,
        label: `${i.bed ?? 'triase'} · ${i.chiefComplaint}`,
        status: i.status,
        losMinutes: i.losMinutes,
        triageLevel: i.triageLevel,
      })),
      queues: demoQueueBoard().clinics.map((c) => ({
        poliCode: c.poliCode,
        poliName: c.poliName,
        waiting: c.waiting.length,
        current: c.current,
      })),
      ambulances: ed.ambulancesIncoming,
    },
  };
}

/** I11 · satu permintaan dataset riset, kolom yang diminta, kohort sintetis, dan jejak akses awal. */
export async function getResearchDataset() {
  demoOnly('dataset riset');
  return {
    request: DATASET_REQUEST,
    fields: DATASET_FIELDS,
    rows: cohort(),
    approvers: DATASET_APPROVERS,
    log: ACCESS_LOG_SEED,
  };
}

/** B11 · rencana siklus kemoterapi satu pasien, lab pra-kemo, dan daftar verifikator. */
export async function getOncology() {
  demoOnly('onkologi');
  const patient = patientById(ONCOLOGY_PATIENT_ID);
  if (!patient) throw new Error('pasien onkologi fixture tidak ada');
  return { patient, plan: CHEMO_PLAN, labs: PRE_CHEMO_LABS, verifiers: CHEMO_VERIFIERS };
}

/** B01 · baris PO tahap "kirim" untuk penerimaan barang di layar Logistik. */
export async function getGoodsReceiptLines() {
  demoOnly('penerimaan barang');
  return { lines: PO_RECEIPT_LINES, suppliers: PO_SUPPLIER };
}

/** B06 · indikator mutu yang dihitung dari data transaksi layar PPI, pengalaman pasien, dan rekam medis. */
export async function getComputedIndicators() {
  demoOnly('indikator mutu');
  return computeIndicators({
    handHygiene: handHygieneObservations(),
    ppe: ppeAudits(),
    complaints: recentComplaints(),
    survey: surveyResponses(),
    discharges: dischargeRecords(),
    now: DEMO_NOW,
  });
}
