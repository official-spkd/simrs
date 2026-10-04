#!/usr/bin/env node
/**
 * `pnpm demo`: jalankan SIM RS untuk PRESENTASI (ADR-0023) dari build produksi, agar layar tidak dikompilasi saat
 * tampil di depan audiens. Postgres portabel + build semua paket + API, worker, mock, dan web (`next start`) dalam
 * mode presentasi (data dummy fiktif). Hanya untuk APP_ENV=local; web menolak mode ini di staging/produksi.
 *
 *   pnpm demo            # build lalu jalankan (Ctrl+C berhenti)
 *   pnpm demo --tanpa-build   # pakai build terakhir (lebih cepat bila kode tidak berubah)
 */
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const skipBuild = process.argv.includes('--tanpa-build');
const env = {
  ...process.env,
  DATA_SOURCE: 'demo',
  // Presenter berganti akun presentasi berkali-kali: batas laju login lokal dilonggarkan khusus mode ini.
  AUTH_RATE_LIMIT_PER_MIN: process.env.AUTH_RATE_LIMIT_PER_MIN ?? '60',
};

/** Jalankan perintah TANPA shell (argumen tidak pernah diinterpretasi ulang). */
function run(args, label) {
  return new Promise((done, fail) => {
    console.log(`\n▶ ${label}`);
    const child = spawn(process.execPath, args, { stdio: 'inherit', env });
    child.on('exit', (code) => (code === 0 ? done() : fail(new Error(`${label} gagal (kode ${code})`))));
  });
}

const pnpm = process.env.npm_execpath;
if (!pnpm) {
  console.error('Jalankan lewat pnpm: pnpm demo');
  process.exit(2);
}
const pnpmArgs = (...a) => (/\.(c|m)?js$/.test(pnpm) ? [pnpm, ...a] : null);
if (!pnpmArgs()) {
  console.error('npm_execpath bukan skrip JS; jalankan dengan `pnpm demo` dari terminal biasa.');
  process.exit(2);
}

try {
  if (!skipBuild) {
    await run(
      pnpmArgs(
        'exec',
        'turbo',
        'run',
        'build',
        '--filter=@simrs/api',
        '--filter=@simrs/web',
        '--filter=@simrs/worker',
      ),
      'Build produksi (paket, API, worker, web)',
    );
  }
  console.log(
    '\nMode presentasi: data dummy fiktif. Buka http://localhost:3000/masuk lalu pilih akun presentasi.',
  );
  console.log('Belum ada akun presentasi? Jalankan `pnpm db:akun-presentasi` di terminal lain.');
  await run(
    [
      resolve('scripts/with-pg.mjs'),
      'pnpm',
      '-r',
      '--parallel',
      '--filter=@simrs/api',
      '--filter=@simrs/worker',
      '--filter=@simrs/mock',
      '--filter=@simrs/web',
      'start',
    ],
    'Menjalankan API, worker, mock, dan web (Ctrl+C berhenti)',
  );
} catch (err) {
  console.error(`\n${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
