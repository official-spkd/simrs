import 'server-only';
import {
  DESTRUCTION_ACTORS,
  LOAN_UNITS,
  RECORD_FILES,
  RECORD_LOANS,
  RETENTION_BATCHES,
  ROI_REQUESTS,
} from '../../demo/fixtures/rekam-medis-adm';
import { ORDER_GUARD_EVENTS, PRIVILEGE_APPLICATIONS } from '../../demo/fixtures/kredensial';
import { ASSETS, CALIBRATION_LABS, TECHNICIANS } from '../../demo/fixtures/aset';
import { ACCREDITATION_CHAPTERS, DISTRIBUTION_UNITS } from '../../demo/fixtures/regulasi';
import {
  CHEMO_PLAN,
  CHEMO_VERIFIERS,
  ONCOLOGY_PATIENT_ID,
  PRE_CHEMO_LABS,
} from '../../demo/fixtures/onkologi';
import { cohort, DATASET_FIELDS, DATASET_REQUEST } from '../../demo/fixtures/dataset-riset';
import { patientById } from '../../demo/fixtures/pasien';
import { DEMO_NOW } from '../../demo/fixtures/waktu';
import { TRAINEES } from '../../demo/fixtures/pendidikan';
import { recentComplaints, surveyResponses } from '../../demo/fixtures/pengalaman';
import { AMS_REQUESTS, GYSSENS_PENDING, RESTRICTIONS } from '../../demo/fixtures/ppra';
import { PAYROLL_INPUTS, PAYROLL_PERIOD, SERVICE_FEES } from '../../demo/fixtures/penggajian';
import { EMPLOYEES, ROSTER_STAFF, ROSTER_UNIT } from '../../demo/fixtures/pegawai';
import {
  BUNDLES,
  HAI_SUSPECTS,
  ISOLATION_REQUESTS,
  ppeAudits,
} from '../../demo/fixtures/ppi';
import type { SessionView } from '../../session-view';
import { readDomain } from '../demo/state';
import { boardOf, frontOfficeStore, loketOf } from './front-office/toko';
import { liveCapacity, liveComputedIndicators } from './manajemen-live';
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
    batches: RETENTION_BATCHES,
    destructionActors: DESTRUCTION_ACTORS,
    store: await readDomain('rekam-medis-adm'),
  };
}
export type RecordsAdminData = Awaited<ReturnType<typeof getRecordsAdmin>>;

/** B03 · pegawai + izin praktik, dan draf jadwal dinas minggu depan satu unit. */
export async function getHr() {
  demoOnly('SDM dan kepegawaian');
  return {
    employees: EMPLOYEES,
    roster: ROSTER_UNIT,
    rosterStaff: ROSTER_STAFF,
    store: await readDomain('sdm'),
  };
}
export type HrData = Awaited<ReturnType<typeof getHr>>;

/** B04 · pengajuan kewenangan klinis, RKK berlaku, dan izin praktik praktisi (gerbang verifikasi/CPOE). */
export async function getCredentialing() {
  demoOnly('kredensial dan kewenangan klinis');
  return {
    applications: PRIVILEGE_APPLICATIONS,
    employees: EMPLOYEES,
    guardEvents: ORDER_GUARD_EVENTS,
    store: await readDomain('kredensial'),
  };
}

/** B07 · surveilans HAIs, observasi kebersihan tangan, audit bundle/APD, dan isolasi bulan berjalan. */
export async function getPpi() {
  demoOnly('PPI');
  return {
    suspects: HAI_SUSPECTS,
    ppe: ppeAudits(),
    bundles: BUNDLES,
    isolationRequests: ISOLATION_REQUESTS,
    store: await readDomain('ppi'),
  };
}
export type PpiData = Awaited<ReturnType<typeof getPpi>>;

/** B02 · register aset, kalibrasi, dan tiket perbaikan. */
export async function getAssets() {
  demoOnly('aset dan pemeliharaan');
  return { assets: ASSETS, labs: CALIBRATION_LABS, technicians: TECHNICIANS, store: await readDomain('aset') };
}
export type AssetData = Awaited<ReturnType<typeof getAssets>>;

/** B05 · run gaji periode berjalan (tarif iuran simulasi) + keadaan run di toko demo (domain `penggajian`). */
export async function getPayroll() {
  demoOnly('penggajian');
  return {
    period: PAYROLL_PERIOD,
    inputs: PAYROLL_INPUTS,
    serviceFees: SERVICE_FEES,
    store: await readDomain('penggajian'),
  };
}

/** B08 · persetujuan antibiotik cadangan, audit Gyssens, katalog restriksi. */
export async function getAms() {
  demoOnly('PPRA');
  return {
    requests: AMS_REQUESTS,
    restrictions: RESTRICTIONS,
    pending: GYSSENS_PENDING,
    store: await readDomain('ppra'),
  };
}

/** B12 · dokumen regulasi berversi, distribusi baca, dan bukti akreditasi. */
export async function getRegDocs() {
  demoOnly('dokumen regulasi');
  return {
    units: DISTRIBUTION_UNITS,
    chapters: ACCREDITATION_CHAPTERS,
    store: await readDomain('regulasi'),
  };
}

/** B13 · pengaduan terbuka, pengaduan 30 hari terakhir (INM-12), dan respons survei (INM-13). */
export async function getPatientExperience() {
  demoOnly('pengalaman pasien');
  return { recent: recentComplaints(), responses: surveyResponses(), store: await readDomain('pengaduan') };
}

/** B10 · peserta didik, supervisor, tingkat supervisi, dan logbook. */
export async function getEducation() {
  demoOnly('pendidikan klinik');
  return { trainees: TRAINEES, store: await readDomain('pendidikan') };
}

/**
 * I09 · Command center: bed per ruang dari papan Tempat tidur (domain `tempat-tidur` + skenario), papan IGD (domain
 * `klinis-igd`), dan antrean poli + loket dari papan antrean (domain `antrean`/`pendaftaran`): angka yang sama dengan
 * layar asalnya. IGD hanya label bed + keluhan (tanpa nama pasien). Keputusan alert di domain `command-center`.
 */
export async function getCommandCenter(session: SessionView) {
  demoOnly('command center');
  const [cap, fo, store] = await Promise.all([
    liveCapacity(session),
    frontOfficeStore(session),
    readDomain('command-center'),
  ]);
  const board = boardOf(fo);
  const loket = loketOf(fo);
  return {
    asOf: DEMO_NOW,
    wards: cap.wards,
    state: {
      minute: 0,
      beds: cap.beds,
      ed: cap.ed,
      queues: [
        {
          poliCode: 'LK',
          poliName: 'Loket pendaftaran',
          waiting: loket.waiting,
          current: loket.current?.ticketNo ?? null,
        },
        ...board.clinics.map((c) => ({
          poliCode: c.poliCode,
          poliName: c.poliName,
          waiting: c.waiting.length,
          current: c.current,
        })),
      ],
      ambulances: cap.ambulances,
    },
    store,
  };
}

/** I11 · satu permintaan dataset riset, kolom yang diminta, kohort sintetis, dan jejak akses awal. */
export async function getResearchDataset() {
  demoOnly('dataset riset');
  return {
    request: DATASET_REQUEST,
    fields: DATASET_FIELDS,
    rows: cohort(),
    store: await readDomain('dataset-riset'),
  };
}

/** B11 · rencana siklus kemoterapi satu pasien, lab pra-kemo, dan daftar verifikator. */
export async function getOncology() {
  demoOnly('onkologi');
  const patient = patientById(ONCOLOGY_PATIENT_ID);
  if (!patient) throw new Error('pasien onkologi fixture tidak ada');
  return { patient, plan: CHEMO_PLAN, labs: PRE_CHEMO_LABS, verifiers: CHEMO_VERIFIERS };
}

/**
 * B06 · indikator mutu yang dihitung dari data transaksi di toko demo: observasi PPI (domain `ppi`), pengaduan
 * (`pengaduan`), dan resume final dari klinis (`mutu` ← `resume-medis`).
 */
export async function getComputedIndicators() {
  demoOnly('indikator mutu');
  const { items, quality } = await liveComputedIndicators();
  return { items, store: quality };
}
