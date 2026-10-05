/**
 * Uji pemulihan sungguhan (ADR-0071, DoD fase 10 "restore berhasil di mesin bersih"):
 * database tes → pg_dump peran simrs_backup → enkripsi kunci publik → disk lokal + bucket utama + offsite (mc mirror)
 * → kontainer Postgres bersih dari offsite → pg_restore → prisma migrate status → jumlah baris → API /ready →
 * /audit/verify per tenant → restore_tests. Ditambah mode gagal: kunci salah, manifest rusak, berkas rusak.
 *
 * Butuh: Docker, `docker compose up` (Postgres + MinIO), peran simrs_backup (init.sql), dan `pnpm build` (API).
 * Jalankan: `pnpm --filter @simrs/backup test:pemulihan`. Hanya memakai database tes (simrs_test*), awalan objek
 * `uji-e2e-<acak>/` (dihapus di akhir), dan kontainer berawalan BACKUP_E2E_CONTAINER_PREFIX (dihapus otomatis).
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertTestDatabase, prepareTestDatabase, SEED_TENANTS, testDbUrls } from '@simrs/db/testing';
import { newId } from '@simrs/shared';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runBackup } from '../../src/backup';
import { type BackupConfig, findRepoRoot, loadConfig } from '../../src/config';
import { generateBackupKeyPair } from '../../src/crypto';
import { DB_FILE, MANIFEST_FILE } from '../../src/manifest';
import { Mc } from '../../src/mc';
import { runRestoreTest } from '../../src/restore';
import { dockerAvailable, run } from '../../src/tools';

const repoRoot = findRepoRoot();
try {
  process.loadEnvFile(join(repoRoot, '.env'));
} catch {
  // .env opsional (CI menyetel env langsung)
}

const RUN = randomBytes(3).toString('hex');
const PREFIX = `uji-e2e-${RUN}/`;
const CONTAINER_PREFIX = process.env.BACKUP_E2E_CONTAINER_PREFIX ?? 'simrs-uji-e2e';
const OFFSITE_BUCKET = process.env.BACKUP_E2E_OFFSITE_BUCKET ?? 'simrs-backups-offsite-uji';
const [A] = SEED_TENANTS;

let tmp: string;
let cfg: BackupConfig;
let mc: Mc;
let backupKey: string;

function backupUrl(): string {
  if (process.env.TEST_BACKUP_DATABASE_URL) return process.env.TEST_BACKUP_DATABASE_URL;
  const u = new URL(testDbUrls().migrator);
  u.username = 'simrs_backup';
  u.password = 'backup_local';
  return u.toString();
}

function config(over: Record<string, string> = {}): BackupConfig {
  return loadConfig(
    {
      ...process.env,
      BACKUP_DATABASE_URL: backupUrl(),
      BACKUP_LOCAL_DIR: join(tmp, 'lokal'),
      BACKUP_RESTORE_WORK_DIR: join(tmp, 'restore'),
      BACKUP_PREFIX: PREFIX,
      BACKUP_OFFSITE_BUCKET: OFFSITE_BUCKET,
      BACKUP_ENSURE_BUCKETS: 'true',
      BACKUP_RESTORE_CONTAINER_PREFIX: CONTAINER_PREFIX,
      STORAGE_DRIVER: 'disk',
      STORAGE_DISK_ROOT: join(tmp, 'storage'),
      BACKUP_PUBLIC_KEY_FILE: join(tmp, 'kunci', 'simrs-backup.pub'),
      BACKUP_PRIVATE_KEY_FILE: join(tmp, 'kunci', 'simrs-backup.key'),
      ...over,
    },
    repoRoot,
  );
}

async function containersLeft(): Promise<string[]> {
  const r = await run('docker', [
    'ps',
    '-a',
    '--filter',
    `name=^${CONTAINER_PREFIX}-`,
    '--format',
    '{{.Names}}',
  ]);
  return r.stdout.split('\n').filter(Boolean);
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

beforeAll(async () => {
  if (!(await dockerAvailable())) throw new Error('Docker tidak berjalan: uji pemulihan butuh Docker');
  assertTestDatabase(testDbUrls().migrator);
  await prepareTestDatabase();
  tmp = await mkdtemp(join(tmpdir(), 'simrs-backup-e2e-'));

  // Kunci uji dibuat saat tes (tidak pernah di repo).
  const pair = generateBackupKeyPair();
  await mkdir(join(tmp, 'kunci'), { mode: 0o700 });
  await writeFile(join(tmp, 'kunci', 'simrs-backup.pub'), pair.publicKey);
  await writeFile(join(tmp, 'kunci', 'simrs-backup.key'), pair.privateKeyPem, { mode: 0o600 });
  const other = generateBackupKeyPair();
  await writeFile(join(tmp, 'kunci', 'lain.key'), other.privateKeyPem, { mode: 0o600 });

  // Data: dua berkas dokumen (kunci penyimpanan valid) + dua entri audit agar kepala rantai berubah.
  for (const size of [1500, 70_000]) {
    const dir = join(tmp, 'storage', A.id, '2026', '10');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, randomUUID()), randomBytes(size));
  }
  const app = new pg.Client({ connectionString: testDbUrls().app });
  await app.connect();
  try {
    await app.query('BEGIN');
    await app.query("SELECT set_config('app.tenant_id', $1, true)", [A.id]);
    for (const action of ['read', 'export']) {
      await app.query(
        "INSERT INTO audit_events (id, tenant_id, resource_type, action, details) VALUES ($1, $2, 'backup_e2e', $3, $4)",
        [newId(), A.id, action, JSON.stringify({ run: RUN })],
      );
    }
    await app.query('COMMIT');
  } finally {
    await app.end();
  }

  cfg = config();
  mc = new Mc('docker', [cfg.primary, cfg.offsite], cfg.mcImage);
});

afterAll(async () => {
  if (cfg) {
    await mc.removePrefix(cfg.primary, PREFIX).catch(() => undefined);
    await mc.removePrefix(cfg.offsite, PREFIX).catch(() => undefined);
  }
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

describe('backup terenkripsi tiga lokasi + uji restore (ADR-0071)', () => {
  it('backup manual: dump + dokumen terenkripsi di disk lokal, bucket utama, dan offsite', async () => {
    const result = await runBackup(cfg, { kind: 'manual' });
    expect(result.errors).toEqual([]);
    expect(result).toMatchObject({
      status: 'success',
      locationsOk: ['local', 'cloud', 'offsite'],
      recorded: true,
    });
    backupKey = result.backupKey;
    for (const f of [DB_FILE, 'documents.tar.enc', MANIFEST_FILE]) {
      expect(await exists(join(cfg.localDir, backupKey, f)), f).toBe(true);
    }
    // Isi terenkripsi: tidak ada penanda format custom pg_dump ("PGDMP") di berkas.
    const enc = await readFile(join(cfg.localDir, backupKey, DB_FILE));
    expect(enc.subarray(0, 8).toString()).toBe('SIMRSBK1');
    expect(enc.includes(Buffer.from('PGDMP'))).toBe(false);
    expect(await mc.listRuns(cfg.primary, PREFIX)).toContainEqual({ key: backupKey, complete: true });
    expect(await mc.listRuns(cfg.offsite, PREFIX)).toContainEqual({ key: backupKey, complete: true });
  });

  it('restore dari offsite di kontainer bersih: migrasi, jumlah baris, dokumen, API /ready, rantai audit', async () => {
    const report = await runRestoreTest(cfg, {
      source: 'offsite',
      backupKey,
      record: true,
      strictDocuments: false,
    });
    expect(report.error).toBeNull();
    expect(report.status).toBe('success');
    const failed = Object.entries(report.checks).filter(([, c]) => !c.ok);
    expect(failed).toEqual([]);
    expect(Object.keys(report.checks)).toEqual([
      'select',
      'fetch',
      'manifest',
      'checksum',
      'key',
      'decrypt',
      'documents',
      'container',
      'restore',
      'migrations',
      'row_counts',
      'documents_db',
      'api_ready',
      'audit_verify',
    ]);
    expect(report.checks.documents?.detail).toBe('2 berkas, 71500 B');
    expect(report.checks.api_ready?.detail).toBe('database ok, redis ok, storage ok');
    expect(report.rtoSeconds).toBeGreaterThan(0);
    expect(report.recorded).toBe(true);
    // Kontainer dan folder kerja (plaintext) dibersihkan; laporan disimpan.
    expect(await containersLeft()).toEqual([]);
    expect(await exists(join(cfg.restoreWorkDir, report.id))).toBe(false);
    expect(JSON.parse(await readFile(report.reportFile, 'utf8'))).toMatchObject({
      id: report.id,
      status: 'success',
    });

    const owner = new pg.Client({ connectionString: testDbUrls().migrator });
    await owner.connect();
    try {
      await owner.query('BEGIN');
      const platform = await owner.query<{ id: string }>(
        "SELECT id::text FROM tenants WHERE kind = 'platform'",
      );
      await owner.query("SELECT set_config('app.tenant_id', $1, true)", [platform.rows[0]?.id]);
      const r = await owner.query<{ status: string; rto_seconds: number; backup_key: string }>(
        'SELECT status, rto_seconds, backup_key FROM restore_tests WHERE id = $1',
        [report.id],
      );
      await owner.query('COMMIT');
      expect(r.rows).toEqual([{ status: 'success', rto_seconds: report.rtoSeconds, backup_key: backupKey }]);
    } finally {
      await owner.end();
    }
  });

  it('kunci privat salah: gagal di langkah kunci, tanpa dekripsi, kontainer, atau berkas tersisa', async () => {
    const report = await runRestoreTest(config({ BACKUP_PRIVATE_KEY_FILE: join(tmp, 'kunci', 'lain.key') }), {
      source: 'local',
      backupKey,
      record: false,
    });
    expect(report.status).toBe('failed');
    expect(report.failedStep).toBe('key');
    expect(report.error).toMatch(/KEY_MISMATCH/);
    expect(report.checks.decrypt).toBeUndefined();
    expect(report.containers).toEqual([]);
    expect(await exists(join(cfg.restoreWorkDir, report.id))).toBe(false);
    // Backup asli tidak tersentuh.
    expect(await exists(join(cfg.localDir, backupKey, MANIFEST_FILE))).toBe(true);
  });

  it('manifest rusak (JSON valid tapi nilai diubah, atau terpotong): gagal keras sebelum apa pun dibuat', async () => {
    for (const [name, mutate, code] of [
      [
        'diubah',
        (t: string) => t.replace(/"public\.patients": \d+/, '"public.patients": 999999'),
        /MANIFEST_DIGEST_MISMATCH/,
      ],
      ['terpotong', (t: string) => t.slice(0, Math.floor(t.length / 2)), /MANIFEST_INVALID/],
    ] as const) {
      const dir = join(tmp, `lokal-${name}`);
      await cp(join(cfg.localDir, backupKey), join(dir, backupKey), { recursive: true });
      const path = join(dir, backupKey, MANIFEST_FILE);
      await writeFile(path, mutate(await readFile(path, 'utf8')));
      const report = await runRestoreTest(config({ BACKUP_LOCAL_DIR: dir }), {
        source: 'local',
        record: false,
      });
      expect(report.failedStep, name).toBe('manifest');
      expect(report.error, name).toMatch(code);
      expect(report.containers, name).toEqual([]);
    }
  });

  it('berkas backup rusak: gagal di checksum sebelum dekripsi', async () => {
    const dir = join(tmp, 'lokal-berkas-rusak');
    await cp(join(cfg.localDir, backupKey), join(dir, backupKey), { recursive: true });
    const path = join(dir, backupKey, DB_FILE);
    const buf = await readFile(path);
    buf[buf.length - 100] = (buf[buf.length - 100] ?? 0) ^ 0xff;
    await writeFile(path, buf);
    const report = await runRestoreTest(config({ BACKUP_LOCAL_DIR: dir }), {
      source: 'local',
      record: false,
    });
    expect(report.failedStep).toBe('checksum');
    expect(report.error).toMatch(/CHECKSUM_MISMATCH/);
    expect(report.containers).toEqual([]);
  });
});
