/**
 * Manifest backup (ADR-0071): satu berkas JSON polos per backup, ditulis PALING AKHIR (keberadaannya = backup lengkap).
 * Berisi hash berkas terenkripsi dan isinya, jumlah baris per tabel, migrasi, dan kepala rantai audit per tenant
 * dari snapshot yang SAMA dengan dump. Tanpa data pasien, jadi bisa diperiksa tanpa kunci privat.
 * `digest` = SHA-256 JSON kanonik (kunci terurut) seluruh isi lain: manifest yang rusak/diubah = gagal keras.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ENCRYPTION_SCHEME } from './crypto';

export const MANIFEST_FORMAT = 'simrs-backup-manifest/v1';
export const MANIFEST_FILE = 'manifest.json';
export const DB_FILE = 'db.dump.enc';
export const DOCUMENTS_FILE = 'documents.tar.enc';

export const BACKUP_KINDS = ['hourly', 'daily', 'manual'] as const;
export type BackupKind = (typeof BACKUP_KINDS)[number];

/** Kunci backup = nama folder di ketiga lokasi: waktu mulai UTC + jenis, mis. `20261005T031500Z-hourly`. */
export const BACKUP_KEY = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z-(hourly|daily|manual)$/;

export function backupKeyFor(at: Date, kind: BackupKind): string {
  const iso = at.toISOString(); // 2026-10-05T03:15:00.123Z
  return `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}T${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}Z-${kind}`;
}

export function parseBackupKey(key: string): { kind: BackupKind; startedAt: Date } | null {
  const m = BACKUP_KEY.exec(key);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, kind] = m;
  const startedAt = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}Z`);
  if (Number.isNaN(startedAt.getTime()) || backupKeyFor(startedAt, kind as BackupKind) !== key) return null;
  return { kind: kind as BackupKind, startedAt };
}

const sha256Hex = z.string().regex(/^[a-f0-9]{64}$/);
const count = z.number().int().nonnegative();

const fileSchema = <N extends string>(name: N) =>
  z.strictObject({
    name: z.literal(name),
    plainBytes: count,
    plainSha256: sha256Hex,
    encBytes: z.number().int().positive(),
    encSha256: sha256Hex,
  });

export const manifestSchema = z.strictObject({
  format: z.literal(MANIFEST_FORMAT),
  backupKey: z.string().regex(BACKUP_KEY),
  kind: z.enum(BACKUP_KINDS),
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime(),
  encryption: z.strictObject({
    scheme: z.literal(ENCRYPTION_SCHEME),
    recipientKeyId: z.string().regex(/^[a-f0-9]{16}$/),
  }),
  database: z.strictObject({
    file: fileSchema(DB_FILE),
    name: z.string().regex(/^[A-Za-z0-9_]{1,63}$/),
    serverVersion: z.string().min(1).max(200),
    /** Migrasi Prisma yang sudah diterapkan (urut nama). */
    migrations: z.array(z.string().regex(/^[0-9]{14}_[a-z0-9_]+$/)),
    /** `skema.tabel` → jumlah baris pada snapshot dump. */
    tables: z.record(z.string().regex(/^[A-Za-z0-9_]{1,63}\.[A-Za-z0-9_]{1,63}$/), count),
    /** Kepala rantai audit per tenant pada snapshot dump (dibandingkan saat uji restore). */
    /** Kepala rantai audit per tenant + seq pertama yang rusak (null = utuh) pada snapshot dump. */
    auditHeads: z.array(
      z.strictObject({
        tenantId: z.uuid(),
        seq: z.string().regex(/^[1-9][0-9]{0,18}$/),
        hash: sha256Hex,
        firstBrokenSeq: z
          .string()
          .regex(/^[1-9][0-9]{0,18}$/)
          .nullable(),
      }),
    ),
    tenants: z.array(
      z.strictObject({
        id: z.uuid(),
        code: z.string().min(1).max(40),
        kind: z.string().min(1).max(20),
        status: z.string().min(1).max(20),
      }),
    ),
  }),
  documents: z.strictObject({
    file: fileSchema(DOCUMENTS_FILE),
    /** disk = folder STORAGE_DISK_ROOT (ADR-0020). */
    source: z.literal('disk'),
    fileCount: count,
    totalBytes: count,
  }),
  digest: sha256Hex,
});

export type Manifest = z.infer<typeof manifestSchema>;
export type ManifestBody = Omit<Manifest, 'digest'>;

/** JSON kanonik: kunci objek terurut, tanpa spasi. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

export function manifestDigest(body: ManifestBody): string {
  return createHash('sha256').update(canonicalJson(body)).digest('hex');
}

export class ManifestError extends Error {
  constructor(
    readonly code: 'MANIFEST_INVALID' | 'MANIFEST_DIGEST_MISMATCH' | 'MANIFEST_KEY_MISMATCH',
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = 'ManifestError';
  }
}

export function sealManifest(body: ManifestBody): Manifest {
  const manifest = { ...body, digest: manifestDigest(body) };
  // Gagal di sini = bug pembuat manifest; lebih baik gagal sebelum diunggah.
  return manifestSchema.parse(manifest);
}

export function serializeManifest(manifest: Manifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/** Parse + validasi skema + cocokkan digest. Apa pun yang tidak cocok = galat (tidak ada mode toleran). */
export function parseManifest(text: string, expectedKey?: string): Manifest {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ManifestError('MANIFEST_INVALID', 'bukan JSON yang valid');
  }
  const parsed = manifestSchema.safeParse(raw);
  if (!parsed.success) {
    const where = parsed.error.issues
      .slice(0, 3)
      .map((i) => i.path.join('.') || '(akar)')
      .join(', ');
    throw new ManifestError('MANIFEST_INVALID', `skema tidak cocok di ${where}`);
  }
  const { digest, ...body } = parsed.data;
  if (manifestDigest(body) !== digest) {
    throw new ManifestError('MANIFEST_DIGEST_MISMATCH', 'isi manifest tidak cocok dengan digest-nya');
  }
  if (expectedKey && parsed.data.backupKey !== expectedKey) {
    throw new ManifestError(
      'MANIFEST_KEY_MISMATCH',
      `manifest milik ${parsed.data.backupKey}, bukan ${expectedKey}`,
    );
  }
  return parsed.data;
}
