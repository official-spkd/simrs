import 'server-only';
import {
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
import {
  APP_READBACK_ROLE,
  applyLiveQueue,
  doctorAppInbox,
  hartonoLabOrdered,
  patientAppHome,
} from '../../manajemen-aplikasi';
import { getCriticalCenter } from './penunjang-lanjut';
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
import { boardOf, frontOfficeStore, scheduleOf } from './front-office/toko';
import { DEMO_TODAY } from '../../demo/fixtures/waktu';
import { liveComputedIndicators } from './manajemen-live';
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

/**
 * B06 · indikator mutu: indikator yang dihitung mesin indikator (kebersihan tangan, APD, tanggap komplain, kepuasan,
 * resume ≤ 24 jam) memakai nilai dari keadaan toko (titik terakhir tren = bulan berjalan), sisanya profil fixture.
 */
export async function getQualityOverview(): Promise<QualityOverview> {
  if (!isDemo()) return notImplemented('mutu dan keselamatan pasien');
  const base = demoQualityOverview();
  const { items } = await liveComputedIndicators();
  const live = new Map(items.map((c) => [c.id, c.value]));
  return qualityOverviewSchema.parse({
    ...base,
    indicators: base.indicators.map((q) => {
      const v = live.get(q.id);
      return v === undefined ? q : { ...q, value: v, trend: [...q.trend.slice(0, -1), v] };
    }),
  });
}

/** Slot praktik yang bisa dibooking dari aplikasi pasien (hari ini s.d. akhir minggu jadwal, kuota JKN tersisa). */
export interface BookableSlot {
  slotId: string;
  doctorId: string;
  doctorName: string;
  poliCode: string;
  poliName: string;
  date: string;
  start: string;
  left: number;
}

/** Slot praktik dari Jadwal dokter (domain `jadwal` + `pendaftaran`, CD-3): kuota JKN tersisa, bukan cuti. */
export function bookableSlots(schedule: ReturnType<typeof scheduleOf>): BookableSlot[] {
  return schedule.doctors.flatMap((d) =>
    d.slots.flatMap((s) =>
      s.kind === 'praktik' && s.quota && s.start && s.date > DEMO_TODAY && s.quota.jkn - s.quota.bookedJkn > 0
        ? [
            {
              slotId: s.id,
              doctorId: d.id,
              doctorName: d.name,
              poliCode: d.poliCode,
              poliName: d.poliName,
              date: s.date,
              start: s.start,
              left: s.quota.jkn - s.quota.bookedJkn,
            },
          ]
        : [],
    ),
  );
}

/**
 * I07 · beranda aplikasi Tn. Suryo: kemajuan skenario rawat jalan + posisi antrean poli HIDUP dari papan antrean
 * (domain `antrean`, CD-3; dimajukan panggilan papan TV/poli), aksi aplikasi tersimpan (domain `aplikasi-pasien`),
 * dan slot booking dari Jadwal dokter. Notifikasi "tersisa 3" / "giliran Anda" dihitung dari posisi hidup.
 */
export async function getPatientAppHome(session: SessionView) {
  if (!isDemo()) return notImplemented('aplikasi pasien');
  const [runs, fo, store] = await Promise.all([
    scenarioRuns(session),
    frontOfficeStore(session),
    readDomain('aplikasi-pasien'),
  ]);
  const base = patientAppHome(runs.results['rawat-jalan']);
  const live = applyLiveQueue(base, boardOf(fo).clinics.find((c) => c.poliCode === 'PD') ?? null);
  const queue = live.queue;
  const extraFeed: PatientAppHome['feed'] = [...live.notes];
  const st = store.state;
  for (const b of st.bookings) {
    if (b.cancelled) continue;
    extraFeed.push(
      b.onLeave
        ? { id: `booking-cuti-${b.code}`, title: 'Jadwal dokter berubah', detail: `${b.doctorName} cuti ${b.date}; pilih jadwal lain`, when: b.jam, tone: 'danger' }
        : { id: `booking-${b.code}`, title: `Booking ${b.code} terdaftar`, detail: `${b.poliName} · ${b.doctorName} · ${b.date} ${b.start}`, when: b.jam, tone: 'brand' },
    );
  }
  const glucose = [...base.glucose, ...st.glucose.map((g) => ({ date: DEMO_TODAY, value: g.value }))].slice(-7);
  const home = patientAppHomeSchema.parse({ ...base, queue, glucose, feed: [...extraFeed, ...base.feed] });
  return {
    home,
    store,
    slots: bookableSlots(scheduleOf(fo)).filter((s) => !st.leaves.includes(s.slotId)),
    glucoseAt: st.glucose.at(-1)?.jam ?? null,
  };
}

/**
 * I08 · kotak masuk aplikasi dokter; `rev` dipakai tombol read-back yang memajukan skenario IGD. `labOrdered`
 * membedakan "belum ada order lab" dari "hasil sedang diproses" selama nilai kritis menunggu hasil (belum ada di
 * kontrak `doctorAppInboxSchema`).
 */
export async function getDoctorAppInbox(
  session: SessionView,
) {
  if (!isDemo()) return notImplemented('aplikasi dokter');
  const runs = await scenarioRuns(session);
  const R = runs.results['igd-ranap'];
  const [center, critical, app] = await Promise.all([
    getCriticalCenter(session),
    readDomain('hasil-kritis'),
    readDomain('aplikasi-dokter'),
  ]);
  // Nilai kritis lain (bukan pasien skenario) dari Pusat hasil kritis: yang masih terbuka dan yang diterima di aplikasi.
  const criticals = center.items
    .filter((i) => !i.scenario && (!i.report || i.report.recipientRole === APP_READBACK_ROLE))
    .slice(0, 4)
    .map((i) => ({
      id: i.id,
      patientName: i.patient.name,
      rm: i.patient.rm,
      location: i.location,
      test: i.test,
      valueText: i.valueText,
      raisedAt: i.raisedAt,
      report: i.report ? { recipient: i.report.recipient, reportedAt: i.report.reportedAt } : null,
    }));
  return {
    criticals,
    criticalRev: critical.rev,
    app,
    inbox: doctorAppInboxSchema.parse(doctorAppInbox(R)),
    rev: runs.rev,
    labOrdered: hartonoLabOrdered(R),
    // "Buka order" (mockup AppDokter) membuka CPOE kunjungan IGD Tn. Hartono setelah kunjungan itu ada di CPOE.
    orderHref: hartonoCpoeOpen(R) ? `/klinis/order/${encounterIdOf(PATIENT_ID.hartono)}` : null,
  };
}
