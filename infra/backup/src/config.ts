import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { S3Client } from '@simrs/shared/node';
import { z } from 'zod';
import { parsePublicKey, type RecipientKey } from './crypto';
import { type RetentionPolicy } from './retention';

export function findRepoRoot(start: string = dirname(fileURLToPath(import.meta.url))): string {
  let dir = start;
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error('Root repo (pnpm-workspace.yaml) tidak ditemukan');
    dir = parent;
  }
}

const bucket = z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/, 'nama bucket S3 tidak valid');
const keep = (fallback: number) => z.coerce.number().int().min(0).max(10_000).default(fallback);
const flag = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');
const blankAsUndefined = (v: unknown) => (v === '' ? undefined : v);

/** Variabel lingkungan backup. Rahasia (kata sandi DB, kunci S3) tidak pernah dicetak. */
export const backupEnvSchema = z.object({
  /** Koneksi peran ops `simrs_backup` ke database yang di-backup (bukan migrator, bukan simrs_app). */
  BACKUP_DATABASE_URL: z.preprocess(blankAsUndefined, z.url().optional()),
  /** Kunci publik penerima `simrsbk1:…` atau berkas berisi kunci itu. */
  BACKUP_PUBLIC_KEY: z.preprocess(blankAsUndefined, z.string().optional()),
  BACKUP_PUBLIC_KEY_FILE: z.preprocess(blankAsUndefined, z.string().optional()),
  /** Lokasi 1: disk edge. Relatif terhadap root repo. */
  BACKUP_LOCAL_DIR: z.string().trim().min(1).default('.local/backup'),
  /** Awalan objek di kedua bucket (mis. `edge-rscm/`). */
  BACKUP_PREFIX: z
    .string()
    .regex(/^([a-z0-9][a-z0-9._-]*\/)+$/, 'huruf kecil/angka/._- diakhiri /')
    .default('simrs/'),
  S3_ENDPOINT: z.url().default('http://localhost:9000'),
  S3_ACCESS_KEY: z.string().min(1).default('simrs_local'),
  S3_SECRET_KEY: z.string().min(1).default('simrs_local_secret'),
  /** Lokasi 2: bucket cloud utama. */
  BACKUP_S3_BUCKET: z.preprocess(blankAsUndefined, bucket.optional()),
  S3_BUCKET_BACKUPS: z.preprocess(blankAsUndefined, bucket.optional()),
  /** Lokasi 3: offsite (produksi: penyedia/region lain). Bawaan = endpoint dan kredensial utama. */
  BACKUP_OFFSITE_S3_ENDPOINT: z.preprocess(blankAsUndefined, z.url().optional()),
  BACKUP_OFFSITE_S3_ACCESS_KEY: z.preprocess(blankAsUndefined, z.string().optional()),
  BACKUP_OFFSITE_S3_SECRET_KEY: z.preprocess(blankAsUndefined, z.string().optional()),
  BACKUP_OFFSITE_BUCKET: bucket.default('simrs-backups-offsite'),
  /** Buat bucket bila belum ada (lokal saja; kredensial produksi tidak boleh punya hak membuat bucket). */
  BACKUP_ENSURE_BUCKETS: flag,
  BACKUP_KEEP_HOURLY: keep(48),
  BACKUP_KEEP_DAILY: keep(35),
  BACKUP_KEEP_MONTHLY: keep(12),
  BACKUP_KEEP_MANUAL: keep(10),
  BACKUP_INCOMPLETE_GRACE_HOURS: keep(24),
  /** pg_dump/mc: biner lokal bila versinya cocok, selain itu image Docker resmi. */
  BACKUP_TOOLS: z.enum(['auto', 'docker', 'local']).default('auto'),
  BACKUP_PG_IMAGE: z.string().min(1).default('postgres:16-alpine'),
  BACKUP_MC_IMAGE: z.string().min(1).default('pgsty/mc:latest'),
  BACKUP_REDIS_IMAGE: z.string().min(1).default('redis:7-alpine'),
  STORAGE_DRIVER: z.enum(['disk', 's3']).default('disk'),
  /** Driver s3: bucket dokumen yang di-backup (sama dengan API). */
  S3_BUCKET_DOCUMENTS: bucket.default('simrs-documents'),
  S3_REGION: z.string().min(1).default('ap-southeast-3'),
  /** Jangkar audit WORM (ADR-0072): uji restore mencocokkan rantai hasil restore dengan jangkar sah ≤ waktu backup. */
  AUDIT_ANCHOR_KEY: z.preprocess(blankAsUndefined, z.string().optional()),
  AUDIT_ANCHOR_BUCKET: z.preprocess(blankAsUndefined, bucket.optional()),
  BACKUP_MINIO_IMAGE: z.string().min(1).default('pgsty/minio:latest'),
  /** Sama dengan API: relatif terhadap apps/api. */
  STORAGE_DISK_ROOT: z.string().trim().min(1).default('../../.local/storage'),
  // ── Uji restore ──
  BACKUP_PRIVATE_KEY_FILE: z.preprocess(blankAsUndefined, z.string().optional()),
  BACKUP_PRIVATE_KEY_PASSPHRASE: z.preprocess(blankAsUndefined, z.string().optional()),
  BACKUP_RESTORE_WORK_DIR: z.string().trim().min(1).default('.local/backup-restore'),
  /** Awalan nama kontainer sementara uji restore (dihapus setelah selesai). */
  BACKUP_RESTORE_CONTAINER_PREFIX: z
    .string()
    .regex(/^[a-z0-9][a-z0-9_.-]{1,40}$/)
    .default('simrs-uji-restore'),
});

export interface S3Target {
  alias: 'primary' | 'offsite';
  endpoint: string;
  accessKey: string;
  secretKey: string;
  bucket: string;
}

export interface BackupConfig {
  repoRoot: string;
  databaseUrl?: string;
  publicKeyText?: string;
  localDir: string;
  prefix: string;
  primary: S3Target;
  offsite: S3Target;
  ensureBuckets: boolean;
  retention: RetentionPolicy;
  tools: 'auto' | 'docker' | 'local';
  pgImage: string;
  mcImage: string;
  redisImage: string;
  storageDriver: 'disk' | 's3';
  documentsRoot: string;
  documentsBucket: string;
  s3Region: string;
  anchorKey?: string;
  anchorBucket?: string;
  minioImage: string;
  privateKeyFile?: string;
  privateKeyPassphrase?: string;
  restoreWorkDir: string;
  containerPrefix: string;
}

export function loadConfig(
  env: Record<string, string | undefined> = process.env,
  repoRoot: string = findRepoRoot(),
): BackupConfig {
  const parsed = backupEnvSchema.safeParse(env);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Konfigurasi backup tidak valid → ${fields}`);
  }
  const e = parsed.data;
  const fromRoot = (p: string) => (isAbsolute(p) ? p : resolve(repoRoot, p));
  const primary: S3Target = {
    alias: 'primary',
    endpoint: e.S3_ENDPOINT,
    accessKey: e.S3_ACCESS_KEY,
    secretKey: e.S3_SECRET_KEY,
    bucket: e.BACKUP_S3_BUCKET ?? e.S3_BUCKET_BACKUPS ?? 'simrs-backups',
  };
  const offsite: S3Target = {
    alias: 'offsite',
    endpoint: e.BACKUP_OFFSITE_S3_ENDPOINT ?? e.S3_ENDPOINT,
    accessKey: e.BACKUP_OFFSITE_S3_ACCESS_KEY ?? e.S3_ACCESS_KEY,
    secretKey: e.BACKUP_OFFSITE_S3_SECRET_KEY ?? e.S3_SECRET_KEY,
    bucket: e.BACKUP_OFFSITE_BUCKET,
  };
  if (primary.endpoint === offsite.endpoint && primary.bucket === offsite.bucket) {
    throw new Error('Konfigurasi backup tidak valid → bucket offsite harus berbeda dari bucket utama');
  }
  return {
    repoRoot,
    databaseUrl: e.BACKUP_DATABASE_URL,
    publicKeyText: e.BACKUP_PUBLIC_KEY_FILE
      ? readFileSync(fromRoot(e.BACKUP_PUBLIC_KEY_FILE), 'utf8')
      : e.BACKUP_PUBLIC_KEY,
    localDir: fromRoot(e.BACKUP_LOCAL_DIR),
    prefix: e.BACKUP_PREFIX,
    primary,
    offsite,
    ensureBuckets: e.BACKUP_ENSURE_BUCKETS,
    retention: {
      hourly: e.BACKUP_KEEP_HOURLY,
      daily: e.BACKUP_KEEP_DAILY,
      monthly: e.BACKUP_KEEP_MONTHLY,
      manual: e.BACKUP_KEEP_MANUAL,
      incompleteGraceHours: e.BACKUP_INCOMPLETE_GRACE_HOURS,
    },
    tools: e.BACKUP_TOOLS,
    pgImage: e.BACKUP_PG_IMAGE,
    mcImage: e.BACKUP_MC_IMAGE,
    redisImage: e.BACKUP_REDIS_IMAGE,
    storageDriver: e.STORAGE_DRIVER,
    documentsBucket: e.S3_BUCKET_DOCUMENTS,
    s3Region: e.S3_REGION,
    anchorKey: e.AUDIT_ANCHOR_KEY,
    anchorBucket: e.AUDIT_ANCHOR_BUCKET,
    minioImage: e.BACKUP_MINIO_IMAGE,
    documentsRoot: isAbsolute(e.STORAGE_DISK_ROOT)
      ? e.STORAGE_DISK_ROOT
      : resolve(repoRoot, 'apps/api', e.STORAGE_DISK_ROOT),
    privateKeyFile: e.BACKUP_PRIVATE_KEY_FILE ? fromRoot(e.BACKUP_PRIVATE_KEY_FILE) : undefined,
    privateKeyPassphrase: e.BACKUP_PRIVATE_KEY_PASSPHRASE,
    restoreWorkDir: fromRoot(e.BACKUP_RESTORE_WORK_DIR),
    containerPrefix: e.BACKUP_RESTORE_CONTAINER_PREFIX,
  };
}

export function requireRecipient(cfg: BackupConfig): RecipientKey {
  if (!cfg.publicKeyText) {
    throw new Error(
      'Kunci publik backup belum disetel: BACKUP_PUBLIC_KEY (simrsbk1:…) atau BACKUP_PUBLIC_KEY_FILE. Buat dengan pnpm backup:kunci-baru',
    );
  }
  return parsePublicKey(cfg.publicKeyText);
}

/** Nama database dari URL koneksi (untuk log dan manifest; tanpa kredensial). */
export function databaseName(url: string): string {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
}

/** Klien S3 (Node, tanpa Docker) ke endpoint utama: bucket dokumen dan bucket jangkar audit. */
export function primaryS3(cfg: BackupConfig): S3Client {
  return new S3Client({
    endpoint: cfg.primary.endpoint,
    region: cfg.s3Region,
    accessKeyId: cfg.primary.accessKey,
    secretAccessKey: cfg.primary.secretKey,
    timeoutMs: 60_000,
  });
}
