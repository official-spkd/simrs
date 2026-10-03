#!/usr/bin/env node
/**
 * PostgreSQL 16 portabel untuk mesin tanpa Docker (ADR-0009). Hanya untuk pengembangan/tes lokal.
 * - Data di `.local/pg-data` (diabaikan git), port dari POSTGRES_PORT (5432), hanya mendengar di 127.0.0.1.
 * - Saat pertama kali: membuat database `simrs` lalu menjalankan `infra/postgres/init.sql` (role, ekstensi,
 *   simrs_test) persis seperti container Docker.
 * Pemakaian: `pnpm pg:portable` (berjalan di foreground; Ctrl+C untuk berhenti).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';

try {
  process.loadEnvFile('.env');
} catch {
  // .env opsional
}

const root = process.cwd();
const dataDir = resolve(root, '.local', 'pg-data');
const marker = resolve(root, '.local', 'pg-initialized');
const port = Number(process.env.POSTGRES_PORT ?? 5432);
const password = process.env.POSTGRES_SUPERUSER_PASSWORD ?? 'postgres_local';

mkdirSync(resolve(root, '.local'), { recursive: true });

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: 'postgres',
  password,
  port,
  persistent: true,
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
  postgresFlags: ['-c', 'listen_addresses=127.0.0.1', '-c', 'timezone=Asia/Jakarta'],
  onLog: () => {},
  onError: (e) => console.error(String(e)),
});

async function main() {
  if (!existsSync(resolve(dataDir, 'PG_VERSION'))) {
    console.warn('Inisialisasi cluster PostgreSQL portabel…');
    await pg.initialise();
  }
  await pg.start();

  if (!existsSync(marker)) {
    const admin = pg.getPgClient('postgres');
    await admin.connect();
    const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = 'simrs'");
    if (exists.rowCount === 0) await admin.query('CREATE DATABASE simrs');
    await admin.end();

    // Jalankan per pernyataan seperti psql di container Docker: string multi-pernyataan di driver pg
    // menjadi satu transaksi implisit, dan CREATE DATABASE menolak berjalan di dalam transaksi.
    // init.sql tidak memakai blok $$ atau literal berisi ';'/'--', jadi pemisahan sederhana ini aman.
    const statements = readFileSync(resolve(root, 'infra/postgres/init.sql'), 'utf8')
      .split('\n')
      .map((line) => line.replace(/--.*$/, ''))
      .join('\n')
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean);
    const client = pg.getPgClient('simrs');
    await client.connect();
    for (const sql of statements) await client.query(sql);
    await client.end();
    writeFileSync(marker, new Date().toISOString());
    console.warn('init.sql dijalankan: role simrs_migrator/simrs_app, ekstensi, database simrs_test.');
  }

  console.warn(`PostgreSQL portabel siap di 127.0.0.1:${port} · Ctrl+C untuk berhenti`);
  const shutdown = async () => {
    await pg.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  // Dikendalikan scripts/with-pg.mjs lewat IPC: di Windows sinyal tidak menjalankan handler,
  // sehingga penghentian bersih (pg.stop) diminta lewat pesan.
  if (process.send) {
    process.on('message', (m) => m === 'stop' && void shutdown());
    process.send('ready');
  }
}

main().catch(async (err) => {
  console.error(err);
  await pg.stop().catch(() => {});
  process.exit(1);
});
