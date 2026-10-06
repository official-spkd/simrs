import 'server-only';
import { PATIENT_ID } from '../../demo/fixtures/ids';
import { PASIEN } from '../../demo/fixtures/pasien';
import {
  DEMO_MODULE_OVERRIDES,
  DEMO_SETTINGS,
  DEMO_STRUCTURE,
  DEMO_STRUCTURE_LOG,
  DEMO_TEMPLATES,
} from '../../demo/fixtures/platform';
import {
  type ModuleState,
  moduleStateFrom,
  type PrintTemplate,
  type SamplePatient,
  type SettingDraft,
} from '../../platform-pengaturan';
import { DEMO_DOCUMENTS, DOCUMENT_PATIENT_IDS } from '../../demo/fixtures/dokumen';
import { PERSONA, STAF } from '../../demo/fixtures/staf';
import type { DemoDocument, DocPatient } from '../../platform-dokumen';
import { DEMO_JOBS } from '../../demo/fixtures/penjadwal';
import type { ScheduledJob } from '../../platform-penjadwal';
import type { StructNode } from '../../platform-struktur';
import { DEMO_REFERRALS } from '../../demo/fixtures/rujukan';
import { DEMO_NOW, DEMO_TODAY, shiftDate } from '../../demo/fixtures/waktu';
import type { DemoReferral } from '../../rujukan';
import {
  BACKUP_LOCATIONS,
  BACKUP_RUNS,
  DOWNTIME_PAPER_FORMS,
  EMERGENCY_PACK,
  LAST_RESTORE_TEST,
  MANIFEST_ROWS,
} from '../../demo/fixtures/operasional';
import type { BackupLocation, BackupRun } from '../../operasional-backup';
import { GOLIVE_CHECKLIST, GOLIVE_OWNERS, MRMIK_EPS } from '../../demo/fixtures/golive';
import type { ChecklistArea, MrmikEp } from '../../golive';
import type { PaperForm } from '../../operasional-downtime';
import type { PublicQueue, PublicSchedule } from '@simrs/shared';
import type { SessionView } from '../../session-view';
import { boardOf, frontOfficeStore, loketOf, quotasOf } from './front-office/toko';
import {
  DEMO_PUBLIC_BOOKINGS,
  PUBLIC_BOOKING_HINT,
  PUBLIC_EXTRA_SERVICES,
} from '../../demo/fixtures/info-publik';
import { type PublicBookingRecord, publicQueueFrom, publicScheduleFrom } from '../../info-publik';
import type { RefConcept, RefVersion } from '../../platform-terminologi';
import {
  DEMO_IMPORT_FILES,
  DEMO_REF_CONCEPTS,
  DEMO_REF_VERSIONS,
  type DemoImportFile,
} from '../../demo/fixtures/terminologi';
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

export async function getFacilityStructure(): Promise<{
  nodes: StructNode[];
  log: Array<{ t: string; text: string }>;
}> {
  if (!isDemo()) return notImplemented('struktur RS (layar demo)');
  return { nodes: [...DEMO_STRUCTURE], log: [...DEMO_STRUCTURE_LOG] };
}

export async function getTenantSettingsOverview(): Promise<{
  modules: ModuleState;
  settings: SettingDraft;
  templates: PrintTemplate[];
  sample: SamplePatient;
}> {
  if (!isDemo()) return notImplemented('pengaturan RS (layar demo)');
  return {
    modules: moduleStateFrom(DEMO_MODULE_OVERRIDES),
    settings: { ...DEMO_SETTINGS },
    templates: [...DEMO_TEMPLATES],
    // Ny. Endang: beralergi, sehingga penanda alergi di gelang/label terlihat di pratinjau.
    sample: samplePatient(PATIENT_ID.endang),
  };
}

export async function getTerminologyOverview(): Promise<{
  concepts: RefConcept[];
  versions: RefVersion[];
  files: DemoImportFile[];
}> {
  if (!isDemo()) return notImplemented('data rujukan (layar demo)');
  return {
    concepts: [...DEMO_REF_CONCEPTS],
    versions: [...DEMO_REF_VERSIONS],
    files: [...DEMO_IMPORT_FILES],
  };
}

export async function getDocumentsOverview(): Promise<{
  patients: DocPatient[];
  documents: DemoDocument[];
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
  return { patients, documents: [...DEMO_DOCUMENTS] };
}

export async function getScheduledJobs(): Promise<ScheduledJob[]> {
  if (!isDemo()) return notImplemented('penjadwal pekerjaan (layar demo)');
  return DEMO_JOBS.map((j) => ({ ...j, runs: [...j.runs] }));
}

export async function getReferralsOverview(): Promise<{ referrals: DemoReferral[]; planDates: string[] }> {
  if (!isDemo()) return notImplemented('rujukan (layar demo)');
  // Hari praktik Senin–Jumat dalam 7 hari ke depan (tanggal rencana SPRI/kontrol).
  const planDates = [1, 2, 3, 4, 7].map((d) => shiftDate(DEMO_TODAY, d));
  return { referrals: [...DEMO_REFERRALS], planDates };
}

export async function getPublicInfo(session: SessionView): Promise<{
  schedule: PublicSchedule;
  queue: PublicQueue;
  bookings: PublicBookingRecord[];
  hint: { code: string; birthDate: string };
}> {
  if (!isDemo()) return notImplemented('portal informasi publik (layar demo)');
  const avg = Number(DEMO_SETTINGS['queue.avg_service_minutes'] ?? 10);
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
}> {
  if (!isDemo()) return notImplemented('mode downtime (layar demo)');
  return {
    forms: [...DOWNTIME_PAPER_FORMS],
    pack: { ...EMERGENCY_PACK, forms: [...EMERGENCY_PACK.forms] },
  };
}

export async function getBackupOverview(): Promise<{
  locations: BackupLocation[];
  runs: BackupRun[];
  lastTest: { at: string; rtoMinutes: number; source: string };
  manifest: Array<readonly [string, number]>;
}> {
  if (!isDemo()) return notImplemented('cadangan dan pemulihan (layar demo)');
  return {
    locations: BACKUP_LOCATIONS.map((l) => ({ ...l, kept: { ...l.kept } })),
    runs: [...BACKUP_RUNS],
    lastTest: { ...LAST_RESTORE_TEST },
    manifest: [...MANIFEST_ROWS],
  };
}

export async function getGoLiveReadiness(): Promise<{
  eps: MrmikEp[];
  areas: ChecklistArea[];
  owners: readonly string[];
  director: string;
}> {
  if (!isDemo()) return notImplemented('kesiapan go-live (layar demo)');
  return {
    eps: [...MRMIK_EPS],
    areas: GOLIVE_CHECKLIST.map((a) => ({ ...a, items: a.items.map((i) => ({ ...i })) })),
    owners: GOLIVE_OWNERS,
    director: PERSONA.direktur,
  };
}
