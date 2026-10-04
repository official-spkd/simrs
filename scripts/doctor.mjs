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
/**
 * Ada listener di host:port? Bila `hello` diberikan, kirim lalu kembalikan potongan balasan pertama.
 * null = tidak ada listener; '' = ada listener tanpa balasan (atau tanpa `hello`).
 */
const tcpProbe = (port, host, hello) =>
  new Promise((resolve) => {
    const s = createConnection({ port, host });
    let connected = false;
    const done = (v) => (s.destroy(), resolve(v));
    s.setTimeout(700);
    s.once('connect', () => ((connected = true), hello ? s.write(hello) : done('')));
    s.once('data', (b) => done(b.toString('latin1')));
    s.once('error', () => done(connected ? '' : null));
    s.once('end', () => done(connected ? '' : null));
    s.once('timeout', () => done(connected ? '' : null));
  });
/** GET singkat; null bila tidak menjawab HTTP. */
async function httpProbe(port, host, path) {
  try {
    const url = `http://${host.includes(':') ? `[${host}]` : host}:${port}${path}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(3000), redirect: 'manual' });
    return { server: res.headers.get('server') ?? '', body: (await res.text()).slice(0, 20_000) };
  } catch {
    return null;
  }
}

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
const envOf = (key) => process.env[key] ?? dotenv[key] ?? '';

// Tiap port diperiksa di loopback IPv4 DAN IPv6: di macOS `localhost` lebih dulu ke ::1, jadi aplikasi lain yang
// mendengar di ::1 (atau *) "mencuri" localhost walau layanan SIM RS menjawab di 127.0.0.1. Penanda `is` mengenali
// layanan kita lewat protokol/HTTP (Postgres SSLRequest, Redis PING, halaman/JSON khas aplikasi).
const LOOPBACK = [
  ['127.0.0.1', 'IPv4'],
  ['::1', 'IPv6'],
];
const MACOS_DOC = 'Lihat docs/panduan/03-tutorial.md bagian "Mesin baru (macOS)".';
const services = [
  {
    port: pgPort,
    name: 'Postgres',
    hello: Buffer.from([0, 0, 0, 8, 4, 210, 22, 47]),
    is: (r) => r === 'S' || r === 'N',
    fix: 'set POSTGRES_PORT (mis. 5433) dan port di keempat URL database di .env, lalu docker compose up -d',
  },
  {
    port: 6379,
    name: 'Redis',
    hello: 'PING\r\n',
    is: (r) => /^[+-]/.test(r),
    fix: 'hentikan aplikasi itu atau ubah port Redis di docker-compose.yml dan REDIS_URL',
  },
  {
    port: 8025,
    name: 'Mailpit',
    path: '/api/v1/info',
    is: (r) => r.body.includes('"Messages"'),
    fix: 'hentikan aplikasi itu (Mailpit memakai 8025)',
  },
  {
    port: 9000,
    name: 'MinIO',
    path: '/minio/health/live',
    is: (r) => /minio/i.test(r.server),
    fix: 'hentikan aplikasi itu atau ubah port MinIO di docker-compose.yml dan S3_ENDPOINT',
  },
];
const ownTitle = (r) => /<title>[^<]*SIM RS<\/title>/.test(r.body);
const apps = [
  {
    port: 3000,
    name: 'web',
    path: '/masuk',
    is: ownTitle,
    hint: () => 'Buka web lewat http://127.0.0.1:3000.',
  },
  {
    port: 4000,
    name: 'api',
    path: '/ready',
    is: (r) => r.body.includes('"checks"') && r.body.includes('"database"'),
    hint: () =>
      `Pastikan API_BASE_URL (dan TPDI_WEBHOOK_TARGET) memakai http://127.0.0.1:4000${/localhost/.test(envOf('API_BASE_URL')) ? ' (API_BASE_URL saat ini masih localhost)' : ''}.`,
  },
  {
    port: 4100,
    name: 'mock',
    path: '/',
    is: ownTitle,
    hint: () => 'Ganti localhost:4100 di .env (MOCK_BASE_URL, BPJS_BASE_URL, …) dengan 127.0.0.1:4100.',
  },
];

/** Keadaan port per keluarga alamat: tutup | kita | lain | diam (terbuka, tidak menjawab HTTP), + judul halaman. */
async function inspect(def) {
  return Promise.all(
    LOOPBACK.map(async ([host, family]) => {
      const tcp = await tcpProbe(def.port, host, def.hello);
      if (tcp === null) return { family, state: 'tutup' };
      if (!def.path) return { family, state: def.is(tcp) ? 'kita' : 'lain' };
      const res = await httpProbe(def.port, host, def.path);
      if (!res) return { family, state: 'diam' };
      const title = /<title>([^<]{1,60})<\/title>/.exec(res.body)?.[1];
      return { family, state: def.is(res) ? 'kita' : 'lain', title };
    }),
  );
}
const other = (s) => `aplikasi lain${s.title ? ` ("${s.title}")` : ''}`;

// Semua port diperiksa bersamaan agar cepat; hasil dicetak berurutan.
const [svcStates, appStates] = await Promise.all([
  Promise.all(services.map(inspect)),
  Promise.all(apps.map(inspect)),
]);
services.forEach((def, i) => {
  const states = svcStates[i];
  const foreign = states.filter((s) => s.state === 'lain' || s.state === 'diam');
  for (const s of foreign)
    wrn(`:${def.port} di ${s.family} dipegang ${other(s)}, bukan ${def.name} — ${def.fix}`);
  if (foreign.length) return;
  states.some((s) => s.state === 'kita')
    ? pass(`${def.name} mendengar di :${def.port}`)
    : wrn(`${def.name} belum berjalan di :${def.port} (docker compose up -d)`);
});
apps.forEach((def, i) => {
  const [v4, v6] = appStates[i];
  if (v4.state === 'lain') {
    wrn(
      `Port ${def.port} (${def.name}) di 127.0.0.1 dipakai ${other(v4)}; ${def.name} SIM RS tidak bisa memakainya`,
    );
  }
  if (v6.state === 'lain') {
    wrn(
      `localhost:${def.port} lewat IPv6 (::1) dijawab ${other(v6)}, bukan ${def.name} SIM RS: klien yang memakai ` +
        `"localhost" bisa tersasar. ${def.hint()} ${MACOS_DOC}`,
    );
  }
  for (const s of [v4, v6].filter((x) => x.state === 'diam')) {
    wrn(
      `Port ${def.port} (${def.name}) di ${s.family} terbuka tetapi tidak menjawab HTTP dalam 3 dtk — abaikan bila itu \`pnpm dev\` yang baru menyala`,
    );
  }
  if ([v4, v6].some((s) => s.state === 'kita') && ![v4, v6].some((s) => s.state === 'lain')) {
    pass(`${def.name} SIM RS sedang berjalan di :${def.port}`);
  }
});

console.log(`\nHasil: ${ok} lolos, ${warn} peringatan, ${fail} gagal`);
process.exit(fail === 0 ? 0 : 1);
