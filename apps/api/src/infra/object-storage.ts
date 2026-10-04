import { createHash, randomUUID } from 'node:crypto';
import { constants, createReadStream } from 'node:fs';
import { access, mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pipeline, Readable, Transform, type TransformCallback } from 'node:stream';
import type { ApiEnv } from '../config/env';
import { S3Client, S3Error } from './s3-client';

/**
 * P08 · Penyimpanan objek berkas dokumen (ADR-0020). Kunci SELALU dibuat server
 * (`<tenant>/<tahun>/<bulan>/<uuid>`) dan divalidasi lagi oleh driver, jadi tidak ada path dari klien yang pernah
 * menyentuh penyimpanan. Driver `disk` (lokal) dan `s3` (MinIO/S3). Dokumen immutable: tidak ada timpa atau hapus.
 */
export interface ObjectStorage {
  readonly driver: 'disk' | 's3';
  /**
   * Simpan berkas baru; menolak kunci yang sudah ada. `sha256` = hash hex isi (dicatat juga di DB); driver s3
   * meminta server memverifikasi dan menyimpannya sebagai checksum objek.
   */
  put(key: string, bytes: Buffer, sha256: string): Promise<void>;
  /** Buka berkas sebagai stream (unduhan tidak ditampung utuh di memori). Kunci tak ada → galat. */
  open(key: string): Promise<StoredObject>;
  /** Kesiapan untuk `/ready`. */
  check(): Promise<void>;
}

export interface StoredObject {
  body: Readable;
  /** Ukuran menurut penyimpanan (byte). */
  size: number;
  /** SHA-256 hex yang diverifikasi penyimpanan saat ditulis (s3: checksum objek); `null` bila tidak ada. */
  sha256: string | null;
}

export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');

const KEY = /^[0-9a-f-]{36}\/[0-9]{4}\/[0-9]{2}\/[0-9a-f-]{36}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;

function assertKey(key: string): void {
  if (!KEY.test(key)) throw new Error('Kunci penyimpanan tidak valid');
}

const sha256Hex = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

export function documentStorageKey(tenantId: string, id: string, at: Date = new Date()): string {
  const month = String(at.getUTCMonth() + 1).padStart(2, '0');
  return `${tenantId}/${at.getUTCFullYear()}/${month}/${id}`;
}

/** Isi di penyimpanan tidak cocok dengan hash/ukuran yang tercatat. Pesan tanpa kunci atau isi. */
export class StorageIntegrityError extends Error {
  constructor(options?: ErrorOptions) {
    super('Isi berkas tidak cocok dengan hash tersimpan', options);
    this.name = 'StorageIntegrityError';
  }
}

/** Meneruskan isi sambil meng-hash; potongan terakhir ditahan sampai hash dan ukuran terbukti cocok. */
class HashGate extends Transform {
  private readonly hash = createHash('sha256');
  private held: Buffer | null = null;
  private seen = 0;

  constructor(
    private readonly expected: string,
    private readonly size: number,
  ) {
    super();
  }

  override _transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback): void {
    this.hash.update(chunk);
    this.seen += chunk.length;
    if (this.seen > this.size) {
      cb(new StorageIntegrityError());
      return;
    }
    const previous = this.held;
    this.held = chunk;
    cb(null, previous ?? undefined);
  }

  override _flush(cb: TransformCallback): void {
    if (this.seen !== this.size || this.hash.digest('hex') !== this.expected) {
      cb(new StorageIntegrityError());
      return;
    }
    cb(null, this.held ?? undefined);
  }
}

/**
 * Isi berkas yang terverifikasi terhadap hash dan ukuran di DB (ADR-0020 butir 5). Ketidakcocokan yang terlihat
 * sebelum mengirim (ukuran, checksum penyimpanan) → `StorageIntegrityError`, tidak ada byte yang terkirim. Tanpa
 * checksum penyimpanan (disk), isi dibaca utuh (≤ ukuran tercatat) dan di-hash dulu. Dengan checksum, isi di-stream
 * sambil di-hash ulang; byte terakhir ditahan sampai cocok, jadi berkas rusak tidak pernah terkirim utuh.
 */
export async function verifiedContent(
  obj: StoredObject,
  expected: { sha256: string; size: number },
): Promise<Readable> {
  if (obj.size !== expected.size || (obj.sha256 !== null && obj.sha256 !== expected.sha256)) {
    obj.body.destroy();
    throw new StorageIntegrityError();
  }
  if (obj.sha256 === null) {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of obj.body) {
      size += (chunk as Buffer).length;
      if (size > expected.size) {
        obj.body.destroy();
        throw new StorageIntegrityError();
      }
      chunks.push(chunk as Buffer);
    }
    const bytes = Buffer.concat(chunks);
    if (sha256Hex(bytes) !== expected.sha256) throw new StorageIntegrityError();
    return Readable.from([bytes]);
  }
  // Galat di sumber atau gerbang menghancurkan keduanya; penerima melihatnya sebagai galat stream.
  return pipeline(obj.body, new HashGate(expected.sha256, expected.size), () => undefined);
}

export class DiskObjectStorage implements ObjectStorage {
  readonly driver = 'disk' as const;
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  private path(key: string): string {
    assertKey(key);
    return join(this.root, ...key.split('/'));
  }

  async put(key: string, bytes: Buffer, sha256: string): Promise<void> {
    const target = this.path(key);
    if (sha256Hex(bytes) !== sha256) throw new StorageIntegrityError();
    await mkdir(dirname(target), { recursive: true });
    if (
      await access(target).then(
        () => true,
        () => false,
      )
    ) {
      throw new Error('Kunci penyimpanan sudah dipakai');
    }
    // Tulis ke berkas sementara lalu rename: pembaca tidak pernah melihat berkas setengah jadi.
    const tmp = `${target}.${randomUUID()}.tmp`;
    try {
      await writeFile(tmp, bytes, { flag: 'wx', mode: 0o600 });
      await rename(tmp, target);
    } catch (err) {
      await rm(tmp, { force: true });
      throw err;
    }
  }

  async open(key: string): Promise<StoredObject> {
    const path = this.path(key);
    const { size } = await stat(path);
    return { body: createReadStream(path), size, sha256: null };
  }

  async check(): Promise<void> {
    await mkdir(this.root, { recursive: true });
    await access(this.root, constants.R_OK | constants.W_OK);
  }
}

/**
 * Driver S3/MinIO. Tulis: `If-None-Match: *` (server menolak kunci yang sudah ada, tanpa jeda periksa-lalu-tulis),
 * `x-amz-content-sha256` + `x-amz-checksum-sha256` (server menolak isi yang tidak cocok dan menyimpan checksumnya).
 * Baca: checksum objek diminta (`x-amz-checksum-mode`) agar ketidakcocokan dengan DB terlihat sebelum mengirim.
 * Kesiapan: HeadBucket (berlaku untuk S3 mana pun, bukan endpoint khusus MinIO).
 */
export class S3ObjectStorage implements ObjectStorage {
  readonly driver = 's3' as const;

  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
  ) {}

  async put(key: string, bytes: Buffer, sha256: string): Promise<void> {
    assertKey(key);
    if (!SHA256_HEX.test(sha256)) throw new Error('Hash berkas tidak valid');
    try {
      await this.client.send({
        method: 'PUT',
        bucket: this.bucket,
        key,
        body: bytes,
        payloadHash: sha256,
        headers: {
          'content-type': 'application/octet-stream',
          'if-none-match': '*',
          'x-amz-checksum-sha256': Buffer.from(sha256, 'hex').toString('base64'),
        },
      });
    } catch (err) {
      if (err instanceof S3Error && err.status === 412) {
        throw new Error('Kunci penyimpanan sudah dipakai', { cause: err });
      }
      if (err instanceof S3Error && /Mismatch|BadDigest/.test(err.code)) {
        throw new StorageIntegrityError({ cause: err });
      }
      throw err;
    }
  }

  async open(key: string): Promise<StoredObject> {
    assertKey(key);
    const res = await this.client.request({
      method: 'GET',
      bucket: this.bucket,
      key,
      headers: { 'x-amz-checksum-mode': 'ENABLED' },
    });
    const checksum = res.headers['x-amz-checksum-sha256'];
    // Checksum gabungan multipart (`…-N`) bukan hash isi utuh; objek dokumen selalu satu PUT.
    const sha256 =
      typeof checksum === 'string' && /^[A-Za-z0-9+/]{43}=$/.test(checksum)
        ? Buffer.from(checksum, 'base64').toString('hex')
        : null;
    return { body: res.body, size: Number(res.headers['content-length'] ?? -1), sha256 };
  }

  async check(): Promise<void> {
    await this.client.send({ method: 'HEAD', bucket: this.bucket });
  }
}

/** Driver sesuai env (`STORAGE_DRIVER`); aturan per APP_ENV ditegakkan `loadApiEnv`. */
export function createObjectStorage(
  env: Pick<
    ApiEnv,
    | 'STORAGE_DRIVER'
    | 'STORAGE_DISK_ROOT'
    | 'S3_ENDPOINT'
    | 'S3_REGION'
    | 'S3_ACCESS_KEY'
    | 'S3_SECRET_KEY'
    | 'S3_BUCKET_DOCUMENTS'
  >,
): ObjectStorage {
  if (env.STORAGE_DRIVER === 'disk') return new DiskObjectStorage(env.STORAGE_DISK_ROOT);
  const client = new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    accessKeyId: env.S3_ACCESS_KEY,
    secretAccessKey: env.S3_SECRET_KEY,
  });
  return new S3ObjectStorage(client, env.S3_BUCKET_DOCUMENTS);
}
