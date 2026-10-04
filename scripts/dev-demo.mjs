#!/usr/bin/env node
/**
 * `pnpm dev:demo`: lingkungan lokal tanpa Docker (seperti `pnpm dev:lokal`) dalam MODE PRESENTASI (ADR-0023):
 * layar fase 2–10 yang backend-nya belum ada memakai data dummy fiktif. Mode ini hanya aktif bila APP_ENV=local;
 * web menolaknya di staging/produksi walau DATA_SOURCE=demo.
 */
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

// Presenter berganti akun presentasi berkali-kali (tiap login = 2 permintaan kredensial): batas laju login lokal
// dilonggarkan khusus mode ini. Akun dan batas di staging/produksi tidak terpengaruh.
const env = {
  ...process.env,
  DATA_SOURCE: 'demo',
  AUTH_RATE_LIMIT_PER_MIN: process.env.AUTH_RATE_LIMIT_PER_MIN ?? '60',
};
const args = [
  resolve('scripts/with-pg.mjs'),
  'pnpm',
  'exec',
  'turbo',
  'run',
  'dev',
  '--parallel',
  '--filter=@simrs/api',
  '--filter=@simrs/web',
  '--filter=@simrs/worker',
  '--filter=@simrs/mock',
];

console.log('Mode presentasi: data dummy fiktif untuk layar yang belum tersambung ke backend.');
// Tanpa shell: argumen tidak pernah diinterpretasi ulang.
const child = spawn(process.execPath, args, { stdio: 'inherit', env });
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
