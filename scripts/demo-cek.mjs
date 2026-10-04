#!/usr/bin/env node
/**
 * `pnpm demo:cek`: daftar periksa sebelum presentasi (ADR-0023). Tidak mengubah apa pun; hanya membaca dan
 * menjelaskan perintah perbaikan bila ada yang belum siap.
 */
import { existsSync, readFileSync } from 'node:fs';
import { createConnection } from 'node:net';

let fail = 0;
let warn = 0;
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const wrn = (m, fix) => (warn++, console.log(`  \x1b[33m!\x1b[0m ${m}${fix ? `\n      → ${fix}` : ''}`));
const bad = (m, fix) => (fail++, console.log(`  \x1b[31m✗\x1b[0m ${m}${fix ? `\n      → ${fix}` : ''}`));

const portOpen = (port) =>
  new Promise((resolve) => {
    const s = createConnection({ port, host: '127.0.0.1' });
    s.setTimeout(700);
    s.once('connect', () => (s.destroy(), resolve(true)));
    s.once('error', () => resolve(false));
    s.once('timeout', () => (s.destroy(), resolve(false)));
  });

async function get(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000), redirect: 'manual' });
    return { status: res.status, text: await res.text() };
  } catch {
    return null;
  }
}

console.log('SIM RS · cek kesiapan presentasi\n');

let env = {};
try {
  env = Object.fromEntries(
    readFileSync('.env', 'utf8')
      .split(/\r?\n/)
      .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/))
      .filter(Boolean)
      .map((m) => [m[1], m[2].replace(/^["']|["']$/g, '')]),
  );
} catch {
  // .env belum ada: dilaporkan lewat APP_ENV di bawah
}
const appEnv = env.APP_ENV;
appEnv === 'local'
  ? ok('APP_ENV=local di .env (mode presentasi diizinkan)')
  : bad(
      `APP_ENV di .env = ${appEnv ?? '(tidak ada)'}; mode presentasi hanya untuk lokal`,
      'pnpm env:init lalu set APP_ENV=local',
    );

const accountsFile = '.local/demo-accounts.json';
if (existsSync(accountsFile)) {
  try {
    const n = JSON.parse(readFileSync(accountsFile, 'utf8')).accounts?.length ?? 0;
    n >= 16
      ? ok(`Akun presentasi tersedia (${n} posisi)`)
      : wrn(`Akun presentasi hanya ${n}`, 'pnpm db:akun-presentasi');
  } catch {
    bad('Berkas akun presentasi rusak', 'pnpm db:akun-presentasi');
  }
} else {
  bad('Akun presentasi belum dibuat', 'pnpm with-pg pnpm db:akun-presentasi');
}

// Port sama dengan with-pg (dipakai pnpm demo): env proses dulu, lalu .env, bawaan 5432. Di Mac bisa 5433
// bila 5432 dipegang Postgres Homebrew.
const pgPort = Number(process.env.POSTGRES_PORT ?? env.POSTGRES_PORT ?? 5432);
(await portOpen(pgPort))
  ? ok(`PostgreSQL berjalan di ${pgPort}`)
  : wrn('PostgreSQL belum berjalan (akan dinyalakan otomatis oleh pnpm demo / pnpm dev:demo)');

const api = await get('http://127.0.0.1:4000/health');
api?.status === 200
  ? ok('API sehat di :4000')
  : wrn('API belum berjalan di :4000', 'pnpm demo (atau pnpm dev:demo)');

const login = await get('http://localhost:3000/masuk');
if (!login) {
  wrn('Web belum berjalan di :3000', 'pnpm demo (atau pnpm dev:demo)');
} else if (login.text.includes('Masuk cepat')) {
  ok('Web di :3000 dalam mode presentasi (daftar akun presentasi tampil)');
} else {
  bad('Web di :3000 berjalan TANPA mode presentasi', 'hentikan lalu jalankan pnpm demo / pnpm dev:demo');
}

console.log(
  `\n${fail ? `\x1b[31m${fail} masalah\x1b[0m` : '\x1b[32mSiap presentasi\x1b[0m'}${warn ? ` · ${warn} catatan` : ''}`,
);
console.log(
  'Sebelum tampil: pilih akun presentasi, buka Simulasi pasien, tekan "Mulai ulang" pada skenario yang dipakai.',
);
process.exit(fail ? 1 : 0);
