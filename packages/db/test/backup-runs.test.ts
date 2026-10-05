/**
 * Fase 10 · 10.7 (ADR-0071): catatan backup/uji restore milik tenant PLATFORM, append-only, ditulis hanya lewat fungsi
 * sempit oleh peran ops `simrs_backup`; RS hanya membaca ringkasan tanpa lokasi/kunci. Peran aplikasi tidak bisa
 * memakai peran backup.
 */
import { newId } from '@simrs/shared';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient, type PrismaClient, readBackupStatus, withTenant } from '../src/index';
import { SEED_PLATFORM_TENANT, SEED_TENANTS, testDbUrls } from '../src/testing';

const [A] = SEED_TENANTS;
const P = SEED_PLATFORM_TENANT;
let app: PrismaClient;
let owner: PrismaClient;
let hasBackupRole = false;

/** Peran backup memakai kata sandi lokal init.sql; URL bisa ditimpa TEST_BACKUP_DATABASE_URL. */
function backupUrl(): string {
  if (process.env.TEST_BACKUP_DATABASE_URL) return process.env.TEST_BACKUP_DATABASE_URL;
  const u = new URL(testDbUrls().migrator);
  u.username = 'simrs_backup';
  u.password = 'backup_local';
  return u.toString();
}

/** Kunci backup unik (format `YYYYMMDDTHHMMSSZ-jenis`) dari waktu acak, agar tes berulang tidak bentrok. */
function uniqueKey(kind: 'hourly' | 'daily' | 'manual' = 'manual'): string {
  const at = new Date(Date.UTC(2000, 0, 1) + Math.floor(Math.random() * 3e12));
  return `${at.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z-${kind}`;
}

const RECORD_SQL =
  'SELECT app_record_backup_run($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) AS id';

function recordArgs(over: Partial<Record<string, unknown>> = {}): unknown[] {
  const now = new Date();
  const v = {
    id: newId(),
    key: uniqueKey(),
    kind: 'manual',
    status: 'success',
    started: new Date(now.getTime() - 5000),
    finished: now,
    locations: ['local', 'cloud', 'offsite'],
    manifest: 'b'.repeat(64),
    error: null,
    ...over,
  };
  return [
    v.id,
    v.key,
    v.kind,
    v.status,
    v.started,
    v.finished,
    v.locations,
    1000,
    200,
    2,
    40,
    2196,
    v.manifest,
    v.error,
  ];
}

async function asBackup<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: backupUrl() });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

beforeAll(async () => {
  app = createPrismaClient({ connectionString: testDbUrls().app, max: 4 });
  owner = createPrismaClient({ connectionString: testDbUrls().migrator, max: 2 });
  const [r] = await owner.$queryRaw<Array<{ n: number }>>`
    SELECT count(*)::int AS n FROM pg_roles WHERE rolname = 'simrs_backup'`;
  hasBackupRole = r?.n === 1;
});

afterAll(async () => {
  await app.$disconnect();
  await owner.$disconnect();
});

describe('backup_runs dan restore_tests (ADR-0071)', () => {
  it('peran aplikasi tidak bisa menulis atau memanggil fungsi pencatat', async () => {
    await expect(
      withTenant(
        app,
        P.id,
        (tx) =>
          tx.$executeRaw`INSERT INTO backup_runs (id, tenant_id, backup_key, kind, status, started_at, finished_at, locations_ok, error)
          VALUES (${newId()}::uuid, ${P.id}::uuid, ${uniqueKey()}, 'manual', 'failed', now(), now(), '{}', 'palsu')`,
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      withTenant(app, P.id, (tx) => tx.$queryRawUnsafe(RECORD_SQL, ...recordArgs())),
    ).rejects.toThrow(/permission denied/);
    const [p] = await owner.$queryRaw<
      Array<{ rec: boolean; restore: boolean; status: boolean; ins: boolean }>
    >`
      SELECT has_function_privilege('simrs_app', 'app_record_backup_run(uuid, text, text, text, timestamptz, timestamptz, text[], bigint, bigint, integer, integer, bigint, text, text)', 'EXECUTE') AS rec,
             has_function_privilege('simrs_app', 'app_record_restore_test(uuid, text, text, text, timestamptz, timestamptz, integer, jsonb, text)', 'EXECUTE') AS restore,
             has_function_privilege('simrs_app', 'app_backup_status()', 'EXECUTE') AS status,
             has_table_privilege('simrs_app', 'public.restore_tests', 'INSERT') AS ins`;
    expect(p).toEqual({ rec: false, restore: false, status: true, ins: false });
  });

  it('ringkasan untuk RS hanya waktu + status (tanpa lokasi, kunci, ukuran, galat) dan konteks tenant pulih', async () => {
    const cols = await owner.$queryRaw<Array<{ name: string }>>`
      SELECT a.attname AS name FROM pg_proc p
      JOIN LATERAL unnest(p.proargnames, p.proargmodes) AS a(attname, mode) ON a.mode = 't'
      WHERE p.proname = 'app_backup_status' ORDER BY 1`;
    expect(cols.map((c) => c.name)).toEqual([
      'cloud_ok_at',
      'failed_last_24h',
      'last_restore_rto_seconds',
      'last_restore_test_at',
      'last_restore_test_status',
      'last_run_at',
      'last_run_status',
      'last_success_at',
      'local_ok_at',
      'offsite_ok_at',
    ]);
    const after = await withTenant(app, A.id, async (tx) => {
      await readBackupStatus(tx);
      const [r] = await tx.$queryRaw<Array<{ t: string }>>`SELECT current_setting('app.tenant_id') AS t`;
      return r?.t;
    });
    expect(after).toBe(A.id);
  });

  it('append-only: pemilik tabel pun tidak bisa mengubah atau menghapus', async () => {
    const id = newId();
    await withTenant(
      owner,
      P.id,
      (tx) =>
        tx.$executeRaw`INSERT INTO backup_runs (id, tenant_id, backup_key, kind, status, started_at, finished_at, locations_ok, error)
        VALUES (${id}::uuid, ${P.id}::uuid, ${uniqueKey()}, 'manual', 'failed', now(), now(), '{}', 'uji append-only')`,
    );
    await expect(
      withTenant(
        owner,
        P.id,
        (tx) => tx.$executeRaw`UPDATE backup_runs SET status = 'success' WHERE id = ${id}::uuid`,
      ),
    ).rejects.toThrow(/APPEND_ONLY/);
    await expect(
      withTenant(owner, P.id, (tx) => tx.$executeRaw`DELETE FROM backup_runs WHERE id = ${id}::uuid`),
    ).rejects.toThrow(/APPEND_ONLY/);
  });

  it('status harus konsisten: berhasil = manifest + tiga lokasi; gagal wajib menyebut galat', async () => {
    const insert = (status: string, locations: string, manifest: string | null, error: string | null) =>
      withTenant(
        owner,
        P.id,
        (tx) =>
          tx.$executeRaw`INSERT INTO backup_runs (id, tenant_id, backup_key, kind, status, started_at, finished_at, locations_ok, manifest_sha256, error)
          VALUES (${newId()}::uuid, ${P.id}::uuid, ${uniqueKey()}, 'manual', ${status}, now(), now(), ${locations}::text[], ${manifest}, ${error})`,
      );
    const sha = 'c'.repeat(64);
    await expect(insert('success', '{local,cloud}', sha, null)).rejects.toThrow(
      /backup_runs_status_consistent/,
    );
    await expect(insert('failed', '{}', null, null)).rejects.toThrow(/backup_runs_status_consistent/);
    await expect(insert('partial', '{cloud}', sha, 'x')).rejects.toThrow(/backup_runs_status_consistent/);
    await expect(insert('success', '{local,cloud,offsite,mars}', sha, null)).rejects.toThrow(
      /backup_runs_locations_valid/,
    );
    await expect(
      withTenant(
        owner,
        P.id,
        (tx) =>
          tx.$executeRaw`INSERT INTO backup_runs (id, tenant_id, backup_key, kind, status, started_at, finished_at, locations_ok, error)
          VALUES (${newId()}::uuid, ${P.id}::uuid, '20261005T000000Z-daily', 'hourly', 'failed', now(), now(), '{}', 'x')`,
      ),
    ).rejects.toThrow(/backup_runs_key_format/);
  });
});

describe('peran ops simrs_backup', () => {
  it('baca semua data + BYPASSRLS, bukan superuser, tanpa hak tulis tabel; aplikasi tidak bisa memakainya', async (ctx) => {
    if (!hasBackupRole) ctx.skip();
    const [r] = await owner.$queryRaw<
      Array<{
        bypass: boolean;
        superuser: boolean;
        createrole: boolean;
        createdb: boolean;
        readall: boolean;
        writeall: boolean;
        insert: boolean;
        record: boolean;
        appmember: boolean;
        appreadall: boolean;
      }>
    >`
      SELECT r.rolbypassrls AS bypass, r.rolsuper AS superuser, r.rolcreaterole AS createrole, r.rolcreatedb AS createdb,
             pg_has_role('simrs_backup', 'pg_read_all_data', 'USAGE') AS readall,
             pg_has_role('simrs_backup', 'pg_write_all_data', 'USAGE') AS writeall,
             has_table_privilege('simrs_backup', 'public.patients', 'INSERT') AS insert,
             has_function_privilege('simrs_backup', 'app_record_backup_run(uuid, text, text, text, timestamptz, timestamptz, text[], bigint, bigint, integer, integer, bigint, text, text)', 'EXECUTE') AS record,
             pg_has_role('simrs_app', 'simrs_backup', 'MEMBER') AS appmember,
             pg_has_role('simrs_app', 'pg_read_all_data', 'MEMBER') AS appreadall
      FROM pg_roles r WHERE r.rolname = 'simrs_backup'`;
    expect(r).toEqual({
      bypass: true,
      superuser: false,
      createrole: false,
      createdb: false,
      readall: true,
      writeall: false,
      insert: false,
      record: true,
      appmember: false,
      appreadall: false,
    });
    await expect(app.$executeRawUnsafe('SET ROLE simrs_backup')).rejects.toThrow(/permission denied/);
  });

  it('mencatat run lewat fungsi (transaksi READ WRITE eksplisit); RS hanya melihat ringkasannya', async (ctx) => {
    if (!hasBackupRole) ctx.skip();
    const args = recordArgs();
    await asBackup(async (c) => {
      // Bawaan peran: baca-saja. INSERT langsung ditolak, fungsi tanpa READ WRITE juga.
      await expect(c.query(RECORD_SQL, recordArgs())).rejects.toThrow(/read-only/);
      await c.query('BEGIN READ WRITE');
      await expect(c.query(`INSERT INTO backup_runs (id) VALUES ('${newId()}')`)).rejects.toThrow(
        /permission denied/,
      );
      await c.query('ROLLBACK');
      await c.query('BEGIN READ WRITE');
      await c.query(RECORD_SQL, args);
      await c.query('COMMIT');
      // BYPASSRLS: peran backup membaca semua baris tanpa konteks tenant (untuk pg_dump).
      const n = await c.query('SELECT count(*)::int AS n FROM patients');
      expect(typeof n.rows[0]?.n).toBe('number');
    });
    const platform = await withTenant(
      app,
      P.id,
      (tx) =>
        tx.$queryRaw<Array<{ tenant_id: string; status: string }>>`
        SELECT tenant_id::text, status FROM backup_runs WHERE id = ${args[0] as string}::uuid`,
    );
    expect(platform).toEqual([{ tenant_id: P.id, status: 'success' }]);
    const hospital = await withTenant(
      app,
      A.id,
      (tx) => tx.$queryRaw<Array<{ n: number }>>`SELECT count(*)::int AS n FROM backup_runs`,
    );
    expect(hospital[0]?.n).toBe(0);
    const status = await withTenant(app, A.id, (tx) => readBackupStatus(tx));
    expect(status.lastSuccessAt).not.toBeNull();
    expect(status.offsiteOkAt).not.toBeNull();
    // Nilai ringkasan hanya waktu ISO, status, dan angka: tidak ada bucket, path, hash manifest, atau teks galat.
    const leaked = Object.values(status).filter(
      (v) =>
        typeof v === 'string' &&
        !/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(v) &&
        !['success', 'partial', 'failed'].includes(v),
    );
    expect(leaked).toEqual([]);
  });

  it('uji restore tercatat dengan RTO; gagal tanpa kunci backup tetap bisa dicatat', async (ctx) => {
    if (!hasBackupRole) ctx.skip();
    const ok = newId();
    const failed = newId();
    await asBackup(async (c) => {
      await c.query('BEGIN READ WRITE');
      const sql = 'SELECT app_record_restore_test($1, $2, $3, $4, $5, $6, $7, $8, $9)';
      await c.query(sql, [
        ok,
        uniqueKey('daily'),
        'offsite',
        'success',
        new Date(Date.now() - 60_000),
        new Date(),
        60,
        '{"restore":{"ok":true,"ms":900}}',
        null,
      ]);
      await c.query(sql, [
        failed,
        null,
        'cloud',
        'failed',
        new Date(),
        new Date(),
        2,
        '{"select":{"ok":false,"ms":5}}',
        'select: tidak ada backup lengkap',
      ]);
      await c.query('COMMIT');
    });
    const rows = await withTenant(
      owner,
      P.id,
      (tx) =>
        tx.$queryRaw<Array<{ id: string; rto_seconds: number; backup_key: string | null }>>`
        SELECT id::text, rto_seconds, backup_key FROM restore_tests WHERE id IN (${ok}::uuid, ${failed}::uuid) ORDER BY rto_seconds DESC`,
    );
    expect(rows.map((r) => [r.id, r.rto_seconds, r.backup_key === null])).toEqual([
      [ok, 60, false],
      [failed, 2, true],
    ]);
  });
});
