/**
 * Uji pemulihan sungguhan (ADR-0071, DoD fase 10 "restore berhasil di mesin bersih"):
 * database tes → pg_dump peran simrs_backup → enkripsi kunci publik → disk lokal + bucket utama + offsite (mc mirror)
 * → kontainer Postgres bersih → pg_restore → prisma migrate status → jumlah baris → dokumen → API /ready →
 * /audit/verify per tenant → jangkar audit → restore_tests. Mode gagal: kunci salah, manifest rusak, berkas rusak,
 * jangkar WORM tidak cocok. Dua driver dokumen: disk (folder) dan s3 (bucket uji, dipulihkan ke MinIO sementara);
 * jangkar dari tabel `audit_anchors` dan dari bucket WORM uji.
 *
 * Butuh: Docker, `docker compose up` (Postgres + MinIO), peran simrs_backup (init.sql), dan `pnpm build` (API).
 * Jalankan: `pnpm --filter @simrs/backup test:pemulihan`. Hanya memakai database tes (simrs_test*), awalan objek
 * `uji-e2e-<acak>/` dan bucket `simrs-*-uji-<acak>` (dihapus di akhir), dan kontainer berawalan
 * BACKUP_E2E_CONTAINER_PREFIX (dihapus otomatis).
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPrismaClient, insertPatient, withTenant } from '@simrs/db';
import { assertTestDatabase, prepareTestDatabase, SEED_TENANTS, testDbUrls } from '@simrs/db/testing';
import { newId } from '@simrs/shared';
import {
  type AuditAnchorDocument,
  auditAnchorObjectKey,
  createAuditAnchorDocument,
  PatientCrypto,
} from '@simrs/shared/node';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runBackup } from '../../src/backup';
import { type BackupConfig, findRepoRoot, loadConfig, primaryS3 } from '../../src/config';
import { generateBackupKeyPair } from '../../src/crypto';
import { DB_FILE, MANIFEST_FILE, parseManifest } from '../../src/manifest';
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
/** Kunci jangkar audit uji (ADR-0072); jangkar tenant lain di DB tes (kunci lain) ditolak, bukan dipercaya. */
const ANCHOR_KEY = randomBytes(32).toString('base64');
const DOC_BUCKET = `simrs-dok-uji-${RUN}`;
const ANCHOR_BUCKET = `simrs-jangkar-uji-${RUN}`;
const BAD_ANCHOR_BUCKET = `simrs-jangkar-palsu-${RUN}`;

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
      AUDIT_ANCHOR_KEY: ANCHOR_KEY,
      AUDIT_ANCHOR_BUCKET: '',
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

/** Kepala rantai audit tenant A (klien sudah di transaksi berkonteks A). */
async function auditHead(c: pg.Client): Promise<{ seq: string; hash: string }> {
  const r = await c.query<{ seq: string; hash: string }>(
    'SELECT e.seq::text AS seq, e.hash FROM audit_events e WHERE e.tenant_id = $1 ORDER BY e.seq DESC LIMIT 1',
    [A.id],
  );
  const row = r.rows[0];
  if (!row) throw new Error('rantai audit A kosong');
  return row;
}

async function inTenantA<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: testDbUrls().app });
  await c.connect();
  try {
    await c.query('BEGIN');
    await c.query("SELECT set_config('app.tenant_id', $1, true)", [A.id]);
    const v = await fn(c);
    await c.query('COMMIT');
    return v;
  } finally {
    await c.end();
  }
}

const signAnchor = (seq: string, hash: string, at: Date): AuditAnchorDocument =>
  createAuditAnchorDocument({ tenantId: A.id, seq, hash, anchoredAt: at.toISOString() }, ANCHOR_KEY);

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

  // Data: dua berkas dokumen (kunci penyimpanan valid) + dua entri audit + jangkar bertanda tangan di tabel untuk
  // kepala rantai A (sumber jangkar bila tanpa bucket WORM).
  for (const size of [1500, 70_000]) {
    const dir = join(tmp, 'storage', A.id, '2026', '10');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, randomUUID()), randomBytes(size));
  }
  await inTenantA(async (c) => {
    for (const action of ['read', 'export']) {
      await c.query(
        "INSERT INTO audit_events (id, tenant_id, resource_type, action, details) VALUES ($1, $2, 'backup_e2e', $3, $4)",
        [newId(), A.id, action, JSON.stringify({ run: RUN })],
      );
    }
    const head = await auditHead(c);
    const doc = signAnchor(head.seq, head.hash, new Date(Date.now() - 60_000));
    await c.query(
      "INSERT INTO audit_anchors (id, tenant_id, seq, hash, anchored_at, key_id, hmac, source) VALUES ($1, $2, $3, $4, $5, $6, $7, 'job')",
      [newId(), A.id, doc.seq, doc.hash, doc.anchoredAt, doc.keyId, doc.hmac],
    );
  });

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
    // Kepala rantai = seq TERBESAR secara numerik (regresi: urutan teks membuat "9" > "52").
    const m = parseManifest(await readFile(join(cfg.localDir, backupKey, MANIFEST_FILE), 'utf8'), backupKey);
    const head = await inTenantA(auditHead);
    expect(m.database.auditHeads.find((h) => h.tenantId === A.id)).toMatchObject(head);
    expect(await mc.listRuns(cfg.primary, PREFIX)).toContainEqual({ key: backupKey, complete: true });
    expect(await mc.listRuns(cfg.offsite, PREFIX)).toContainEqual({ key: backupKey, complete: true });
  });

  it('restore dari offsite di kontainer bersih: migrasi, jumlah baris, dokumen, API /ready, rantai + jangkar audit', async () => {
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
      'audit_anchors',
    ]);
    expect(report.checks.documents?.detail).toBe('2 berkas, 71500 B');
    expect(report.checks.api_ready?.detail).toBe('database ok, redis ok, storage ok');
    expect(report.checks.audit_anchors?.detail).toMatch(
      /^1 tenant cocok dengan jangkar \(tabel audit_anchors\)/,
    );
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

describe('driver dokumen s3 + jangkar audit WORM (ADR-0071 × ADR-0020 × ADR-0072)', () => {
  let s3cfg: BackupConfig;
  let s3Key: string;
  let missingKey: string;
  const overrides = (): Record<string, string> => ({
    STORAGE_DRIVER: 's3',
    S3_BUCKET_DOCUMENTS: DOC_BUCKET,
    AUDIT_ANCHOR_BUCKET: ANCHOR_BUCKET,
    BACKUP_LOCAL_DIR: join(tmp, 'lokal-s3'),
  });

  beforeAll(async () => {
    const s3 = primaryS3(cfg);
    for (const bucket of [DOC_BUCKET, ANCHOR_BUCKET, BAD_ANCHOR_BUCKET])
      await s3.send({ method: 'PUT', bucket });

    // Pasien + tiga baris dokumen di tenant A: dua objeknya ada di bucket (checksum diverifikasi server), satu hilang.
    const app = createPrismaClient({ connectionString: testDbUrls().app, max: 1 });
    try {
      const crypto = new PatientCrypto(
        {
          encKeyB64: Buffer.alloc(32, 7).toString('base64'),
          hashKeyB64: Buffer.alloc(32, 9).toString('base64'),
        },
        A.id,
      );
      const patient = await withTenant(app, A.id, (tx) =>
        insertPatient(tx, crypto, { name: 'Pasien Uji Backup', sex: 'female', birthDate: '1980-01-01' }),
      );
      for (const size of [900, 40_000, 77]) {
        const key = `${A.id}/2026/10/${newId()}`;
        const body = randomBytes(size);
        const hex = createHash('sha256').update(body).digest('hex');
        if (size === 77) {
          missingKey = key;
        } else {
          await s3.send({
            method: 'PUT',
            bucket: DOC_BUCKET,
            key,
            body,
            payloadHash: hex,
            headers: { 'x-amz-checksum-sha256': Buffer.from(hex, 'hex').toString('base64') },
          });
        }
        await withTenant(app, A.id, (tx) =>
          tx.document.create({
            data: {
              id: newId(),
              tenantId: A.id,
              patientId: patient.id,
              kind: 'lampiran',
              title: 'Lampiran uji backup',
              fileName: 'uji.pdf',
              mimeType: 'application/pdf',
              sizeBytes: size,
              sha256: hex,
              storageKey: key,
            },
          }),
        );
      }
    } finally {
      await app.$disconnect();
    }

    // Jangkar WORM untuk kepala rantai A: sah (dipakai), sesudah backup (diabaikan), palsu (ditolak). Bucket palsu:
    // jangkar BERTANDA TANGAN SAH di seq kepala tetapi hash lain (seolah rantai ditulis ulang setelah dijangkar).
    const head = await inTenantA(auditHead);
    const put = (bucket: string, d: AuditAnchorDocument) =>
      s3.send({
        method: 'PUT',
        bucket,
        key: auditAnchorObjectKey(A.id, d.seq),
        body: Buffer.from(JSON.stringify(d)),
      });
    await put(ANCHOR_BUCKET, signAnchor(head.seq, head.hash, new Date(Date.now() - 30_000)));
    await put(
      ANCHOR_BUCKET,
      signAnchor(String(BigInt(head.seq) + 1000n), 'a'.repeat(64), new Date(Date.now() + 3_600_000)),
    );
    await put(ANCHOR_BUCKET, {
      ...signAnchor(String(BigInt(head.seq) + 500n), 'b'.repeat(64), new Date(Date.now() - 10_000)),
      hmac: 'c'.repeat(64),
    });
    await put(BAD_ANCHOR_BUCKET, signAnchor(head.seq, 'd'.repeat(64), new Date(Date.now() - 30_000)));

    s3cfg = config(overrides());
  });

  afterAll(async () => {
    for (const bucket of [DOC_BUCKET, ANCHOR_BUCKET, BAD_ANCHOR_BUCKET]) {
      await mc.removeBucket({ ...cfg.primary, bucket }).catch(() => undefined);
    }
  });

  it('backup s3: objek per baris dokumen di-stream ke arsip terenkripsi, objek hilang tercatat', async () => {
    const result = await runBackup(s3cfg, { kind: 'manual' });
    expect(result.errors).toEqual([]);
    expect(result.status).toBe('success');
    s3Key = result.backupKey;
    const m = parseManifest(await readFile(join(s3cfg.localDir, s3Key, MANIFEST_FILE), 'utf8'), s3Key);
    expect(m.documents.source).toBe('s3');
    expect(m.documents.fileCount).toBeGreaterThanOrEqual(2);
    expect(m.documents.integrityErrors).toContainEqual({ key: missingKey, reason: 'missing' });
  });

  it('restore dari cloud: objek ke bucket MinIO sementara dengan hash cocok, jangkar WORM cocok', async () => {
    const report = await runRestoreTest(s3cfg, { source: 'cloud', backupKey: s3Key, record: false });
    expect(report.error).toBeNull();
    expect(Object.keys(report.checks)).toContain('documents_bucket');
    expect(report.checks.container?.detail).toMatch(/minio 127\.0\.0\.1:\d+/);
    expect(report.checks.documents_db?.detail).toMatch(/sudah bermasalah di sumber/);
    expect(report.checks.api_ready?.detail).toBe('database ok, redis ok, storage ok');
    expect(report.checks.audit_anchors?.detail).toMatch(/^1 tenant cocok dengan jangkar \(WORM\)/);
    expect(report.checks.audit_anchors?.detail).toMatch(/1 jangkar ditolak/);
    expect(await containersLeft()).toEqual([]);
  });

  it('jangkar WORM sah yang tidak cocok dengan rantai hasil restore → gagal di audit_anchors', async () => {
    const report = await runRestoreTest(config({ ...overrides(), AUDIT_ANCHOR_BUCKET: BAD_ANCHOR_BUCKET }), {
      source: 'local',
      backupKey: s3Key,
      record: false,
    });
    expect(report.failedStep).toBe('audit_anchors');
    expect(report.error).toMatch(/ANCHOR_MISMATCH/);
    expect(await containersLeft()).toEqual([]);
  });
});
