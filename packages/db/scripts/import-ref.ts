/**
 * Impor dataset rujukan resmi (P06) dari berkas CSV ke skema `ref` (global, tanpa tenant):
 *
 *   pnpm db:import-ref --system icd10 --file ./icd10.csv --version 2019 --source WHO
 *   pnpm db:import-ref --system loinc --file ./loinc.csv --version 2.77 --source loinc.org --replace
 *   pnpm db:import-ref --system wilayah --file ./wilayah.csv --version 2024 --source Kemendagri --dry-run
 *
 * Kolom: `code`, `display` (wilayah: `code`, `name`), opsional `active` dan kolom tambahan (masuk `extra`).
 * Gagal tertutup: satu baris tidak valid → tidak ada yang ditulis; semua masalah dilaporkan per baris.
 * `--replace` menonaktifkan kode yang tidak ada di berkas (tidak menghapus). Dijalankan dengan role migrator.
 */
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { REF_CODE_SYSTEM_IDS, type RefCodeSystem } from '@simrs/shared';
import { createPrismaClient } from '../src/client';
import { csvRecords } from '../src/csv';
import { type ImportReport, importConcepts, importRegions } from '../src/ref';

const USAGE =
  'Contoh: pnpm db:import-ref --system icd10 --file ./icd10.csv --version 2019 --source WHO [--replace] [--dry-run]';
const TARGETS = [...REF_CODE_SYSTEM_IDS, 'wilayah'] as const;

function fail(message: string): never {
  console.error(`Gagal: ${message}`);
  process.exit(1);
}

const { values } = parseArgs({
  options: {
    system: { type: 'string' },
    file: { type: 'string' },
    version: { type: 'string' },
    source: { type: 'string' },
    replace: { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
  },
  strict: true,
});
const target = values.system as (typeof TARGETS)[number] | undefined;
if (!target || !(TARGETS as readonly string[]).includes(target)) {
  fail(`--system wajib salah satu dari: ${TARGETS.join(', ')}\n${USAGE}`);
}
if (!values.file) fail(`--file wajib diisi\n${USAGE}`);
const version = values.version?.trim();
if (!version || version.length > 40) fail(`--version wajib diisi (maks. 40 karakter)\n${USAGE}`);

let text: string;
try {
  text = readFileSync(values.file, 'utf8');
} catch {
  fail(`berkas ${values.file} tidak bisa dibaca`);
}
const { columns, records } = csvRecords(text);
const required = target === 'wilayah' ? ['code', 'name'] : ['code', 'display'];
const missing = required.filter((c) => !columns.includes(c));
if (missing.length > 0)
  fail(`kolom wajib tidak ada: ${missing.join(', ')} (baris judul: ${columns.join(', ')})`);

const url = process.env.MIGRATOR_DATABASE_URL;
if (!url) fail('MIGRATOR_DATABASE_URL belum disetel (lihat .env.example)');

const opts = { version, source: values.source?.trim(), replace: values.replace, dryRun: values['dry-run'] };
const prisma = createPrismaClient({ connectionString: url, max: 1 });
let report: ImportReport;
try {
  // Satu transaksi untuk seluruh berkas: semua berlaku atau batal bersama.
  report = await prisma.$transaction(
    (tx) =>
      target === 'wilayah'
        ? importRegions(tx, records, opts)
        : importConcepts(tx, target as RefCodeSystem, records, opts),
    { timeout: 10 * 60_000, maxWait: 30_000 },
  );
} finally {
  await prisma.$disconnect();
}

if (report.errors.length > 0) {
  console.error(`Impor ${target} DIBATALKAN: ${report.errors.length} masalah (tidak ada yang ditulis).`);
  for (const e of report.errors) console.error(`  baris ${e.line}: ${e.message}`);
  process.exit(1);
}
console.warn(
  report.dryRun
    ? `Validasi ${target} lolos: ${report.rows} baris siap diimpor (dry run, tidak ada yang ditulis).`
    : `Impor ${target} versi ${version} selesai: ${report.inserted} baru, ${report.updated} diperbarui, ` +
        `${report.unchanged} tetap, ${report.deactivated} dinonaktifkan.`,
);
