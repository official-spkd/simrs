import 'server-only';
import { PATIENT_ID } from '../../demo/fixtures/ids';
import { PASIEN } from '../../demo/fixtures/pasien';
import type { ModuleState, SamplePatient } from '../../platform-pengaturan';
import type { SettingsStoreState } from '../../platform-pengaturan-toko';
import { DOCUMENT_PATIENT_IDS } from '../../demo/fixtures/dokumen';
import { PERSONA, STAF } from '../../demo/fixtures/staf';
import type { DocPatient } from '../../platform-dokumen';
import type { DocumentStoreState } from '../../platform-dokumen-toko';
import type { JobsStoreState } from '../../platform-penjadwal-toko';
import type { StructureStoreState } from '../../platform-struktur-toko';
import { DEMO_NOW, DEMO_TODAY, shiftDate } from '../../demo/fixtures/waktu';
import type { ReferralStoreState } from '../../rujukan-toko';
import { DOWNTIME_PAPER_FORMS, EMERGENCY_PACK, MANIFEST_ROWS } from '../../demo/fixtures/operasional';
import type { BackupStoreState } from '../../operasional-backup-toko';
import { GOLIVE_CHECKLIST, GOLIVE_OWNERS, MRMIK_EPS } from '../../demo/fixtures/golive';
import type { ChecklistArea, MrmikEp } from '../../golive';
import type { GoLiveStoreState } from '../../golive-toko';
import type { PaperForm } from '../../operasional-downtime';
import {
  type DowntimeBanner,
  downtimeBannerOf,
  type DowntimeStoreState,
} from '../../operasional-downtime-toko';
import { readDomain } from '../demo/state';
import type { PublicQueue, PublicSchedule } from '@simrs/shared';
import type { SessionView } from '../../session-view';
import { boardOf, frontOfficeStore, loketOf, quotasOf } from './front-office/toko';
import {
  DEMO_PUBLIC_BOOKINGS,
  PUBLIC_BOOKING_HINT,
  PUBLIC_EXTRA_SERVICES,
} from '../../demo/fixtures/info-publik';
import { type PublicBookingRecord, publicQueueFrom, publicScheduleFrom } from '../../info-publik';
import type { TerminologyStoreState } from '../../platform-terminologi-toko';
import { DEMO_IMPORT_FILES, type DemoImportFile } from '../../demo/fixtures/terminologi';
import { assertDemo } from '../demo-guard';
import { webEnv } from '../web-env';
import { notImplemented } from './not-implemented';

/**
 * FE1 · Satu-satunya pintu data layar demo platform dan operasional (P01, P06, P08, P10–P13, F07, F08, backup,
 * go-live). Mode presentasi: fixture fiktif (ADR-0023); mode api menunggu layar disambungkan ke endpoint yang ada
 * (P01/P06/P08/P10 sudah punya API fase 1) atau backend fase 10.
 */

const isDemo = () => {
  if (webEnv().dataSource !== 'demo') return false;
  assertDemo();
  return true;
};

function samplePatient(id: string): SamplePatient {
  const p = PASIEN.find((x) => x.id === id);
  if (!p) throw new Error('Pasien contoh tidak ada di fixture');
  return {
    nama: p.nama,
    rm: p.rm,
    tanggalLahir: p.tanggalLahir,
    jk: p.jk,
    alergi: p.alergi,
    penjamin: p.penjamin,
  };
}

export async function getFacilityStructure(): Promise<{ state: StructureStoreState; rev: number }> {
  if (!isDemo()) return notImplemented('struktur RS (layar demo)');
  return readDomain('struktur');
}

export async function getTenantSettingsOverview(): Promise<{
  store: { state: SettingsStoreState; rev: number };
  sample: SamplePatient;
}> {
  if (!isDemo()) return notImplemented('pengaturan RS (layar demo)');
  return {
    store: await readDomain('pengaturan'),
    // Ny. Endang: beralergi, sehingga penanda alergi di gelang/label terlihat di pratinjau.
    sample: samplePatient(PATIENT_ID.endang),
  };
}

/**
 * Modul aktif RS demo sesi ini (toko demo `pengaturan`) untuk menyembunyikan menu modul yang mati (CD-0, dengan
 * `screenHiddenByModules`). Mode api: null (modul aktif sungguhan dari `tenant_modules` lewat API).
 */
export async function readActiveModules(): Promise<ModuleState | null> {
  if (!isDemo()) return null;
  return (await readDomain('pengaturan')).state.modules;
}

export async function getTerminologyOverview(): Promise<{
  store: { state: TerminologyStoreState; rev: number };
  files: DemoImportFile[];
}> {
  if (!isDemo()) return notImplemented('data rujukan (layar demo)');
  return { store: await readDomain('terminologi'), files: [...DEMO_IMPORT_FILES] };
}

export async function getDocumentsOverview(): Promise<{
  patients: DocPatient[];
  store: { state: DocumentStoreState; rev: number };
}> {
  if (!isDemo()) return notImplemented('dokumen pasien (layar demo)');
  const patients = DOCUMENT_PATIENT_IDS.map((id): DocPatient => {
    const p = PASIEN.find((x) => x.id === id);
    if (!p) throw new Error('Pasien dokumen tidak ada di fixture');
    return {
      id: p.id,
      nama: p.nama,
      rm: p.rm,
      jk: p.jk,
      umur: p.umur,
      tanggalLahir: p.tanggalLahir,
      alergi: [...p.alergi],
      penjamin: p.kelas ? `${p.penjamin} · ${p.kelas}` : p.penjamin,
      dpjp: STAF.dpjpPenyakitDalam,
    };
  });
  return { patients, store: await readDomain('dokumen') };
}

export async function getScheduledJobs(): Promise<{ state: JobsStoreState; rev: number }> {
  if (!isDemo()) return notImplemented('penjadwal pekerjaan (layar demo)');
  return readDomain('penjadwal');
}

export async function getReferralsOverview(): Promise<{
  store: { state: ReferralStoreState; rev: number };
  planDates: string[];
}> {
  if (!isDemo()) return notImplemented('rujukan (layar demo)');
  // Hari praktik Senin–Jumat dalam 7 hari ke depan (tanggal rencana SPRI/kontrol).
  const planDates = [1, 2, 3, 4, 7].map((d) => shiftDate(DEMO_TODAY, d));
  return { store: await readDomain('rujukan'), planDates };
}

export async function getPublicInfo(session: SessionView): Promise<{
  schedule: PublicSchedule;
  queue: PublicQueue;
  bookings: PublicBookingRecord[];
  hint: { code: string; birthDate: string };
}> {
  if (!isDemo()) return notImplemented('portal informasi publik (layar demo)');
  // Rata-rata layanan antrean dari Pengaturan RS (toko demo `pengaturan`).
  const settings = (await readDomain('pengaturan')).state.settings;
  const avg = Number(settings['queue.avg_service_minutes'] ?? 10);
  // Toko demo (jadwal, pendaftaran, antrean) tanpa kemajuan skenario: portal publik tidak bergantung pada langkah
  // Simulasi presenter, tetapi cuti, kuota, kunjungan baru, dan panggilan dari layar front office langsung tampil.
  const fo = await frontOfficeStore(session, { scenario: false });
  const board = boardOf(fo);
  const loket = loketOf(fo);
  const extra = PUBLIC_EXTRA_SERVICES.map((s) =>
    s.code === 'A'
      ? {
          ...s,
          current: loket.current?.ticketNo ?? s.current,
          waiting: loket.waiting,
          estimatedWaitMinutes: loket.waiting * 4,
        }
      : s,
  );
  const pd = board.clinics.find((c) => c.poliCode === 'PD');
  return {
    schedule: publicScheduleFrom(quotasOf(fo), DEMO_TODAY, DEMO_NOW),
    queue: publicQueueFrom(board, extra, avg),
    bookings: DEMO_PUBLIC_BOOKINGS.map((b) =>
      b.status.serviceDate === DEMO_TODAY && b.status.currentQueueNo && pd?.current
        ? { ...b, status: { ...b.status, currentQueueNo: pd.current } }
        : b,
    ),
    hint: PUBLIC_BOOKING_HINT,
  };
}

export async function getDowntimeDrill(): Promise<{
  forms: PaperForm[];
  pack: { ward: string; patients: number; forms: string[]; sample: string };
  store: { state: DowntimeStoreState; rev: number };
}> {
  if (!isDemo()) return notImplemented('mode downtime (layar demo)');
  return {
    forms: [...DOWNTIME_PAPER_FORMS],
    pack: { ...EMERGENCY_PACK, forms: [...EMERGENCY_PACK.forms] },
    store: await readDomain('downtime'),
  };
}

/**
 * Banner downtime untuk semua layar mode presentasi (null bila normal). Mode api: null (toko demo tidak dibaca;
 * status downtime sungguhan menunggu backend fase 10).
 */
export async function readDowntimeBanner(): Promise<DowntimeBanner | null> {
  if (!isDemo()) return null;
  return downtimeBannerOf((await readDomain('downtime')).state);
}

export async function getBackupOverview(): Promise<{
  store: { state: BackupStoreState; rev: number };
  manifest: Array<readonly [string, number]>;
}> {
  if (!isDemo()) return notImplemented('cadangan dan pemulihan (layar demo)');
  return { store: await readDomain('cadangan'), manifest: [...MANIFEST_ROWS] };
}

export async function getGoLiveReadiness(): Promise<{
  eps: MrmikEp[];
  areas: ChecklistArea[];
  owners: readonly string[];
  director: string;
  store: { state: GoLiveStoreState; rev: number };
}> {
  if (!isDemo()) return notImplemented('kesiapan go-live (layar demo)');
  return {
    eps: [...MRMIK_EPS],
    areas: GOLIVE_CHECKLIST.map((a) => ({ ...a, items: a.items.map((i) => ({ ...i })) })),
    owners: GOLIVE_OWNERS,
    director: PERSONA.direktur,
    store: await readDomain('golive'),
  };
}
