#!/usr/bin/env node
/**
 * Jalankan satu perintah dengan PostgreSQL portabel menyala, lalu matikan lagi (ADR-0009).
 * Untuk mesin tanpa Docker. Bila port Postgres sudah dipakai (Docker atau `pnpm pg:portable`),
 * perintah langsung dijalankan memakai server yang ada.
 *
 * Contoh: pnpm with-pg pnpm --filter @simrs/db test
 */
import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { resolve } from 'node:path';

const [cmd, ...args] = process.argv.slice(2);
if (!cmd) {
  console.error('Pemakaian: pnpm with-pg <perintah> [argumen…]');
  process.exit(2);
}

try {
  process.loadEnvFile('.env');
} catch {
  // .env opsional
}
const port = Number(process.env.POSTGRES_PORT ?? 5432);

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
    const child = spawn(file, fileArgs, { stdio: 'inherit' });
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
