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
import type { StructNode } from '../../platform-struktur';
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
