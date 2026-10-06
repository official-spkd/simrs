import 'server-only';
import {
  type DoctorAppInbox,
  doctorAppInboxSchema,
  type IntegrationOverview,
  integrationOverviewSchema,
  type LogisticsOverview,
  logisticsOverviewSchema,
  type PatientAppHome,
  patientAppHomeSchema,
  type QualityOverview,
  qualityOverviewSchema,
} from '@simrs/shared';
import {
  demoIntegrationOverview,
  demoLogisticsOverview,
  demoQualityOverview,
} from '../../demo/fixtures/manajemen';
import { hartonoCpoeOpen } from '../../demo/fixtures/klinis';
import { encounterIdOf } from '../../demo/fixtures/pasien';
import { PATIENT_ID } from '../../demo/fixtures/ids';
import { doctorAppInbox, hartonoLabOrdered, patientAppHome } from '../../manajemen-aplikasi';
import type { ReceiptLine } from '../../logistik-terima';
import {
  inventoryNow,
  inventoryValue,
  openPoItems,
  poNumber,
  procurementRows,
  receiptLinesOf,
  supplierOf,
} from '../../logistik-toko';
import { readDomain } from '../demo/state';
import type { SessionView } from '../../session-view';
import { scenarioRuns } from '../demo/scenario-context';
import { assertDemo } from '../demo-guard';
import { webEnv } from '../web-env';
import { notImplemented } from './not-implemented';

/**
 * B01/B06/I01–I08 · Satu-satunya pintu data layar domain manajemen. Mode presentasi: data dummy + proyeksi
 * pasien skenario, divalidasi kontrak yang sama dengan API kelak (ADR-0023); mode api menunggu backend.
 */

const isDemo = () => {
  if (webEnv().dataSource !== 'demo') return false;
  assertDemo();
  return true;
};

/** I01–I06 · volume hari ini ikut bertambah oleh pesan keluar jejak ketiga skenario Simulasi. */
export async function getIntegrationOverview(session: SessionView): Promise<IntegrationOverview> {
  if (!isDemo()) return notImplemented('integration hub');
  const runs = await scenarioRuns(session);
  const logs = Object.values(runs.results).flatMap((r) => r.logs);
  return integrationOverviewSchema.parse(demoIntegrationOverview(logs));
}

export async function getLogisticsOverview(): Promise<LogisticsOverview> {
  if (!isDemo()) return notImplemented('logistik');
  return (await getLogisticsBoard()).overview;
}

/**
 * B01 · Logistik dari toko demo (domain `logistik`, ADR-0085): stok + penerimaan, pengadaan berjalan dengan tahap
 * dari kejadian, baris penerimaan PO, dan item yang terkunci di PO terbuka. Satu jalur untuk halaman dan Dasbor.
 */
export async function getLogisticsBoard() {
  if (!isDemo()) return notImplemented('logistik');
  const store = await readDomain('logistik');
  const s = store.state;
  const base = demoLogisticsOverview();
  const rows = procurementRows(s);
  const overview = logisticsOverviewSchema.parse({
    ...base,
    kpi: { ...base.kpi, inventoryValue: inventoryValue(s).toString() },
    reorder: inventoryNow(s),
    purchaseOrders: rows.map(({ id, title, total, stage, statusText }) => ({ id, title, total, stage, statusText })),
    nextPoNumber: poNumber(s.nextPoSeq),
  });
  const receiptLines: Record<string, readonly ReceiptLine[]> = {};
  const suppliers: Record<string, string> = {};
  for (const r of rows) {
    const lines = receiptLinesOf(s, r.id);
    if (lines) {
      receiptLines[r.id] = lines;
      suppliers[r.id] = supplierOf(s, r.id);
    }
  }
  return { overview, rows, store, receiptLines, suppliers, openPo: openPoItems(s) };
}
export type LogisticsBoardData = Awaited<ReturnType<typeof getLogisticsBoard>>;

export async function getQualityOverview(): Promise<QualityOverview> {
  if (!isDemo()) return notImplemented('mutu dan keselamatan pasien');
  return qualityOverviewSchema.parse(demoQualityOverview());
}

/** I07 · beranda aplikasi Tn. Suryo (skenario rawat jalan). */
export async function getPatientAppHome(session: SessionView): Promise<PatientAppHome> {
  if (!isDemo()) return notImplemented('aplikasi pasien');
  const runs = await scenarioRuns(session);
  return patientAppHomeSchema.parse(patientAppHome(runs.results['rawat-jalan']));
}

/**
 * I08 · kotak masuk aplikasi dokter; `rev` dipakai tombol read-back yang memajukan skenario IGD. `labOrdered`
 * membedakan "belum ada order lab" dari "hasil sedang diproses" selama nilai kritis menunggu hasil (belum ada di
 * kontrak `doctorAppInboxSchema`).
 */
export async function getDoctorAppInbox(
  session: SessionView,
): Promise<{ inbox: DoctorAppInbox; rev: number; labOrdered: boolean; orderHref: string | null }> {
  if (!isDemo()) return notImplemented('aplikasi dokter');
  const runs = await scenarioRuns(session);
  const R = runs.results['igd-ranap'];
  return {
    inbox: doctorAppInboxSchema.parse(doctorAppInbox(R)),
    rev: runs.rev,
    labOrdered: hartonoLabOrdered(R),
    // "Buka order" (mockup AppDokter) membuka CPOE kunjungan IGD Tn. Hartono setelah kunjungan itu ada di CPOE.
    orderHref: hartonoCpoeOpen(R) ? `/klinis/order/${encounterIdOf(PATIENT_ID.hartono)}` : null,
  };
}
