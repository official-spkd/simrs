import {
  isValidRefCode,
  REF_CODE_SYSTEMS,
  type RefCodeSystem,
  regionInfo,
  type RegionLevel,
} from '@simrs/shared';
import type { CsvRecord } from './csv';
import { Prisma, type PrismaClient } from './generated/prisma/client';

/**
 * P06 · Data rujukan global (skema `ref`, docs/01 §3): sistem kode baku dan wilayah. Tanpa tenant dan tanpa
 * RLS; aplikasi hanya membaca. Impor dataset resmi lewat `importConcepts`/`importRegions` (role migrator,
 * CLI `pnpm db:import-ref`). Diakses lewat SQL berparameter karena skema `ref` tidak dimodelkan Prisma.
 */
type SqlClient = Pick<PrismaClient, '$queryRaw' | '$executeRaw'>;

export interface RefConcept {
  system: RefCodeSystem;
  code: string;
  display: string;
  active: boolean;
  extra: Record<string, unknown> | null;
}

export interface RefSystemInfo {
  id: RefCodeSystem;
  uri: string;
  name: string;
  version: string | null;
  source: string | null;
  conceptCount: number;
  importedAt: Date | null;
}

export interface RefRegion {
  code: string;
  name: string;
  level: RegionLevel;
  parentCode: string | null;
}

/**
 * Ambang kemiripan kata untuk pencarian label (bawaan pg_trgm 0,6 terlalu ketat: salah ketik satu huruf pada
 * "pneumonia" bernilai ~0,58). Disetel SET LOCAL sehingga operator `<%` tetap memakai indeks GIN.
 */
const WORD_SIMILARITY = '0.5';

async function relaxWordSimilarity(db: SqlClient): Promise<void> {
  await db.$queryRaw`SELECT set_config('pg_trgm.word_similarity_threshold', ${WORD_SIMILARITY}, true)`;
}

/** Pola LIKE aman: `%`, `_`, dan `!` dari masukan diperlakukan harfiah (`ESCAPE '!'`). */
const escapeLike = (v: string) => v.replace(/[!%_]/g, '!$&');

export function listCodeSystems(db: SqlClient): Promise<RefSystemInfo[]> {
  return db.$queryRaw<RefSystemInfo[]>`
    SELECT id, uri, name, version, source, concept_count AS "conceptCount", imported_at AS "importedAt"
    FROM ref.code_systems ORDER BY id`;
}

/**
 * Cari konsep: kode persis/awalan (`J18` → J18.x) atau kata mirip di label (trigram `<%`, tahan salah ketik
 * walau labelnya panjang). Urutan: kode persis, awalan kode, lalu kemiripan kata. Panggil di dalam transaksi
 * (ambang kemiripan berlaku per transaksi).
 */
export async function searchConcepts(
  db: SqlClient,
  opts: { system: RefCodeSystem; q: string; limit: number; includeInactive?: boolean },
): Promise<RefConcept[]> {
  await relaxWordSimilarity(db);
  const code = opts.q.trim().toUpperCase();
  const text = opts.q.trim().toLowerCase();
  const prefix = `${escapeLike(code)}%`;
  const contains = `%${escapeLike(text)}%`;
  return db.$queryRaw<RefConcept[]>`
    SELECT system, code, display, active, extra
    FROM ref.concepts
    WHERE system = ${opts.system}
      ${opts.includeInactive ? Prisma.empty : Prisma.sql`AND active`}
      AND (code LIKE ${prefix} ESCAPE '!' OR lower(display) LIKE ${contains} ESCAPE '!' OR ${text} <% lower(display))
    ORDER BY (code = ${code}) DESC, (code LIKE ${prefix} ESCAPE '!') DESC,
             word_similarity(${text}, lower(display)) DESC, code
    LIMIT ${opts.limit}`;
}

export async function getConcept(
  db: SqlClient,
  system: RefCodeSystem,
  code: string,
): Promise<RefConcept | null> {
  const rows = await db.$queryRaw<RefConcept[]>`
    SELECT system, code, display, active, extra FROM ref.concepts WHERE system = ${system} AND code = ${code}`;
  return rows[0] ?? null;
}

/** Anak langsung satu wilayah (`parent` null = provinsi), atau cari nama di semua tingkat bila `q` diisi. */
export async function listRegions(
  db: SqlClient,
  opts: { parent: string | null; q?: string; limit: number },
): Promise<RefRegion[]> {
  const q = opts.q?.trim().toLowerCase();
  if (q) {
    await relaxWordSimilarity(db);
    return db.$queryRaw<RefRegion[]>`
      SELECT code, name, level, parent_code AS "parentCode" FROM ref.regions
      WHERE active AND (lower(name) LIKE ${`%${escapeLike(q)}%`} ESCAPE '!' OR ${q} <% lower(name))
        ${opts.parent ? Prisma.sql`AND code LIKE ${`${escapeLike(opts.parent)}.%`} ESCAPE '!'` : Prisma.empty}
      ORDER BY word_similarity(${q}, lower(name)) DESC, code
      LIMIT ${opts.limit}`;
  }
  return db.$queryRaw<RefRegion[]>`
    SELECT code, name, level, parent_code AS "parentCode" FROM ref.regions
    WHERE active AND parent_code IS NOT DISTINCT FROM ${opts.parent}
    ORDER BY code
    LIMIT ${opts.limit}`;
}

// ---------------------------------------------------------------------------------------------------------
// Impor (role migrator). Gagal tertutup: satu baris tidak valid → tidak ada yang ditulis.
// ---------------------------------------------------------------------------------------------------------

export interface ImportOptions {
  /** Versi dataset, mis. `2019`, `2.77`, `2026-09`. */
  version: string;
  /** Asal dataset, mis. `WHO`, `loinc.org`, `Kemenkes (KFA)`, `Kemendagri`. */
  source?: string;
  /** Nonaktifkan kode yang tidak ada di berkas (versi baru menggantikan versi lama). */
  replace?: boolean;
  /** Hanya validasi, tanpa menulis. */
  dryRun?: boolean;
}

export interface ImportReport {
  target: RefCodeSystem | 'wilayah';
  rows: number;
  inserted: number;
  updated: number;
  unchanged: number;
  deactivated: number;
  errors: Array<{ line: number; message: string }>;
  dryRun: boolean;
}

const CHUNK = 1000;
const MAX_ERRORS = 50;

function parseActive(raw: string | undefined): boolean | null {
  if (raw === undefined || raw === '') return true;
  const v = raw.toLowerCase();
  if (['true', '1', 'ya', 'aktif', 'y'].includes(v)) return true;
  if (['false', '0', 'tidak', 'nonaktif', 'n'].includes(v)) return false;
  return null;
}

/** Kolom selain code/display/active masuk `extra`; `true`/`false` menjadi boolean, kosong dilewati. */
function extraOf(values: Record<string, string>, known: string[]): Record<string, unknown> | null {
  const entries = Object.entries(values)
    .filter(([k, v]) => !known.includes(k) && v !== '')
    .map(([k, v]) => [k, v === 'true' ? true : v === 'false' ? false : v] as const);
  return entries.length > 0 ? Object.fromEntries(entries) : null;
}

const emptyReport = (target: ImportReport['target'], rows: number, dryRun: boolean): ImportReport => ({
  target,
  rows,
  inserted: 0,
  updated: 0,
  unchanged: 0,
  deactivated: 0,
  errors: [],
  dryRun,
});

/**
 * Impor konsep satu sistem kode dari rekaman CSV (`code`, `display`, opsional `active` + kolom tambahan).
 * Panggil di dalam transaksi (`prisma.$transaction(tx => importConcepts(tx, …))`) agar seluruh berkas
 * berlaku atau batal bersama.
 */
export async function importConcepts(
  db: SqlClient,
  system: RefCodeSystem,
  records: CsvRecord[],
  opts: ImportOptions,
): Promise<ImportReport> {
  const report = emptyReport(system, records.length, Boolean(opts.dryRun));
  const seen = new Set<string>();
  const rows: Array<{ code: string; display: string; active: boolean; extra: string | null }> = [];
  for (const r of records) {
    const code = (r.values.code ?? '').toUpperCase();
    const display = r.values.display ?? '';
    const active = parseActive(r.values.active);
    const problem = r.malformed
      ? r.malformed
      : !isValidRefCode(system, code)
        ? `kode "${code}" tidak valid untuk ${REF_CODE_SYSTEMS[system].label} (${REF_CODE_SYSTEMS[system].hint})`
        : !display || display.length > 500
          ? 'label (display) wajib diisi, maks. 500 karakter'
          : active === null
            ? `kolom active tidak dikenali: "${r.values.active}"`
            : seen.has(code)
              ? `kode ${code} muncul lebih dari sekali`
              : null;
    if (problem) {
      if (report.errors.length < MAX_ERRORS) report.errors.push({ line: r.line, message: problem });
      continue;
    }
    seen.add(code);
    const extra = extraOf(r.values, ['code', 'display', 'active']);
    rows.push({ code, display, active: active as boolean, extra: extra ? JSON.stringify(extra) : null });
  }
  if (report.errors.length > 0 || opts.dryRun) return report;

  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const result = await db.$queryRaw<Array<{ inserted: boolean }>>`
      INSERT INTO ref.concepts (system, code, display, active, extra, updated_at)
      SELECT ${system}, t.code, t.display, t.active, t.extra::jsonb, now()
      FROM unnest(${chunk.map((c) => c.code)}::text[], ${chunk.map((c) => c.display)}::text[],
                  ${chunk.map((c) => c.active)}::boolean[], ${chunk.map((c) => c.extra)}::text[])
           AS t(code, display, active, extra)
      ON CONFLICT (system, code) DO UPDATE
        SET display = EXCLUDED.display, active = EXCLUDED.active, extra = EXCLUDED.extra, updated_at = now()
        WHERE (ref.concepts.display, ref.concepts.active, ref.concepts.extra)
              IS DISTINCT FROM (EXCLUDED.display, EXCLUDED.active, EXCLUDED.extra)
      RETURNING (xmax = 0) AS inserted`;
    report.inserted += result.filter((x) => x.inserted).length;
    report.updated += result.filter((x) => !x.inserted).length;
  }
  report.unchanged = rows.length - report.inserted - report.updated;
  if (opts.replace) {
    report.deactivated = await db.$executeRaw`
      UPDATE ref.concepts SET active = false, updated_at = now()
      WHERE system = ${system} AND active AND code NOT IN (SELECT unnest(${rows.map((r) => r.code)}::text[]))`;
  }
  await db.$executeRaw`
    UPDATE ref.code_systems
    SET version = ${opts.version}, source = ${opts.source ?? null}, imported_at = now(),
        concept_count = (SELECT count(*) FROM ref.concepts WHERE system = ${system} AND active)
    WHERE id = ${system}`;
  return report;
}

/**
 * Impor wilayah (kolom `code`, `name`, opsional `active`). Tingkat dan induk diturunkan dari kode; induk harus
 * ada di berkas yang sama atau sudah tersimpan. Panggil di dalam transaksi seperti `importConcepts`.
 */
export async function importRegions(
  db: SqlClient,
  records: CsvRecord[],
  opts: ImportOptions,
): Promise<ImportReport> {
  const report = emptyReport('wilayah', records.length, Boolean(opts.dryRun));
  const rows: Array<{
    code: string;
    name: string;
    level: RegionLevel;
    parent: string | null;
    active: boolean;
  }> = [];
  const seen = new Set<string>();
  for (const r of records) {
    const code = r.values.code ?? '';
    const name = r.values.name ?? '';
    const info = regionInfo(code);
    const active = parseActive(r.values.active);
    const problem = r.malformed
      ? r.malformed
      : !info
        ? `kode wilayah "${code}" tidak valid (mis. 31, 31.75, 31.75.01, 31.75.01.1001)`
        : !name || name.length > 200
          ? 'nama wajib diisi, maks. 200 karakter'
          : active === null
            ? `kolom active tidak dikenali: "${r.values.active}"`
            : seen.has(code)
              ? `kode ${code} muncul lebih dari sekali`
              : null;
    if (problem || !info) {
      if (report.errors.length < MAX_ERRORS) report.errors.push({ line: r.line, message: problem ?? '' });
      continue;
    }
    seen.add(code);
    rows.push({ code, name, level: info.level, parent: info.parent, active: active as boolean });
  }
  const missingParents = [
    ...new Set(rows.map((r) => r.parent).filter((p): p is string => p !== null && !seen.has(p))),
  ];
  if (missingParents.length > 0) {
    const found = await db.$queryRaw<Array<{ code: string }>>`
      SELECT code FROM ref.regions WHERE code = ANY(${missingParents}::text[])`;
    const known = new Set(found.map((f) => f.code));
    for (const r of rows) {
      if (r.parent && !seen.has(r.parent) && !known.has(r.parent) && report.errors.length < MAX_ERRORS) {
        const line = records.find((x) => x.values.code === r.code)?.line ?? 0;
        report.errors.push({ line, message: `induk ${r.parent} untuk ${r.code} tidak ada` });
      }
    }
  }
  if (report.errors.length > 0 || opts.dryRun) return report;

  // Induk lebih dulu: urut menurut tingkat lalu kode.
  rows.sort((a, b) => a.code.split('.').length - b.code.split('.').length || a.code.localeCompare(b.code));
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const result = await db.$queryRaw<Array<{ inserted: boolean }>>`
      INSERT INTO ref.regions (code, name, level, parent_code, active, updated_at)
      SELECT t.code, t.name, t.level, t.parent, t.active, now()
      FROM unnest(${chunk.map((c) => c.code)}::text[], ${chunk.map((c) => c.name)}::text[],
                  ${chunk.map((c) => c.level)}::text[], ${chunk.map((c) => c.parent)}::text[],
                  ${chunk.map((c) => c.active)}::boolean[])
           AS t(code, name, level, parent, active)
      ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, active = EXCLUDED.active, updated_at = now()
        WHERE (ref.regions.name, ref.regions.active) IS DISTINCT FROM (EXCLUDED.name, EXCLUDED.active)
      RETURNING (xmax = 0) AS inserted`;
    report.inserted += result.filter((x) => x.inserted).length;
    report.updated += result.filter((x) => !x.inserted).length;
  }
  report.unchanged = rows.length - report.inserted - report.updated;
  if (opts.replace) {
    report.deactivated = await db.$executeRaw`
      UPDATE ref.regions SET active = false, updated_at = now()
      WHERE active AND code NOT IN (SELECT unnest(${rows.map((r) => r.code)}::text[]))`;
  }
  return report;
}
