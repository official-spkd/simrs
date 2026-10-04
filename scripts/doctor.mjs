#!/usr/bin/env node
// Cek prasyarat lokal SIM RS, lintas platform (Windows/WSL/Linux/macOS). Padanan Node dari scripts/doctor.sh.
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { parseEnv } from 'node:util';

let ok = 0;
let warn = 0;
let fail = 0;
const pass = (m) => (ok++, console.log(`  \x1b[32m✓\x1b[0m ${m}`));
const wrn = (m) => (warn++, console.log(`  \x1b[33m!\x1b[0m ${m}`));
const bad = (m) => (fail++, console.log(`  \x1b[31m✗\x1b[0m ${m}`));
const run = (cmd) => {
  try {
    return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'], timeout: 15_000 })
      .toString()
      .trim();
  } catch {
    return null;
  }
};
const portOpen = (port) =>
  new Promise((resolve) => {
    const s = createConnection({ port, host: '127.0.0.1' });
    s.setTimeout(500);
    s.once('connect', () => (s.destroy(), resolve(true)));
    s.once('error', () => resolve(false));
    s.once('timeout', () => (s.destroy(), resolve(false)));
  });

console.log('SIM RS · pemeriksaan prasyarat');
const [major, minor] = process.versions.node.split('.').map(Number);
major > 24 || (major === 24 && minor >= 7)
  ? pass(`Node v${process.versions.node} (argon2id bawaan tersedia)`)
  : bad(`Node v${process.versions.node} — butuh ≥ 24.7 untuk argon2id bawaan (ADR-0011)`);
const pnpm = run('pnpm -v');
pnpm ? pass(`pnpm ${pnpm}`) : bad('pnpm belum aktif (corepack enable, lihat ADR-0007 untuk Windows)');
const git = run('git --version');
git ? pass(git) : bad('git belum terpasang');
const dockerVer = run('docker info --format "{{.ServerVersion}}"');
dockerVer
  ? pass(`Docker engine ${dockerVer}`)
  : bad('Docker engine tidak terjangkau (Docker Desktop mati, atau virtualisasi/WSL2 belum aktif)');
run('docker compose version') ? pass('docker compose tersedia') : bad('docker compose tidak tersedia');
existsSync('.env') ? pass('.env ada') : wrn('.env belum ada (salin dari .env.example)');

// Port Postgres seperti with-pg: env proses dulu, lalu .env, bawaan 5432 (di Mac bisa 5433 bila 5432 dipegang
// Postgres Homebrew).
const dotenv = existsSync('.env') ? parseEnv(readFileSync('.env', 'utf8')) : {};
const pgPort = Number(process.env.POSTGRES_PORT ?? dotenv.POSTGRES_PORT ?? 5432);
const services = [
  [pgPort, 'Postgres'],
  [6379, 'Redis'],
  [8025, 'Mailpit'],
  [9000, 'MinIO'],
];
for (const [port, name] of services) {
  (await portOpen(port))
    ? pass(`${name} mendengar di :${port}`)
    : wrn(`${name} belum berjalan di :${port} (docker compose up -d)`);
}
const apps = { 3000: 'web', 4000: 'api', 4100: 'mock' };
for (const [port, name] of Object.entries(apps)) {
  if (await portOpen(Number(port)))
    wrn(`Port ${port} (${name}) sudah dipakai — abaikan bila itu \`pnpm dev\` SIM RS`);
}

console.log(`\nHasil: ${ok} lolos, ${warn} peringatan, ${fail} gagal`);
process.exit(fail === 0 ? 0 : 1);
