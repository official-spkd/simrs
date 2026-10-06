#!/usr/bin/env node
/**
 * `node scripts/codex-tugas.mjs <CX-n> [--exec] [--dry-run]`: siapkan dan jalankan satu tugas Codex dari papan tugas
 * `docs/13-pembagian-tugas-cd-cx.md`. Jalankan dari checkout utama.
 *
 * Langkah (semuanya tidak destruktif; yang sudah ada dipakai ulang, tidak di-reset):
 *   1. Worktree `~/.codex/worktrees/<cx-n>/simrs` di branch `codex/<cx-n>` dari `master` (§3 papan tugas).
 *   2. `.env` disalin dari checkout utama bila worktree belum punya (tidak di-commit; berisi kunci lokal).
 *   3. Database tes slot tugas (§4) dibuat bila belum ada (`CREATE DATABASE`, tidak pernah DROP).
 *   4. `pnpm install` + `pnpm build` di worktree bila `node_modules` belum ada.
 *   5. Codex dijalankan di worktree dengan prompt §10 dan variabel slot (URL database tes, port E2E) yang menimpa
 *      `.env`. Bawaan: sesi interaktif `codex`. `--exec`: `codex exec` tanpa interaksi, pesan terakhir disimpan di
 *      `~/.codex/worktrees/<cx-n>/hasil-terakhir.md`.
 *
 * Sandbox Codex `workspace-write` dengan jaringan (Postgres/Redis lokal, port E2E) dan akses tulis ke direktori git
 * repo utama (worktree menyimpan metadata commit di sana). Codex tidak mendapat akses tulis ke checkout utama.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

/** Slot sumber daya per tugas; harus sama dengan tabel §4 `docs/13-pembagian-tugas-cd-cx.md`. */
const SLOTS = {
  'CX-0': {
    db: 'simrs_test_codex_a',
    api: 4510,
    web: 3510,
    demo: 3511,
    mock: 4610,
    tmp: 'simrs-demo-e2e-cxa',
  },
  'CX-1': {
    db: 'simrs_test_codex_a',
    api: 4510,
    web: 3510,
    demo: 3511,
    mock: 4610,
    tmp: 'simrs-demo-e2e-cxa',
  },
  'CX-2': {
    db: 'simrs_test_codex_b',
    api: 4520,
    web: 3520,
    demo: 3521,
    mock: 4620,
    tmp: 'simrs-demo-e2e-cxb',
  },
  'CX-3': {
    db: 'simrs_test_codex_c',
    api: 4530,
    web: 3530,
    demo: 3531,
    mock: 4630,
    tmp: 'simrs-demo-e2e-cxc',
  },
  'CX-4': {
    db: 'simrs_test_codex_a',
    api: 4510,
    web: 3510,
    demo: 3511,
    mock: 4610,
    tmp: 'simrs-demo-e2e-cxa',
  },
};

const args = process.argv.slice(2);
const id = (args.find((a) => !a.startsWith('--')) ?? '').toUpperCase();
const execMode = args.includes('--exec');
const dryRun = args.includes('--dry-run');
const slot = SLOTS[id];
if (!slot) {
  console.error(`Pakai: node scripts/codex-tugas.mjs <${Object.keys(SLOTS).join('|')}> [--exec] [--dry-run]`);
  process.exit(2);
}

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const slug = id.toLowerCase();
const base = join(homedir(), '.codex', 'worktrees', slug);
const worktree = join(base, 'simrs');
const branch = `codex/${slug}`;

function run(cmd, cmdArgs, opts = {}) {
  console.log(`\n▶ ${cmd} ${cmdArgs.join(' ')}`);
  if (dryRun) return { status: 0, stdout: '' };
  const r = spawnSync(cmd, cmdArgs, { stdio: opts.capture ? 'pipe' : 'inherit', encoding: 'utf8', ...opts });
  if (r.status !== 0 && !opts.allowFail) {
    console.error(`Gagal: ${cmd} ${cmdArgs.join(' ')}`);
    process.exit(r.status ?? 1);
  }
  return r;
}

// 1. Worktree (dipakai ulang bila sudah ada: pekerjaan yang belum di-commit tidak pernah dibuang).
if (existsSync(join(worktree, '.git'))) {
  console.log(`Worktree sudah ada: ${worktree} (dipakai ulang)`);
} else {
  mkdirSync(base, { recursive: true });
  const hasBranch =
    spawnSync('git', ['-C', repo, 'rev-parse', '--verify', '--quiet', branch], { stdio: 'ignore' }).status ===
    0;
  run('git', ['-C', repo, 'worktree', 'add', worktree, ...(hasBranch ? [branch] : ['-b', branch, 'master'])]);
}

// 2. `.env` lokal (tidak dibaca isinya di sini kecuali untuk membangun URL database slot).
const rootEnv = join(repo, '.env');
if (!existsSync(rootEnv)) {
  console.error('Checkout utama belum punya .env; jalankan `node scripts/init-env.mjs` dulu (tutorial §1).');
  process.exit(1);
}
if (!dryRun && !existsSync(join(worktree, '.env'))) copyFileSync(rootEnv, join(worktree, '.env'));

// URL database slot: pengguna, sandi, host, dan port sama dengan `.env` utama; hanya nama database yang diganti.
const env = parseEnv(readFileSync(rootEnv, 'utf8'));
function withDb(url) {
  if (!url) return undefined;
  const u = new URL(url);
  u.pathname = `/${slot.db}`;
  return u.toString();
}
const slotEnv = {
  DATABASE_URL: withDb(env.TEST_APP_DATABASE_URL ?? env.DATABASE_URL),
  MIGRATOR_DATABASE_URL: withDb(env.TEST_DATABASE_URL ?? env.MIGRATOR_DATABASE_URL),
  TEST_DATABASE_URL: withDb(env.TEST_DATABASE_URL ?? env.MIGRATOR_DATABASE_URL),
  TEST_APP_DATABASE_URL: withDb(env.TEST_APP_DATABASE_URL ?? env.DATABASE_URL),
  E2E_API_PORT: String(slot.api),
  E2E_WEB_PORT: String(slot.web),
  E2E_DEMO_PORT: String(slot.demo),
  E2E_MOCK_PORT: String(slot.mock),
  E2E_TMP_NAME: slot.tmp,
};
for (const [k, v] of Object.entries(slotEnv)) if (v === undefined) delete slotEnv[k];

// 3. Database tes slot (hanya CREATE bila belum ada).
const exists = run(
  'docker',
  [
    'compose',
    'exec',
    '-T',
    'postgres',
    'psql',
    '-U',
    'postgres',
    '-tAc',
    `SELECT 1 FROM pg_database WHERE datname='${slot.db}'`,
  ],
  { cwd: repo, capture: true, allowFail: true },
);
if (exists.status !== 0) {
  console.error('Postgres Docker tidak terjangkau; jalankan `docker compose up -d` dulu.');
  process.exit(1);
}
if (!dryRun && exists.stdout.trim() !== '1') {
  run(
    'docker',
    [
      'compose',
      'exec',
      '-T',
      'postgres',
      'psql',
      '-U',
      'postgres',
      '-c',
      `CREATE DATABASE ${slot.db} OWNER simrs_migrator`,
    ],
    { cwd: repo },
  );
}

// 4. Dependensi + build paket (sekali per worktree).
if (!existsSync(join(worktree, 'node_modules'))) {
  run('pnpm', ['install', '--frozen-lockfile'], { cwd: worktree });
  run('pnpm', ['build'], { cwd: worktree });
}

// 5. Prompt §10 papan tugas + slot.
const prompt = `Kerjakan tugas ${id} dari docs/13-pembagian-tugas-cd-cx.md di worktree ${worktree} (branch ${branch}).
Fokus front end mode presentasi; backend ditunda. Baca AGENTS.md, CLAUDE.md, docs/12-codex-claude.md,
docs/13-pembagian-tugas-cd-cx.md (§1 arti interaktif, §2 kepemilikan, §3 integrasi, rincian ${id} di §7),
docs/PROGRESS.md, docs/adr/0023-*.md, dan docs/panduan/19-peta-kode.md. Bila docs/handoff/${id}.md belum ada, salin
docs/handoff/TEMPLATE.md menjadi docs/handoff/${id}.md; perbarui setelah tiap potongan dan sebelum berhenti.
Sumber daya slot ${id} sudah disetel di lingkungan shell dan menimpa .env: database ${slot.db}, port E2E
API ${slot.api} / web ${slot.web} / demo ${slot.demo} / mock ${slot.mock}, E2E_TMP_NAME=${slot.tmp}. Jangan memakai port
atau database lain, jangan menjalankan \`pnpm dev\`, jangan membuat ulang atau menghapus database.
Hanya sunting berkas milik ${id} (§2). Commit per potongan yang hijau (Conventional Commits, kode komponen di badan).
Jangan menggabungkan ke master, jangan push, dan jangan menyunting checkout utama /Users/godam/PROYEK/simrs.
Setelah gerbang hijau (§3 langkah 2), tandai handoff "siap integrasi" dengan commit terakhir dan bukti tes.`;

const gitDir = spawnSync('git', ['-C', repo, 'rev-parse', '--git-common-dir'], {
  encoding: 'utf8',
}).stdout.trim();
const codexArgs = [
  '-C',
  worktree,
  '-s',
  'workspace-write',
  '--add-dir',
  resolve(repo, gitDir),
  '-c',
  'sandbox_workspace_write.network_access=true',
  '-c',
  'shell_environment_policy.inherit=all',
];
const childEnv = { ...process.env, ...slotEnv };

console.log(`\nTugas ${id} · worktree ${worktree} · branch ${branch} · database ${slot.db}`);
if (dryRun) {
  console.log('\n(--dry-run) Prompt:\n' + prompt);
  process.exit(0);
}
const final = execMode
  ? run('codex', ['exec', ...codexArgs, '-o', join(base, 'hasil-terakhir.md'), prompt], {
      env: childEnv,
      allowFail: true,
    })
  : run('codex', [...codexArgs, prompt], { env: childEnv, allowFail: true });
console.log(
  `\nCodex selesai (kode ${final.status}). Checkpoint: ${join(worktree, 'docs', 'handoff', `${id}.md`)}`,
);
process.exit(final.status ?? 0);
