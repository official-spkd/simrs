/**
 * Impor daftar kata sandi bocor (P02, docs/05 §1) ke `ref.breached_passwords` (global, tanpa tenant), menggantikan
 * isi sebelumnya:
 *
 *   pnpm db:import-breached --file ./pwned-passwords-sha1.txt --source "HIBP Pwned Passwords" --version v8
 *   pnpm db:import-breached --file ./top-passwords.txt --source "Daftar internal" --version 2026-10 --top 50000
 *   pnpm db:import-breached --file packages/db/data/breached-passwords-sample.txt --source contoh --version 1
 *
 * Format dikenali dari baris pertama: `SHA1:hitungan` (berkas resmi Have I Been Pwned; diambil `--top` hitungan
 * terbesar, berkas boleh sangat besar karena dibaca baris demi baris) atau teks satu kata sandi per baris (urut
 * paling umum; diambil `--top` pertama). Hanya SHA-1 yang disimpan. Gagal tertutup: satu baris tidak valid → tidak
 * ada yang ditulis. Dijalankan dengan role migrator; aplikasi hanya membaca.
 */
import { createReadStream } from 'node:fs';
import { access } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import {
  BREACHED_TOP_DEFAULT,
  BREACHED_TOP_MAX,
  collectBreachedPasswords,
  replaceBreachedPasswords,
} from '../src/breached-passwords';
import { createPrismaClient } from '../src/client';

const USAGE =
  'Contoh: pnpm db:import-breached --file ./pwned-passwords.txt --source "HIBP Pwned Passwords" --version v8 [--top 100000] [--dry-run]';

function fail(message: string): never {
  console.error(`Gagal: ${message}`);
  process.exit(1);
}

const { values } = parseArgs({
  options: {
    file: { type: 'string' },
    source: { type: 'string' },
    version: { type: 'string' },
    top: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
  },
  strict: true,
});
if (!values.file) fail(`--file wajib diisi\n${USAGE}`);
const source = values.source?.trim();
if (!source || source.length > 100) fail(`--source wajib diisi (maks. 100 karakter)\n${USAGE}`);
const version = values.version?.trim();
if (!version || version.length > 40) fail(`--version wajib diisi (maks. 40 karakter)\n${USAGE}`);
const top = values.top === undefined ? BREACHED_TOP_DEFAULT : Number(values.top);
if (!Number.isInteger(top) || top < 1 || top > BREACHED_TOP_MAX) {
  fail(`--top harus bilangan bulat 1–${BREACHED_TOP_MAX}`);
}
try {
  await access(values.file);
} catch {
  fail(`berkas ${values.file} tidak bisa dibaca`);
}

const lines = createInterface({ input: createReadStream(values.file, 'utf8'), crlfDelay: Infinity });
const collected = await collectBreachedPasswords(lines, { top });
if (collected.errors.length > 0) {
  console.error(`Impor DIBATALKAN: ${collected.errors.length}+ baris tidak valid (tidak ada yang ditulis).`);
  for (const e of collected.errors) console.error(`  baris ${e.line}: ${e.message}`);
  process.exit(1);
}
if (collected.entries.length === 0) fail('berkas tidak memuat entri apa pun');

const summary = `${collected.entries.length} entri (format ${collected.format}, ${collected.lines} baris dibaca)`;
if (values['dry-run']) {
  console.warn(`Uji coba: ${summary}. Tidak ada yang ditulis.`);
  process.exit(0);
}

const url = process.env.MIGRATOR_DATABASE_URL;
if (!url) fail('MIGRATOR_DATABASE_URL belum disetel (lihat .env.example)');
const prisma = createPrismaClient({ connectionString: url, max: 1 });
try {
  // Satu transaksi: pembaca tetap memakai daftar lama sampai daftar baru lengkap.
  await prisma.$transaction((tx) => replaceBreachedPasswords(tx, collected.entries, { source, version }), {
    timeout: 10 * 60_000,
    maxWait: 30_000,
  });
} finally {
  await prisma.$disconnect();
}
console.warn(`Daftar kata sandi bocor diganti: ${summary}, sumber ${source} versi ${version}.`);
