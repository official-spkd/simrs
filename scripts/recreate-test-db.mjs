#!/usr/bin/env node
/**
 * Membuat ulang database TES (`simrs_test`) dari nol. DESTRUKTIF: semua data di simrs_test hilang.
 * Dipakai manusia (bukan otomatis) bila migrasi lama diubah dan `prisma migrate deploy` menolak checksum.
 * Tidak pernah menyentuh database `simrs` (pengembangan).
 *
 * Pemakaian: pnpm db:test:recreate -- --yes
 */
import pg from 'pg';

const TEST_DB = 'simrs_test';

if (!process.argv.includes('--yes')) {
  console.error(
    `Perintah ini MENGHAPUS seluruh database ${TEST_DB}. Jalankan ulang dengan --yes bila yakin.`,
  );
  process.exit(1);
}

try {
  process.loadEnvFile('.env');
} catch {
  // .env opsional
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
  // Nama database konstan (bukan input pengguna), aman disisipkan sebagai identifier.
  await client.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
  await client.query(`CREATE DATABASE ${TEST_DB} OWNER simrs_migrator`);
  console.warn(`${TEST_DB} dibuat ulang. Tes berikutnya akan menerapkan migrasi dan seed otomatis.`);
} finally {
  await client.end();
}
