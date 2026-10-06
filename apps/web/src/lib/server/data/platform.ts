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
import { STAF } from '../../demo/fixtures/staf';
import type { DemoDocument, DocPatient } from '../../platform-dokumen';
import { DEMO_JOBS } from '../../demo/fixtures/penjadwal';
import type { ScheduledJob } from '../../platform-penjadwal';
import type { StructNode } from '../../platform-struktur';
import { DEMO_REFERRALS } from '../../demo/fixtures/rujukan';
import { DEMO_TODAY, shiftDate } from '../../demo/fixtures/waktu';
import type { DemoReferral } from '../../rujukan';
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
