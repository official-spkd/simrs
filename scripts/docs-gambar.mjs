#!/usr/bin/env node
/**
 * `pnpm docs:gambar`: tangkap ulang gambar panduan (docs/panduan/gambar/*.png, 1366×768) lewat Playwright,
 * proyek `docs` (layar mode presentasi) dan `docs-api` (layar tersambung API). Menyalakan stack E2E sendiri (mock,
 * API, worker, build web) di slot E2E salinan repo ini (`E2E_*_PORT`, `E2E_TMP_NAME`), seperti `test:e2e`.
 *
 * Argumen tambahan diteruskan ke Playwright, mis. `pnpm docs:gambar -- --grep "order|lab"` untuk sebagian layar,
 * atau `pnpm docs:gambar -- --project=docs` untuk mode presentasi saja. Tanpa Docker: `pnpm with-pg pnpm docs:gambar`.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2).filter((a) => a !== '--');
const hasProject = args.some((a) => a.startsWith('--project'));
const projects = hasProject ? [] : ['--project=docs', '--project=docs-api'];

const run = spawnSync(
  'pnpm',
  ['--filter', '@simrs/web', 'exec', 'playwright', 'test', ...projects, ...args],
  { stdio: 'inherit', env: { ...process.env, DOCS_CAPTURE: '1' }, shell: process.platform === 'win32' },
);

const dir = resolve(process.env.DOCS_CAPTURE_DIR ?? join('docs', 'panduan', 'gambar'));
const files = readdirSync(dir).filter((f) => f.endsWith('.png'));
const big = files.filter((f) => statSync(join(dir, f)).size > 300 * 1024);
const total = files.reduce((n, f) => n + statSync(join(dir, f)).size, 0);
console.log(
  `\nGambar PNG di ${dir}: ${files.length} berkas, total ${Math.round(total / 1024)} KB` +
    (big.length ? `; > 300 KB: ${big.join(', ')}` : '; semua ≤ 300 KB'),
);
console.log('Periksa hasilnya (git diff --stat docs/panduan/gambar) sebelum commit.');
process.exit(run.status ?? 1);
