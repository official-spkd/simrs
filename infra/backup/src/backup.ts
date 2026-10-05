/**
 * Satu run backup (ADR-0071):
 * 1. kunci advisory + snapshot ekspor (peran simrs_backup) → statistik manifest dari snapshot itu;
 * 2. `pg_dump -Fc --snapshot` → enkripsi kunci publik → `db.dump.enc` (lokasi 1, disk lokal);
 * 3. arsip dokumen (ustar) → enkripsi → `documents.tar.enc`;
 * 4. `manifest.json` ditulis terakhir;
 * 5. unggah ke bucket cloud (lokasi 2), lalu `mc mirror` awalan ke offsite (lokasi 3);
 * 6. retensi di ketiga lokasi; 7. catat lewat `app_record_backup_run()`.
 * Plaintext tidak pernah menyentuh disk: dump/arsip langsung dialirkan ke enkripsi.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { newId } from '@simrs/shared';
import { type BackupConfig, databaseName, requireRecipient } from './config';
import { createEncryptStream, ENCRYPTION_SCHEME, type RecipientKey } from './crypto';
import * as db from './db';
import {
  type BackupKind,
  backupKeyFor,
  DB_FILE,
  DOCUMENTS_FILE,
  MANIFEST_FILE,
  type ManifestBody,
  sealManifest,
  serializeManifest,
} from './manifest';
import { Mc } from './mc';
import { planRetention, type StoredRun } from './retention';
import { inventoryDocuments, tarStream } from './tar';
import {
  dockerAvailable,
  dockerRunBase,
  hostForDocker,
  localToolMajor,
  parsePgUrl,
  redact,
  type ToolMode,
  waitForExit,
} from './tools';
import { DigestTap, writeAtomically } from './streams';

export type Location = 'local' | 'cloud' | 'offsite';

export interface BackupResult {
  backupKey: string;
  status: 'success' | 'partial' | 'failed';
  locationsOk: Location[];
  runDir: string;
  manifestSha256: string | null;
  errors: string[];
  retention: Partial<Record<Location, { pruned: string[]; error?: string }>>;
  recorded: boolean;
}

export type Logger = (message: string) => void;

async function chooseMode(
  cfg: BackupConfig,
  tool: 'pg_dump' | 'mc',
  serverMajor?: number,
): Promise<ToolMode> {
  if (cfg.tools === 'docker') return 'docker';
  const major = await localToolMajor(tool);
  const localOk =
    major !== null && (tool !== 'pg_dump' || (serverMajor !== undefined && major >= serverMajor));
  if (cfg.tools === 'local') {
    if (!localOk)
      throw new Error(`${tool} lokal tidak ada atau versinya lebih tua dari server (BACKUP_TOOLS=local)`);
    return 'local';
  }
  if (localOk) return 'local';
  if (await dockerAvailable()) return 'docker';
  throw new Error(`${tool} tidak tersedia: pasang ${tool} (versi ≥ server) atau jalankan Docker`);
}

/** pg_dump -Fc dari snapshot yang diekspor; stdout = dump biner. */
function spawnPgDump(mode: ToolMode, cfg: BackupConfig, url: string, snapshot: string) {
  const c = parsePgUrl(url);
  const dumpArgs = [
    '--format=custom',
    '--no-password',
    `--snapshot=${snapshot}`,
    '--lock-wait-timeout=120s',
    '-h',
    mode === 'docker' ? hostForDocker(c.host) : c.host,
    '-p',
    String(c.port),
    '-U',
    c.user,
    '-d',
    c.database,
  ];
  const env = { ...process.env, PGPASSWORD: c.password, PGAPPNAME: 'simrs-backup' };
  return mode === 'docker'
    ? spawn(
        'docker',
        [...dockerRunBase(), '-e', 'PGPASSWORD', '-e', 'PGAPPNAME', cfg.pgImage, 'pg_dump', ...dumpArgs],
        {
          env,
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      )
    : spawn('pg_dump', dumpArgs, { env, stdio: ['ignore', 'pipe', 'pipe'] });
}

interface EncryptedFile {
  plainBytes: number;
  plainSha256: string;
  encBytes: number;
  encSha256: string;
}

async function encryptTo(
  target: string,
  source: NodeJS.ReadableStream,
  recipient: RecipientKey,
): Promise<EncryptedFile> {
  const plain = new DigestTap();
  const enc = new DigestTap();
  await writeAtomically(target, [source, plain, createEncryptStream(recipient), enc]);
  return {
    plainBytes: plain.bytes,
    plainSha256: plain.digest(),
    encBytes: enc.bytes,
    encSha256: enc.digest(),
  };
}

/** Pesan galat singkat untuk dicatat (≤ 500 karakter, tanpa kredensial). */
export function shortError(err: unknown, secrets: readonly string[] = []): string {
  const msg = err instanceof Error ? err.message : String(err);
  return redact(msg, secrets).replace(/\s+/g, ' ').trim().slice(0, 480) || 'galat tanpa pesan';
}

async function listLocalRuns(dir: string): Promise<StoredRun[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const runs: StoredRun[] = [];
  for (const name of names) {
    const s = await stat(join(dir, name)).catch(() => null);
    if (!s?.isDirectory()) continue;
    const complete = await stat(join(dir, name, MANIFEST_FILE)).then(
      () => true,
      () => false,
    );
    runs.push({ key: name, complete });
  }
  return runs;
}

export async function runBackup(
  cfg: BackupConfig,
  opts: { kind: BackupKind; now?: Date; skipRetention?: boolean; log?: Logger },
): Promise<BackupResult> {
  const log = opts.log ?? (() => undefined);
  if (!cfg.databaseUrl) throw new Error('BACKUP_DATABASE_URL belum disetel (koneksi peran simrs_backup)');
  if (cfg.storageDriver !== 'disk') {
    throw new Error('STORAGE_DRIVER=s3 belum didukung backup dokumen (driver S3 P08 belum ada, ADR-0020)');
  }
  const recipient = requireRecipient(cfg);
  const databaseUrl = cfg.databaseUrl;
  const secrets = [parsePgUrl(databaseUrl).password, cfg.primary.secretKey, cfg.offsite.secretKey];
  const startedAt = opts.now ?? new Date();
  const backupKey = backupKeyFor(startedAt, opts.kind);
  const runDir = join(cfg.localDir, backupKey);
  const errors: string[] = [];
  const locationsOk: Location[] = [];
  const retention: BackupResult['retention'] = {};
  let manifestSha256: string | null = null;
  let stats: db.DatabaseStats | null = null;
  let dbFile: EncryptedFile | null = null;
  let docs: { file: EncryptedFile; fileCount: number; totalBytes: number } | null = null;

  const lockClient = await db.connect(databaseUrl, 'simrs-backup');
  try {
    if (!(await db.tryBackupLock(lockClient))) {
      throw new Error('BACKUP_RUNNING: backup lain sedang berjalan untuk database ini');
    }
    await mkdir(cfg.localDir, { recursive: true, mode: 0o700 });
    await mkdir(runDir, { mode: 0o700 }); // gagal bila sudah ada: kunci backup unik per detik
    log(`backup ${backupKey} → ${runDir}`);

    // 1–2. Snapshot + dump.
    const pgMode = await chooseMode(cfg, 'pg_dump', await db.serverMajor(lockClient));
    const snapClient = await db.connect(databaseUrl, 'simrs-backup-snapshot');
    try {
      const snapshot = await db.exportSnapshot(snapClient);
      stats = await db.collectStats(snapClient, databaseName(databaseUrl));
      log(`snapshot ${snapshot}: ${Object.keys(stats.tables).length} tabel, pg_dump via ${pgMode}`);
      const child = spawnPgDump(pgMode, cfg, databaseUrl, snapshot);
      if (!child.stdout) throw new Error('pg_dump tanpa stdout');
      const [file] = await Promise.all([
        encryptTo(join(runDir, DB_FILE), child.stdout, recipient),
        waitForExit(child, 'pg_dump', secrets),
      ]);
      dbFile = file;
      await snapClient.query('COMMIT');
    } finally {
      await snapClient.end().catch(() => undefined);
    }
    log(`${DB_FILE}: ${dbFile.plainBytes} B dump → ${dbFile.encBytes} B terenkripsi`);

    // 3. Dokumen: setelah snapshot, jadi semua berkas yang dirujuk baris DB sudah ada (berkas ditulis sebelum commit
    // dan tidak pernah dihapus).
    const inventory = await inventoryDocuments(cfg.documentsRoot);
    const docFile = await encryptTo(join(runDir, DOCUMENTS_FILE), tarStream(inventory), recipient);
    docs = { file: docFile, fileCount: inventory.entries.length, totalBytes: inventory.totalBytes };
    log(`${DOCUMENTS_FILE}: ${docs.fileCount} berkas dokumen (${inventory.skipped} dilewati)`);

    // 4. Manifest terakhir.
    const body: ManifestBody = {
      format: 'simrs-backup-manifest/v1',
      backupKey,
      kind: opts.kind,
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      encryption: { scheme: ENCRYPTION_SCHEME, recipientKeyId: recipient.id },
      database: { file: { name: DB_FILE, ...dbFile }, ...stats },
      documents: {
        file: { name: DOCUMENTS_FILE, ...docFile },
        source: 'disk',
        fileCount: docs.fileCount,
        totalBytes: docs.totalBytes,
      },
    };
    const text = serializeManifest(sealManifest(body));
    await writeFile(join(runDir, MANIFEST_FILE), text, { flag: 'wx', mode: 0o600 });
    manifestSha256 = createHash('sha256').update(text).digest('hex');
    locationsOk.push('local');
  } catch (err) {
    errors.push(`local: ${shortError(err, secrets)}`);
  }
  // Kunci advisory ditahan (koneksi lockClient tetap terbuka) sampai unggah, retensi, dan pencatatan selesai.

  try {
    if (locationsOk.includes('local')) {
      // 5. Lokasi jauh.
      const mc = new Mc(await chooseMode(cfg, 'mc'), [cfg.primary, cfg.offsite], cfg.mcImage);
      try {
        if (cfg.ensureBuckets) await mc.ensureBucket(cfg.primary);
        await mc.uploadRun(runDir, cfg.primary, cfg.prefix, backupKey);
        locationsOk.push('cloud');
        log(`cloud: ${cfg.primary.bucket}/${cfg.prefix}${backupKey}`);
      } catch (err) {
        errors.push(`cloud: ${shortError(err, secrets)}`);
      }
      if (locationsOk.includes('cloud')) {
        try {
          if (cfg.ensureBuckets) await mc.ensureBucket(cfg.offsite);
          await mc.mirrorPrefix(cfg.primary, cfg.offsite, cfg.prefix);
          locationsOk.push('offsite');
          log(`offsite: ${cfg.offsite.bucket}/${cfg.prefix}`);
        } catch (err) {
          errors.push(`offsite: ${shortError(err, secrets)}`);
        }
      } else {
        errors.push('offsite: dilewati karena unggah cloud gagal');
      }

      // 6. Retensi per lokasi (run ini selalu dilindungi). Galat retensi tidak menggagalkan backup.
      if (!opts.skipRetention) {
        const protect = new Set([backupKey]);
        const now = new Date();
        const apply = async (
          loc: Location,
          list: () => Promise<StoredRun[]>,
          remove: (k: string) => Promise<void>,
        ) => {
          try {
            const plan = planRetention(await list(), now, cfg.retention, protect);
            for (const k of plan.prune) await remove(k);
            retention[loc] = { pruned: plan.prune };
          } catch (err) {
            retention[loc] = { pruned: [], error: shortError(err, secrets) };
          }
        };
        await apply(
          'local',
          () => listLocalRuns(cfg.localDir),
          (k) => rm(join(cfg.localDir, k), { recursive: true, force: true }),
        );
        if (locationsOk.includes('cloud')) {
          await apply(
            'cloud',
            () => mc.listRuns(cfg.primary, cfg.prefix),
            (k) => mc.removeRun(cfg.primary, cfg.prefix, k),
          );
        }
        if (locationsOk.includes('offsite')) {
          await apply(
            'offsite',
            () => mc.listRuns(cfg.offsite, cfg.prefix),
            (k) => mc.removeRun(cfg.offsite, cfg.prefix, k),
          );
        }
      }
    }
  } catch (err) {
    errors.push(`remote: ${shortError(err, secrets)}`);
  }

  const status: BackupResult['status'] = !locationsOk.includes('local')
    ? 'failed'
    : locationsOk.length === 3
      ? 'success'
      : 'partial';
  let recorded = false;
  try {
    const tableCount = stats ? Object.keys(stats.tables).length : null;
    const rowTotal = stats ? Object.values(stats.tables).reduce((a, b) => a + b, 0) : null;
    await db.recordBackupRun(databaseUrl, {
      id: newId(),
      backupKey,
      kind: opts.kind,
      status,
      startedAt,
      finishedAt: new Date(),
      locationsOk,
      dbBytes: dbFile?.encBytes ?? null,
      documentsBytes: docs?.file.encBytes ?? null,
      documentFiles: docs?.fileCount ?? null,
      tableCount,
      rowTotal,
      manifestSha256: status === 'failed' ? null : manifestSha256,
      error: errors.length ? errors.join(' · ').slice(0, 500) : null,
    });
    recorded = true;
  } catch (err) {
    errors.push(`catat: ${shortError(err, secrets)}`);
  } finally {
    await lockClient.end().catch(() => undefined);
  }
  return { backupKey, status, locationsOk, runDir, manifestSha256, errors, retention, recorded };
}
