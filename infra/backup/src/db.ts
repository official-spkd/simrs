/**
 * Akses database untuk backup: hanya lewat peran ops `simrs_backup` (pg_read_all_data + BYPASSRLS, baca-saja bawaan).
 * Statistik manifest dibaca di snapshot yang diekspor lalu dipakai pg_dump (`--snapshot`), jadi jumlah baris dan
 * kepala rantai audit persis sama dengan isi dump walau aplikasi sedang menulis.
 */
import pg from 'pg';
import { type ManifestBody } from './manifest';

export type Client = pg.Client;

export function connect(url: string, applicationName: string): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: url, application_name: applicationName });
  return client.connect().then(() => client);
}

/** Kunci advisory sesi: dua backup tidak pernah berjalan bersamaan (lintas host). */
export async function tryBackupLock(client: pg.Client): Promise<boolean> {
  const r = await client.query<{ ok: boolean }>(
    "SELECT pg_try_advisory_lock(hashtextextended('simrs:backup', 0)) AS ok",
  );
  return r.rows[0]?.ok === true;
}

/** Mulai transaksi snapshot dan ekspor id-nya untuk pg_dump. Transaksi harus tetap terbuka selama dump. */
export async function exportSnapshot(client: pg.Client): Promise<string> {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const r = await client.query<{ id: string }>('SELECT pg_export_snapshot() AS id');
  const id = r.rows[0]?.id;
  if (!id) throw new Error('pg_export_snapshot tidak mengembalikan id');
  return id;
}

export type DatabaseStats = Omit<ManifestBody['database'], 'file'>;

/** Tabel biasa/partisi di skema non-sistem (public, ref, …). */
export async function listTables(client: pg.Client): Promise<string[]> {
  const r = await client.query<{ name: string }>(`
    SELECT n.nspname || '.' || c.relname AS name
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r', 'p')
      AND n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg\\_%'
    ORDER BY 1`);
  return r.rows.map((x) => x.name);
}

export async function countRows(
  client: pg.Client,
  tables: readonly string[],
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const t of tables) {
    const [schema = '', table = ''] = t.split('.');
    const r = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM ${client.escapeIdentifier(schema)}.${client.escapeIdentifier(table)}`,
    );
    counts[t] = Number(r.rows[0]?.n ?? 0);
  }
  return counts;
}

export async function appliedMigrations(client: pg.Client): Promise<string[]> {
  const exists = await client.query("SELECT to_regclass('public._prisma_migrations') AS t");
  if (!exists.rows[0]?.t) return [];
  const r = await client.query<{ name: string }>(
    'SELECT migration_name AS name FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY 1',
  );
  return r.rows.map((x) => x.name);
}

/**
 * Kepala rantai audit per tenant + hasil verifikasi rantai di snapshot (`app_verify_audit_chain()` per tenant).
 * Uji restore menuntut hasil yang SAMA di DB hasil restore: rantai utuh tetap utuh, rantai yang sudah rusak di sumber
 * rusak di seq yang sama (dilaporkan, karena restore tidak bisa memperbaikinya).
 */
export async function auditHeads(client: pg.Client): Promise<DatabaseStats['auditHeads']> {
  const exists = await client.query("SELECT to_regclass('public.audit_events') AS t");
  if (!exists.rows[0]?.t) return [];
  const r = await client.query<{ tenant_id: string; seq: string; hash: string }>(`
    SELECT DISTINCT ON (tenant_id) tenant_id::text, seq::text, hash
    FROM public.audit_events ORDER BY tenant_id, seq DESC`);
  const verify = await client.query("SELECT to_regprocedure('public.app_verify_audit_chain()') AS f");
  const heads: DatabaseStats['auditHeads'] = [];
  for (const x of r.rows) {
    let firstBrokenSeq: string | null = null;
    if (verify.rows[0]?.f) {
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [x.tenant_id]);
      const v = await client.query<{ b: string | null }>(
        'SELECT first_broken_seq::text AS b FROM public.app_verify_audit_chain()',
      );
      firstBrokenSeq = v.rows[0]?.b ?? null;
    }
    heads.push({ tenantId: x.tenant_id, seq: x.seq, hash: x.hash, firstBrokenSeq });
  }
  if (verify.rows[0]?.f) await client.query("SELECT set_config('app.tenant_id', '', true)");
  return heads;
}

export async function tenants(client: pg.Client): Promise<DatabaseStats['tenants']> {
  const exists = await client.query("SELECT to_regclass('public.tenants') AS t");
  if (!exists.rows[0]?.t) return [];
  const r = await client.query<{ id: string; code: string; kind: string; status: string }>(
    'SELECT id::text, code, kind, status FROM public.tenants ORDER BY code',
  );
  return r.rows;
}

export async function collectStats(client: pg.Client, database: string): Promise<DatabaseStats> {
  const version = await client.query<{ v: string }>("SELECT current_setting('server_version') AS v");
  const tables = await listTables(client);
  return {
    name: database,
    serverVersion: version.rows[0]?.v ?? 'unknown',
    migrations: await appliedMigrations(client),
    tables: await countRows(client, tables),
    auditHeads: await auditHeads(client),
    tenants: await tenants(client),
  };
}

export async function serverMajor(client: pg.Client): Promise<number> {
  const r = await client.query<{ v: string }>("SELECT current_setting('server_version_num') AS v");
  return Math.floor(Number(r.rows[0]?.v ?? '0') / 10_000);
}

export interface BackupRunRecord {
  id: string;
  backupKey: string;
  kind: string;
  status: 'success' | 'partial' | 'failed';
  startedAt: Date;
  finishedAt: Date;
  locationsOk: string[];
  dbBytes: number | null;
  documentsBytes: number | null;
  documentFiles: number | null;
  tableCount: number | null;
  rowTotal: number | null;
  manifestSha256: string | null;
  error: string | null;
}

/** Catat hasil run lewat fungsi SECURITY DEFINER (peran backup baca-saja → transaksi READ WRITE eksplisit). */
export async function recordBackupRun(url: string, r: BackupRunRecord): Promise<void> {
  const client = await connect(url, 'simrs-backup-record');
  try {
    await client.query('BEGIN READ WRITE');
    await client.query(
      'SELECT app_record_backup_run($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)',
      [
        r.id,
        r.backupKey,
        r.kind,
        r.status,
        r.startedAt,
        r.finishedAt,
        r.locationsOk,
        r.dbBytes,
        r.documentsBytes,
        r.documentFiles,
        r.tableCount,
        r.rowTotal,
        r.manifestSha256,
        r.error,
      ],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    await client.end();
  }
}

export interface RestoreTestRecord {
  id: string;
  backupKey: string | null;
  source: 'local' | 'cloud' | 'offsite';
  status: 'success' | 'failed';
  startedAt: Date;
  finishedAt: Date;
  rtoSeconds: number;
  checks: Record<string, unknown>;
  error: string | null;
}

export async function recordRestoreTest(url: string, r: RestoreTestRecord): Promise<void> {
  const client = await connect(url, 'simrs-backup-record');
  try {
    await client.query('BEGIN READ WRITE');
    await client.query('SELECT app_record_restore_test($1, $2, $3, $4, $5, $6, $7, $8, $9)', [
      r.id,
      r.backupKey,
      r.source,
      r.status,
      r.startedAt,
      r.finishedAt,
      r.rtoSeconds,
      JSON.stringify(r.checks),
      r.error,
    ]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    await client.end();
  }
}
