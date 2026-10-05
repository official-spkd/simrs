/**
 * Dokumen saat uji restore (ADR-0071). Backup driver s3 dipulihkan ke bucket BARU di kontainer MinIO sementara
 * (tidak menyentuh bucket mana pun yang sedang dipakai), diunggah dengan checksum SHA-256 yang diverifikasi server,
 * lalu setiap baris `documents` hasil restore dicocokkan dengan berkas hasil ekstrak dan objek di bucket itu.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { S3Client, S3Error } from '@simrs/shared/node';
import type pg from 'pg';
import type { Manifest } from './manifest';
import { runChecked } from './tools';

export const SCRATCH_DOCUMENTS_BUCKET = 'simrs-documents';

const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface ScratchMinio {
  endpoint: string;
  accessKey: string;
  secretKey: string;
  client: S3Client;
}

/** `pgsty/minio` sementara di 127.0.0.1:<acak>; kredensial acak hanya lewat env proses docker. */
export async function startScratchMinio(
  name: string,
  image: string,
  accessKey: string,
  secretKey: string,
): Promise<ScratchMinio> {
  const env = { MINIO_ROOT_USER: accessKey, MINIO_ROOT_PASSWORD: secretKey };
  await runChecked(
    'docker',
    [
      'run',
      '-d',
      '--rm',
      '--name',
      name,
      '-e',
      'MINIO_ROOT_USER',
      '-e',
      'MINIO_ROOT_PASSWORD',
      '-p',
      '127.0.0.1::9000',
      image,
      'server',
      '/data',
    ],
    { env, secrets: [secretKey] },
  );
  const port = await runChecked('docker', ['port', name, '9000/tcp']);
  const m = /:(\d+)\s*$/m.exec(port.stdout.trim().split('\n')[0] ?? '');
  if (!m) throw new Error(`port kontainer ${name} tidak terbaca`);
  const endpoint = `http://127.0.0.1:${m[1]}`;
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      const res = await fetch(`${endpoint}/minio/health/ready`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) break;
    } catch {
      // belum siap
    }
    if (Date.now() > deadline) throw new Error('MinIO sementara tidak siap');
    await sleep(500);
  }
  const client = new S3Client({
    endpoint,
    region: 'us-east-1',
    accessKeyId: accessKey,
    secretAccessKey: secretKey,
  });
  return { endpoint, accessKey, secretKey, client };
}

/** Buat bucket dokumen di MinIO sementara lalu unggah semua berkas hasil ekstrak (server memverifikasi SHA-256). */
export async function uploadDocuments(
  minio: ScratchMinio,
  storageDir: string,
  keys: readonly string[],
): Promise<number> {
  await minio.client.send({ method: 'PUT', bucket: SCRATCH_DOCUMENTS_BUCKET });
  for (const key of keys) {
    const body = await readFile(join(storageDir, ...key.split('/')));
    const hex = sha256(body);
    await minio.client.send({
      method: 'PUT',
      bucket: SCRATCH_DOCUMENTS_BUCKET,
      key,
      body,
      payloadHash: hex,
      headers: { 'if-none-match': '*', 'x-amz-checksum-sha256': Buffer.from(hex, 'hex').toString('base64') },
    });
  }
  return keys.length;
}

export interface DocumentCheck {
  rows: number;
  ok: number;
  /** Baris tanpa berkas/objek atau dengan isi berbeda, yang TIDAK tercatat sebagai temuan sumber di manifest. */
  bad: string[];
  /** Baris yang sudah bermasalah di sumber (manifest `integrityErrors`). */
  knownAtSource: number;
}

/**
 * Setiap baris `documents` hasil restore: berkas hasil ekstrak ada dengan ukuran + SHA-256 sama dengan baris, dan
 * (s3) objek di bucket sementara membawa checksum yang sama.
 */
export async function checkDocumentRows(
  client: pg.Client,
  storageDir: string,
  manifest: Manifest,
  minio: ScratchMinio | null,
): Promise<DocumentCheck> {
  const exists = await client.query("SELECT to_regclass('public.documents') AS t");
  if (!exists.rows[0]?.t) return { rows: 0, ok: 0, bad: [], knownAtSource: 0 };
  const rows = await client.query<{ key: string; sha256: string; size: number }>(
    'SELECT storage_key AS key, sha256, size_bytes AS size FROM public.documents ORDER BY storage_key',
  );
  const known = new Set(manifest.documents.integrityErrors.map((e) => e.key));
  const result: DocumentCheck = { rows: rows.rows.length, ok: 0, bad: [], knownAtSource: 0 };
  for (const row of rows.rows) {
    let good = false;
    const body = await readFile(join(storageDir, ...row.key.split('/'))).catch(() => null);
    if (body && body.length === row.size && sha256(body) === row.sha256) {
      good = true;
      if (minio) {
        try {
          const head = await minio.client.send({
            method: 'HEAD',
            bucket: SCRATCH_DOCUMENTS_BUCKET,
            key: row.key,
            headers: { 'x-amz-checksum-mode': 'ENABLED' },
          });
          const sum = head.headers['x-amz-checksum-sha256'];
          good = typeof sum === 'string' && Buffer.from(sum, 'base64').toString('hex') === row.sha256;
        } catch (err) {
          if (!(err instanceof S3Error)) throw err;
          good = false;
        }
      }
    }
    if (good) result.ok += 1;
    else if (known.has(row.key)) result.knownAtSource += 1;
    else result.bad.push(row.key);
  }
  return result;
}
