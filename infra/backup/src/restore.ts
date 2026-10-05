/**
 * Uji restore di kontainer Postgres BERSIH (ADR-0071), urut dari yang tidak membuat apa pun ke yang membuat sesuatu:
 *  pilih → unduh → manifest → checksum → kunci → dekripsi → dokumen (prepare.ts) → kontainer → pg_restore → migrasi
 *  → jumlah baris → dokumen (disk/bucket s3 sementara) → API /ready → /audit/verify per tenant → jangkar audit. RTO = waktu dari mulai sampai API siap dan rantai audit terverifikasi.
 * Manifest rusak dan kunci salah gagal SEBELUM ada kontainer atau berkas plaintext. Plaintext hanya di folder kerja
 * baru (0700) dan selalu dihapus di akhir; kontainer dan proses API selalu dihentikan (kecuali --simpan-kontainer).
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { newId } from '@simrs/shared';
import { type BackupConfig } from './config';
import * as db from './db';
import { type Location, type Logger, shortError } from './backup';
import { parseBackupKey } from './manifest';
import { pickAnchor, tableAnchors, wormAnchors } from './anchors';
import { primaryS3 } from './config';
import { prepareBackup } from './prepare';
import {
  checkDocumentRows,
  SCRATCH_DOCUMENTS_BUCKET,
  type ScratchMinio,
  startScratchMinio,
  uploadDocuments,
} from './restore-docs';
import { dockerAvailable, run, runChecked, waitForExit } from './tools';

export { pickBackup } from './prepare';

export interface StepResult {
  ok: boolean;
  ms: number;
  detail?: string;
}

export interface RestoreOptions {
  source: Location;
  backupKey?: string;
  record: boolean;
  keepContainers?: boolean;
  /** Baris `documents` yang berkasnya tidak ada di arsip = gagal (bawaan: peringatan). */
  strictDocuments?: boolean;
  log?: Logger;
  /** Entry API yang sudah di-build (bawaan apps/api/dist/main.js). */
  apiEntry?: string;
}

export interface RestoreReport {
  id: string;
  backupKey: string | null;
  source: Location;
  status: 'success' | 'failed';
  startedAt: string;
  finishedAt: string;
  rtoSeconds: number;
  checks: Record<string, StepResult>;
  error: string | null;
  failedStep: string | null;
  recorded: boolean;
  reportFile: string;
  containers: string[];
}

class StepFailure extends Error {
  constructor(
    readonly step: string,
    message: string,
  ) {
    super(message);
  }
}

const RESTORE_DB = 'simrs_restore';
const LOCAL_ROLE_PASSWORDS = { migrator: 'migrator_local', app: 'app_local' } as const;

function freePort(): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => resolvePromise(port));
    });
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** `docker run -d` lalu baca port host acak yang dipetakan ke `containerPort`. */
async function startContainer(
  name: string,
  containerPort: number,
  args: readonly string[],
  env: Record<string, string> = {},
): Promise<number> {
  await runChecked('docker', ['run', '-d', '--rm', '--name', name, ...args], {
    env,
    secrets: Object.values(env),
  });
  const port = await runChecked('docker', ['port', name, `${containerPort}/tcp`]);
  const m = /:(\d+)\s*$/m.exec(port.stdout.trim().split('\n')[0] ?? '');
  if (!m) throw new Error(`port kontainer ${name} tidak terbaca`);
  return Number(m[1]);
}

async function waitForPostgres(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    try {
      const c = await db.connect(url, 'simrs-uji-restore');
      try {
        // init.sql selesai = peran aplikasi + backup sudah ada (server sementara entrypoint tidak membuka TCP).
        const r = await c.query(
          "SELECT count(*)::int AS n FROM pg_roles WHERE rolname IN ('simrs_migrator', 'simrs_app', 'simrs_backup')",
        );
        if (r.rows[0]?.n === 3) return;
        last = 'peran init.sql belum lengkap';
      } finally {
        await c.end();
      }
    } catch (err) {
      last = (err as Error).message;
    }
    await sleep(1000);
  }
  throw new Error(`Postgres kontainer tidak siap: ${last}`);
}

async function httpJson(
  url: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // bukan JSON
  }
  return { status: res.status, body };
}

export async function runRestoreTest(cfg: BackupConfig, opts: RestoreOptions): Promise<RestoreReport> {
  const log = opts.log ?? (() => undefined);
  const t0 = Date.now();
  const startedAt = new Date(t0);
  const id = newId();
  const work = join(cfg.restoreWorkDir, id);
  const reportDir = join(cfg.restoreWorkDir, 'laporan');
  const checks: Record<string, StepResult> = {};
  const containers: string[] = [];
  const short = id.replace(/-/g, '').slice(-10);
  let backupKey: string | null = opts.backupKey ?? null;
  let api: ChildProcess | null = null;
  let apiLog = '';
  let error: string | null = null;
  let failedStep: string | null = null;
  let rtoSeconds: number;

  const step = async <T>(
    name: string,
    fn: () => Promise<T>,
    detail?: (v: T) => string | undefined,
  ): Promise<T> => {
    const s = Date.now();
    try {
      const v = await fn();
      checks[name] = { ok: true, ms: Date.now() - s, ...(detail ? { detail: detail(v) } : {}) };
      log(`✓ ${name}${checks[name]?.detail ? ` · ${checks[name]?.detail}` : ''}`);
      return v;
    } catch (err) {
      const msg = shortError(err);
      checks[name] = { ok: false, ms: Date.now() - s, detail: msg.slice(0, 300) };
      log(`✗ ${name} · ${msg}`);
      throw new StepFailure(name, msg);
    }
  };

  try {
    // 1–7. Pilih, ambil, manifest, checksum, kunci, dekripsi, dokumen (prepare.ts): tanpa kontainer sampai lolos.
    const prepared = await prepareBackup(cfg, {
      source: opts.source,
      backupKey: opts.backupKey,
      workDir: join(work, 'pulih'),
      step,
      onSelected: (k) => {
        backupKey = k;
      },
    });
    const { manifest, dumpPath, storageDir } = prepared;
    const extracted = prepared.documents;

    // 8. Kontainer bersih: Postgres (init.sql = peran yang sama dengan produksi) + Redis (+ MinIO bila dokumen s3).
    const s3Docs = manifest.documents.source === 's3';
    let minio: ScratchMinio | null = null;
    if (!(await dockerAvailable())) throw new StepFailure('container', 'Docker tidak tersedia');
    const superPassword = randomBytes(18).toString('base64url');
    const ports = await step(
      'container',
      async () => {
        const pgName = `${cfg.containerPrefix}-pg-${short}`;
        const redisName = `${cfg.containerPrefix}-redis-${short}`;
        containers.push(pgName);
        const pgPort = await startContainer(
          pgName,
          5432,
          [
            '-e',
            'POSTGRES_PASSWORD',
            '-e',
            'POSTGRES_DB=simrs',
            '-e',
            'TZ=Asia/Jakarta',
            '-p',
            '127.0.0.1::5432',
            '-v',
            `${join(cfg.repoRoot, 'infra/postgres/init.sql')}:/docker-entrypoint-initdb.d/01-init.sql:ro`,
            cfg.pgImage,
          ],
          { POSTGRES_PASSWORD: superPassword },
        );
        containers.push(redisName);
        const redisPort = await startContainer(redisName, 6379, ['-p', '127.0.0.1::6379', cfg.redisImage]);
        if (s3Docs) {
          const minioName = `${cfg.containerPrefix}-minio-${short}`;
          containers.push(minioName);
          minio = await startScratchMinio(
            minioName,
            cfg.minioImage,
            `uji${randomBytes(6).toString('hex')}`,
            randomBytes(24).toString('base64url'),
          );
        }
        await waitForPostgres(`postgresql://postgres:${superPassword}@127.0.0.1:${pgPort}/simrs`, 120_000);
        return { pgPort, redisPort, minio: minio?.endpoint ?? null };
      },
      (p) =>
        `postgres 127.0.0.1:${p.pgPort}, redis 127.0.0.1:${p.redisPort}` +
        (p.minio ? `, minio ${p.minio.replace('http://', '')}` : ''),
    );
    if (minio) {
      const scratch: ScratchMinio = minio;
      // 8b. Dokumen s3 kembali ke bucket BARU di MinIO sementara; server memverifikasi SHA-256 setiap objek.
      await step(
        'documents_bucket',
        () => uploadDocuments(scratch, storageDir, extracted.keys),
        (n) => `${n} objek ke bucket ${SCRATCH_DOCUMENTS_BUCKET} sementara`,
      );
    }
    const superUrl = (dbName: string) =>
      `postgresql://postgres:${superPassword}@127.0.0.1:${ports.pgPort}/${dbName}`;

    // 9. pg_restore satu transaksi, berhenti di galat pertama.
    await step('restore', async () => {
      const c = await db.connect(superUrl('simrs'), 'simrs-uji-restore');
      try {
        await c.query(`CREATE DATABASE ${RESTORE_DB} OWNER simrs_migrator TEMPLATE template0`);
      } finally {
        await c.end();
      }
      const child = spawn(
        'docker',
        [
          'exec',
          '-i',
          containers[0] ?? '',
          'pg_restore',
          '-U',
          'postgres',
          '-d',
          RESTORE_DB,
          '--exit-on-error',
          '--single-transaction',
          '--no-password',
        ],
        { stdio: ['pipe', 'ignore', 'pipe'] },
      );
      const done = waitForExit(child, 'pg_restore');
      // pg_restore yang berhenti lebih dulu memutus stdin (EPIPE); galat utamanya tetap dari kode keluar pg_restore.
      const feed = pipeline(createReadStream(dumpPath), child.stdin as NodeJS.WritableStream).catch(
        (e: unknown) => e,
      );
      await done;
      const fed = await feed;
      if (fed instanceof Error) throw fed;
    });
    // Plaintext dump tidak dibutuhkan lagi.
    await rm(dumpPath, { force: true });

    // 10. Migrasi Prisma di DB hasil restore = kode saat ini (prisma migrate status) + daftar = manifest.
    const migratorUrl = `postgresql://simrs_migrator:${LOCAL_ROLE_PASSWORDS.migrator}@127.0.0.1:${ports.pgPort}/${RESTORE_DB}?schema=public`;
    await step(
      'migrations',
      async () => {
        const dbPkg = join(cfg.repoRoot, 'packages/db');
        const prismaCli = createRequire(join(dbPkg, 'package.json')).resolve('prisma/build/index.js');
        const r = await run(process.execPath, [prismaCli, 'migrate', 'status'], {
          cwd: dbPkg,
          env: { MIGRATOR_DATABASE_URL: migratorUrl },
          timeoutMs: 120_000,
        });
        if (r.code !== 0) {
          const tail = (r.stdout + r.stderr).trim().split('\n').slice(-3).join(' | ');
          throw new Error(`prisma migrate status keluar ${r.code}: ${tail}`);
        }
        const c = await db.connect(superUrl(RESTORE_DB), 'simrs-uji-restore');
        try {
          const applied = await db.appliedMigrations(c);
          if (applied.join(',') !== manifest.database.migrations.join(',')) {
            throw new Error('MIGRATIONS_MISMATCH: daftar migrasi berbeda dari manifest');
          }
          return applied.length;
        } finally {
          await c.end();
        }
      },
      (n) => `${n} migrasi, tidak ada yang tertunda`,
    );

    // 11. Jumlah baris per tabel = manifest (snapshot yang sama dengan dump).
    await step(
      'row_counts',
      async () => {
        const c = await db.connect(superUrl(RESTORE_DB), 'simrs-uji-restore');
        try {
          const tables = await db.listTables(c);
          const counts = await db.countRows(c, tables);
          const expected = manifest.database.tables;
          const diffs: string[] = [];
          for (const t of new Set([...Object.keys(expected), ...tables])) {
            if (expected[t] !== counts[t]) diffs.push(`${t} ${counts[t] ?? '∅'}≠${expected[t] ?? '∅'}`);
          }
          if (diffs.length) throw new Error(`ROW_COUNT_MISMATCH: ${diffs.slice(0, 5).join(', ')}`);
          return Object.values(counts).reduce((a, b) => a + b, 0);
        } finally {
          await c.end();
        }
      },
      (n) => `${Object.keys(manifest.database.tables).length} tabel, ${n} baris`,
    );

    // 12. Setiap baris `documents` ↔ berkas hasil ekstrak (ukuran + SHA-256) dan, untuk s3, objek di bucket sementara.
    // s3: semua baris di-backup per objek, jadi selisih = gagal (kecuali temuan sumber di manifest). disk: peringatan,
    // gagal hanya dengan --dokumen-ketat (folder pengembangan sering tidak lengkap).
    await step(
      'documents_db',
      async () => {
        const c = await db.connect(superUrl(RESTORE_DB), 'simrs-uji-restore');
        try {
          const r = await checkDocumentRows(c, storageDir, manifest, minio);
          if (r.bad.length && (s3Docs || opts.strictDocuments)) {
            throw new Error(
              `DOCUMENTS_MISMATCH: ${r.bad.length} dari ${r.rows} baris dokumen tanpa isi yang cocok (${r.bad.slice(0, 3).join(', ')})`,
            );
          }
          return r;
        } finally {
          await c.end();
        }
      },
      (x) =>
        `${x.rows} baris dokumen, ${x.ok} cocok` +
        (x.bad.length ? `, ${x.bad.length} tanpa berkas (peringatan)` : '') +
        (x.knownAtSource ? `, ${x.knownAtSource} sudah bermasalah di sumber (peringatan)` : ''),
    );

    // 13. API menyala di atas DB hasil restore (loopback, port acak, hanya selama uji).
    const apiPort = await freePort();
    const apiBase = `http://127.0.0.1:${apiPort}`;
    await step(
      'api_ready',
      async () => {
        const entry = opts.apiEntry ?? join(cfg.repoRoot, 'apps/api/dist/main.js');
        await readFile(entry).catch(() => {
          throw new Error(`${entry} belum ada: jalankan pnpm build`);
        });
        // Folder kerja tanpa .env di ../../ sehingga API hanya memakai env di bawah.
        const cwd = join(work, 'api', 'a', 'b');
        await mkdir(cwd, { recursive: true });
        const fieldKey = process.env.FIELD_ENCRYPTION_KEY ?? randomBytes(32).toString('base64');
        const hashKey = process.env.FIELD_HASH_KEY ?? randomBytes(32).toString('base64');
        api = spawn(process.execPath, [entry], {
          cwd,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: {
            PATH: process.env.PATH,
            NODE_ENV: 'development',
            // Mode header pengembang hanya untuk uji ini: loopback, port acak, DB buangan, dimatikan di akhir.
            APP_ENV: 'local',
            ALLOW_DEV_TENANT_HEADER: 'true',
            TZ: 'Asia/Jakarta',
            HOST: '127.0.0.1',
            API_PORT: String(apiPort),
            DATABASE_URL: `postgresql://simrs_app:${LOCAL_ROLE_PASSWORDS.app}@127.0.0.1:${ports.pgPort}/${RESTORE_DB}?schema=public`,
            REDIS_URL: `redis://127.0.0.1:${ports.redisPort}`,
            ...(minio
              ? {
                  STORAGE_DRIVER: 's3',
                  S3_ENDPOINT: (minio as ScratchMinio).endpoint,
                  S3_REGION: 'us-east-1',
                  S3_ACCESS_KEY: (minio as ScratchMinio).accessKey,
                  S3_SECRET_KEY: (minio as ScratchMinio).secretKey,
                  S3_BUCKET_DOCUMENTS: SCRATCH_DOCUMENTS_BUCKET,
                }
              : {
                  STORAGE_DRIVER: 'disk',
                  STORAGE_DISK_ROOT: storageDir,
                  S3_ENDPOINT: 'http://127.0.0.1:9',
                  S3_ACCESS_KEY: 'tidak-dipakai',
                  S3_SECRET_KEY: 'tidak-dipakai',
                }),
            FIELD_ENCRYPTION_KEY: fieldKey,
            FIELD_HASH_KEY: hashKey,
            RATE_LIMIT_STORE: 'redis',
            INTEGRATION_MODE: 'mock',
          },
        });
        const onData = (d: Buffer) => {
          apiLog = (apiLog + d.toString()).slice(-4000);
        };
        api.stdout?.on('data', onData);
        api.stderr?.on('data', onData);
        const deadline = Date.now() + 120_000;
        let last = '';
        while (Date.now() < deadline) {
          if (api.exitCode !== null) throw new Error(`API berhenti (kode ${api.exitCode})`);
          try {
            const r = await httpJson(`${apiBase}/ready`);
            const body = r.body as { status?: string; checks?: Record<string, { ok: boolean }> };
            if (r.status === 200 && body.status === 'ok') {
              return Object.entries(body.checks ?? {})
                .map(([k, v]) => `${k} ${v.ok ? 'ok' : 'gagal'}`)
                .join(', ');
            }
            last = `HTTP ${r.status}`;
          } catch (err) {
            last = (err as Error).message;
          }
          await sleep(1000);
        }
        throw new Error(`/ready tidak 200: ${last}`);
      },
      (s) => s,
    );

    // 14. Rantai audit per tenant: hasil verifikasi harus SAMA dengan di sumber (manifest), lewat API /audit/verify
    // (tenant aktif) dan SQL (semua tenant ber-audit); kepala rantai = manifest. Rantai yang sudah rusak di sumber
    // dilaporkan sebagai peringatan (restore tidak bisa memperbaikinya), bukan kegagalan restore.
    await step(
      'audit_verify',
      async () => {
        const heads = new Map(manifest.database.auditHeads.map((h) => [h.tenantId, h]));
        let viaApi = 0;
        for (const t of manifest.database.tenants.filter((x) => x.status === 'active')) {
          const r = await httpJson(`${apiBase}/api/v1/audit/verify`, { 'X-Tenant-Id': t.id });
          const body = r.body as { intact?: boolean; checked?: number; firstBrokenSeq?: string | null };
          const head = heads.get(t.id);
          const expected = head?.firstBrokenSeq ?? null;
          const actual = body.intact === true ? null : (body.firstBrokenSeq ?? 'tidak diketahui');
          if (r.status !== 200 || actual !== expected) {
            throw new Error(
              `AUDIT_BROKEN: /audit/verify ${t.code} → HTTP ${r.status}, rusak di ${actual ?? '-'}, sumber ${expected ?? '-'}`,
            );
          }
          if (head && expected === null && (body.checked ?? 0) < Number(head.seq)) {
            throw new Error(`AUDIT_TRUNCATED: ${t.code} ${body.checked} < ${head.seq}`);
          }
          viaApi += 1;
        }
        const c = await db.connect(superUrl(RESTORE_DB), 'simrs-uji-restore');
        try {
          for (const h of manifest.database.auditHeads) {
            const r = await c.query<{ hash: string }>(
              'SELECT hash FROM public.audit_events WHERE tenant_id = $1 AND seq = $2',
              [h.tenantId, h.seq],
            );
            if (r.rows[0]?.hash !== h.hash) {
              throw new Error(`AUDIT_HEAD_MISMATCH: tenant ${h.tenantId} seq ${h.seq}`);
            }
            await c.query('BEGIN');
            await c.query("SELECT set_config('app.tenant_id', $1, true)", [h.tenantId]);
            const v = await c.query<{ first_broken_seq: string | null }>(
              'SELECT first_broken_seq::text FROM app_verify_audit_chain()',
            );
            await c.query('COMMIT');
            if ((v.rows[0]?.first_broken_seq ?? null) !== h.firstBrokenSeq) {
              throw new Error(
                `AUDIT_BROKEN: tenant ${h.tenantId} rusak di ${v.rows[0]?.first_broken_seq ?? '-'}, sumber ${h.firstBrokenSeq ?? '-'}`,
              );
            }
          }
        } finally {
          await c.end();
        }
        const brokenAtSource = manifest.database.auditHeads.filter((h) => h.firstBrokenSeq !== null).length;
        return { viaApi, heads: manifest.database.auditHeads.length, brokenAtSource };
      },
      (x) =>
        `${x.viaApi} tenant lewat API, ${x.heads} kepala rantai cocok` +
        (x.brokenAtSource ? `, ${x.brokenAtSource} rantai sudah rusak di sumber (peringatan)` : ''),
    );

    // 15. Jangkar audit (ADR-0072): jangkar sah terbaru ≤ waktu backup per tenant harus cocok dengan rantai hasil restore
    // (baris di seq jangkar ada dengan hash yang sama, kepala tidak di bawahnya, dan rantai bersambung dari jangkar).
    await step(
      'audit_anchors',
      async () => {
        const backupTime = new Date(manifest.startedAt);
        const s3 = cfg.anchorBucket ? primaryS3(cfg) : null;
        const c = await db.connect(superUrl(RESTORE_DB), 'simrs-uji-restore');
        let matched = 0;
        let without = 0;
        let rejected = 0;
        try {
          const fromCheckpoint = await c.query(
            "SELECT to_regprocedure('public.app_verify_audit_chain_from(bigint, text)') AS f",
          );
          for (const h of manifest.database.auditHeads) {
            const picked = await pickAnchor(
              s3 && cfg.anchorBucket
                ? wormAnchors(s3, cfg.anchorBucket, h.tenantId)
                : await tableAnchors(c, h.tenantId),
              backupTime,
              cfg.anchorKey,
            );
            rejected += picked.rejected;
            const a = picked.anchor;
            if (!a) {
              without += 1;
              continue;
            }
            if (BigInt(h.seq) < BigInt(a.seq)) {
              throw new Error(`TRUNCATION_DETECTED: tenant ${h.tenantId} kepala ${h.seq} < jangkar ${a.seq}`);
            }
            const row = await c.query<{ hash: string }>(
              'SELECT hash FROM public.audit_events WHERE tenant_id = $1 AND seq = $2',
              [h.tenantId, a.seq],
            );
            if (!row.rows[0])
              throw new Error(`TRUNCATION_DETECTED: tenant ${h.tenantId} seq jangkar ${a.seq} hilang`);
            if (row.rows[0].hash !== a.hash) {
              throw new Error(`ANCHOR_MISMATCH: tenant ${h.tenantId} seq ${a.seq} berbeda dari jangkar`);
            }
            if (fromCheckpoint.rows[0]?.f && h.firstBrokenSeq === null) {
              await c.query('BEGIN');
              await c.query("SELECT set_config('app.tenant_id', $1, true)", [h.tenantId]);
              const v = await c.query<{ b: string | null }>(
                'SELECT first_broken_seq::text AS b FROM app_verify_audit_chain_from($1::bigint, $2)',
                [a.seq, a.hash],
              );
              await c.query('COMMIT');
              if (v.rows[0]?.b)
                throw new Error(`CHAIN_BROKEN: tenant ${h.tenantId} sesudah jangkar, di seq ${v.rows[0].b}`);
            }
            matched += 1;
          }
        } finally {
          await c.end();
        }
        return { matched, without, rejected, source: cfg.anchorBucket ? 'WORM' : 'tabel audit_anchors' };
      },
      (x) =>
        `${x.matched} tenant cocok dengan jangkar (${x.source}${cfg.anchorKey ? '' : ', tanpa kunci: HMAC tidak diperiksa'})` +
        (x.without ? `, ${x.without} tanpa jangkar ≤ waktu backup` : '') +
        (x.rejected ? `, ${x.rejected} jangkar ditolak (palsu/kunci lain)` : ''),
    );
    rtoSeconds = Math.round((Date.now() - t0) / 1000);
  } catch (err) {
    failedStep = err instanceof StepFailure ? err.step : 'internal';
    error = `${failedStep}: ${shortError(err)}`.slice(0, 500);
    rtoSeconds = Math.round((Date.now() - t0) / 1000);
    if (apiLog && failedStep === 'api_ready') log(`log API (ekor):\n${apiLog}`);
  } finally {
    const runningApi = api as ChildProcess | null;
    if (runningApi && runningApi.exitCode === null) {
      runningApi.kill('SIGTERM');
      await sleep(500);
      if (runningApi.exitCode === null) runningApi.kill('SIGKILL');
    }
    if (!opts.keepContainers) {
      for (const name of containers) await run('docker', ['rm', '-f', '-v', name]).catch(() => undefined);
    }
    await rm(work, { recursive: true, force: true });
  }

  const finishedAt = new Date();
  const status = error ? 'failed' : 'success';
  let recorded = false;
  if (opts.record && cfg.databaseUrl) {
    try {
      await db.recordRestoreTest(cfg.databaseUrl, {
        id,
        backupKey: backupKey && parseBackupKey(backupKey) ? backupKey : null,
        source: opts.source,
        status,
        startedAt,
        finishedAt,
        rtoSeconds,
        checks,
        error,
      });
      recorded = true;
    } catch (err) {
      log(`catat restore_tests gagal: ${shortError(err)}`);
    }
  }
  await mkdir(reportDir, { recursive: true, mode: 0o700 });
  const reportFile = join(reportDir, `${id}.json`);
  const report: RestoreReport = {
    id,
    backupKey,
    source: opts.source,
    status,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    rtoSeconds,
    checks,
    error,
    failedStep,
    recorded,
    reportFile,
    containers,
  };
  await writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  return report;
}
