#!/usr/bin/env node
/**
 * Jalankan satu perintah dengan PostgreSQL portabel menyala, lalu matikan lagi (ADR-0009).
 * Untuk mesin tanpa Docker. Bila port Postgres sudah dipakai (Docker atau `pnpm pg:portable`),
 * perintah langsung dijalankan memakai server yang ada.
 *
 * Contoh: pnpm with-pg pnpm --filter @simrs/db test
 *
 * Lingkungan proses anak = lingkungan pemanggil apa adanya (PATH, variabel yang diekspor, mis. DATA_SOURCE dari
 * `pnpm dev:demo`) + dari `.env` HANYA daftar putih `ENV_ALLOWLIST`, dan hanya bila pemanggil belum menyetelnya:
 *   POSTGRES_PORT                         port Postgres yang dijamin menyala oleh skrip ini
 *   DATABASE_URL, MIGRATOR_DATABASE_URL   koneksi aplikasi/migrator ke Postgres itu (db:*, api, worker)
 *   TEST_DATABASE_URL, TEST_APP_DATABASE_URL   koneksi database tes (tes db/api/worker, E2E)
 *   TZ                                    zona waktu proses (Asia/Jakarta), juga `globalEnv` turbo
 * Variabel lain di `.env` (NODE_ENV, APP_ENV, kunci enkripsi, rahasia mock, batas laju, …) dibaca sendiri oleh setiap
 * perintah dari `.env` root, dengan nilai lingkungan tetap menang:
 *   api `src/load-env.ts` + `start` (`--env-file-if-exists`) · worker `src/load-env.ts` · mock `--env-file-if-exists`
 *   db `prisma.config.ts` + skrip `tsx --env-file-if-exists` · tes db/api/worker `test/global-setup.ts`
 *   web `next.config.ts` (daftar putih sendiri) · E2E `playwright.config.ts` (daftar putih sendiri)
 * Jadi perintah berperilaku sama seperti tanpa with-pg (jalur Docker). Dulu seluruh `.env` diwariskan, termasuk
 * NODE_ENV=development yang ikut ke `next build`/`next start` (`pnpm demo`, E2E) dan ke tes lewat turbo.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';

const ENV_ALLOWLIST = [
  'POSTGRES_PORT',
  'DATABASE_URL',
  'MIGRATOR_DATABASE_URL',
  'TEST_DATABASE_URL',
  'TEST_APP_DATABASE_URL',
  'TZ',
];

const [cmd, ...args] = process.argv.slice(2);
if (!cmd) {
  console.error('Pemakaian: pnpm with-pg <perintah> [argumen…]');
  process.exit(2);
}

// .env opsional; dibaca tanpa dimuat ke process.env skrip ini.
const fileEnv = existsSync('.env') ? parseEnv(readFileSync('.env', 'utf8')) : {};
const childEnv = { ...process.env };
for (const key of ENV_ALLOWLIST) {
  if (childEnv[key] === undefined && fileEnv[key] !== undefined) childEnv[key] = fileEnv[key];
}
const port = Number(childEnv.POSTGRES_PORT ?? 5432);

const portOpen = () =>
  new Promise((done) => {
    const s = createConnection({ port, host: '127.0.0.1' });
    s.setTimeout(500);
    s.once('connect', () => (s.destroy(), done(true)));
    s.once('error', () => done(false));
    s.once('timeout', () => (s.destroy(), done(false)));
  });

/**
 * Jalankan perintah TANPA shell (argumen tidak pernah diinterpretasi ulang → aman dari injeksi).
 * `node` → Node yang sedang berjalan; `pnpm` → path yang diberikan pnpm sendiri (npm_execpath).
 */
function resolveCommand(command, argv) {
  if (command === 'node') return [process.execPath, argv];
  if (command === 'pnpm' && process.env.npm_execpath) {
    const exec = process.env.npm_execpath;
    return /\.(c|m)?js$/.test(exec) ? [process.execPath, [exec, ...argv]] : [exec, argv];
  }
  return [command, argv];
}

function run(command, argv) {
  const [file, fileArgs] = resolveCommand(command, argv);
  return new Promise((done) => {
    const child = spawn(file, fileArgs, { stdio: 'inherit', env: childEnv });
    child.on('error', (err) => {
      console.error(`Gagal menjalankan ${command}: ${err.message}`);
      done(1);
    });
    child.on('exit', (code, signal) => done(code ?? (signal ? 1 : 0)));
  });
}

let server;
if (!(await portOpen())) {
  server = spawn(process.execPath, [resolve('scripts/pg-portable.mjs')], {
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    env: childEnv,
  });
  await new Promise((ready, fail) => {
    const timer = setTimeout(() => fail(new Error('Postgres portabel tidak siap dalam 60 detik')), 60_000);
    server.once('message', (m) => {
      if (m === 'ready') {
        clearTimeout(timer);
        ready();
      }
    });
    server.once('exit', (code) => {
      clearTimeout(timer);
      fail(new Error(`Postgres portabel berhenti (kode ${code})`));
    });
  });
}

let code = 1;
try {
  code = await run(cmd, args);
} finally {
  if (server && server.exitCode === null) {
    const exited = new Promise((r) => server.once('exit', r));
    server.send('stop');
    await exited;
  }
}
process.exit(code);
