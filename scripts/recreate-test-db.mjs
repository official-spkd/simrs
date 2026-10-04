#!/usr/bin/env node
/**
 * Membuat ulang database TES dari nol. DESTRUKTIF: semua data di database itu hilang.
 * Dipakai manusia (bukan otomatis) bila migrasi lama diubah dan `prisma migrate deploy` menolak checksum.
 * Database = nama di `TEST_DATABASE_URL` (bawaan `simrs_test`; worktree paralel: `simrs_test_<nama>`).
 * Tidak pernah menyentuh database `simrs` (pengembangan).
 *
 * Pemakaian: pnpm db:test:recreate -- --yes
 */
import pg from 'pg';

/** Sama dengan `TEST_DATABASE_NAME` di packages/db/src/testing.ts. */
const TEST_DATABASE_NAME = /^simrs_test(?:_[a-z0-9_]+)?$/;

try {
  process.loadEnvFile('.env');
} catch {
  // .env opsional
}

const testDb = process.env.TEST_DATABASE_URL
  ? new URL(process.env.TEST_DATABASE_URL).pathname.replace(/^\//, '')
  : 'simrs_test';
if (!TEST_DATABASE_NAME.test(testDb)) {
  console.error(`Menolak "${testDb}": hanya simrs_test atau simrs_test_<nama> yang boleh dibuat ulang.`);
  process.exit(1);
}

if (!process.argv.includes('--yes')) {
  console.error(`Perintah ini MENGHAPUS seluruh database ${testDb}. Jalankan ulang dengan --yes bila yakin.`);
  process.exit(1);
}

const client = new pg.Client({
  host: '127.0.0.1',
  port: Number(process.env.POSTGRES_PORT ?? 5432),
  user: 'postgres',
  password: process.env.POSTGRES_SUPERUSER_PASSWORD ?? 'postgres_local',
  database: 'postgres',
});

await client.connect();
try {
  // Nama sudah lolos pola di atas (huruf kecil, angka, garis bawah), aman disisipkan sebagai identifier.
  await client.query(`DROP DATABASE IF EXISTS ${testDb} WITH (FORCE)`);
  await client.query(`CREATE DATABASE ${testDb} OWNER simrs_migrator`);
  console.warn(`${testDb} dibuat ulang. Tes berikutnya akan menerapkan migrasi dan seed otomatis.`);
} finally {
  await client.end();
}
