import { REF_CODE_SYSTEM_IDS } from '@simrs/shared';
import { z } from 'zod';
import { defineDomain } from './demo/store/define';
import { DEMO_IMPORT_FILES, DEMO_REF_CONCEPTS, DEMO_REF_VERSIONS } from './demo/fixtures/terminologi';
import {
  applyImport,
  dryRunImport,
  type ImportReport,
  parseCsv,
  type RefConcept,
  type RefVersion,
} from './platform-terminologi';

/**
 * P06 · Domain toko demo `terminologi` (ADR-0085): impor CSV data rujukan yang lolos uji kering diterapkan dan
 * tersimpan (kode + riwayat versi) per RS demo. Uji kering diulang di reducer (gagal tertutup: berkas bergalat tidak
 * pernah diterapkan), sehingga domain ini `generic`. Berkas contoh dirujuk lewat id; unggahan sendiri membawa isinya
 * (maks. 12 KB) saat diterapkan.
 */

export const TERMINOLOGY_DOMAIN = 'terminologi';

export const terminologyEventSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('impor.diterapkan'),
    /** Id berkas contoh (`DEMO_IMPORT_FILES`) atau `unggah` dengan isi berkas. */
    fileId: z.string().min(1).max(40),
    upload: z
      .strictObject({
        name: z.string().min(1).max(120),
        system: z.enum(REF_CODE_SYSTEM_IDS),
        text: z.string().min(1).max(12_000),
      })
      .optional(),
    replace: z.boolean(),
    /** Saat diterapkan (jam hari demo, ISO). */
    at: z.iso.datetime({ offset: true }),
  }),
]);
export type TerminologyEvent = z.infer<typeof terminologyEventSchema>;

export interface TerminologyStoreState {
  concepts: readonly RefConcept[];
  versions: readonly RefVersion[];
}

function fileOf(ev: TerminologyEvent) {
  if (ev.fileId === 'unggah') {
    return ev.upload
      ? { name: ev.upload.name, system: ev.upload.system, version: 'unggahan', text: ev.upload.text }
      : null;
  }
  return DEMO_IMPORT_FILES.find((f) => f.id === ev.fileId) ?? null;
}

/** Uji kering ulang terhadap keadaan tersimpan: laporan atau pesan galat (gagal tertutup). */
export function importReportFor(
  s: TerminologyStoreState,
  ev: TerminologyEvent,
): { report: ImportReport; file: NonNullable<ReturnType<typeof fileOf>> } | string {
  const file = fileOf(ev);
  if (!file) return 'Berkas impor tidak dikenal.';
  const report = dryRunImport(s.concepts, file.system, parseCsv(file.text), ev.replace);
  if (report.errors.length > 0) {
    return `Uji kering gagal: ${report.errors.length} baris galat. Perbaiki berkas lalu uji ulang.`;
  }
  return { report, file };
}

export const terminologyDomain = defineDomain<TerminologyStoreState, TerminologyEvent>(TERMINOLOGY_DOMAIN, {
  initial: () => ({ concepts: [...DEMO_REF_CONCEPTS], versions: [...DEMO_REF_VERSIONS] }),
  eventSchema: terminologyEventSchema,
  screens: ['terminologi'],
  generic: true,
  validate: (s, ev) => {
    const r = importReportFor(s, ev);
    return typeof r === 'string' ? r : null;
  },
  reduce: (s, ev) => {
    const r = importReportFor(s, ev.data);
    if (typeof r === 'string') throw new Error(r);
    const { report, file } = r;
    const version: RefVersion = {
      system: report.system,
      version: file.version,
      source: file.name,
      appliedAt: ev.data.at,
      appliedBy: ev.actor.name,
      inserted: report.inserted,
      updated: report.updated,
      deactivated: ev.data.replace ? report.deactivated : 0,
    };
    return {
      concepts: applyImport(s.concepts, report, ev.data.replace),
      versions: [version, ...s.versions],
    };
  },
});
