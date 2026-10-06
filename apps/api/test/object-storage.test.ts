/**
 * P08 · Driver penyimpanan berkas (ADR-0020): gerbang integritas saat unduh, driver disk, driver S3 terhadap MinIO
 * lokal (bucket uji sekali pakai), aturan driver per APP_ENV, dan kesiapan `/ready` lewat HeadBucket.
 */
import { createHash, randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { text } from 'node:stream/consumers';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadApiEnv } from '../src/config/env';
import {
  createObjectStorage,
  DiskObjectStorage,
  documentStorageKey,
  S3ObjectStorage,
  StorageIntegrityError,
  type StoredObject,
  verifiedContent,
} from '../src/infra/object-storage';
import { S3Error } from '../src/infra/s3-client';
import { createTestApp } from './helpers';
import {
  createTestBucket,
  listTestKeys,
  overwriteTestObject,
  removeTestBucket,
  testS3Client,
} from './s3-test-bucket';

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const key = () => documentStorageKey(randomUUID(), randomUUID());
const BODY = Buffer.from('%PDF-1.4\n% isi uji penyimpanan\n%%EOF\n');

/** Objek tiruan yang dikirim dalam beberapa potongan. */
function stored(bytes: Buffer, claimed: { sha256: string | null; size?: number }): StoredObject {
  const parts = [bytes.subarray(0, 5), bytes.subarray(5, 20), bytes.subarray(20)];
  return { body: Readable.from(parts), size: claimed.size ?? bytes.length, sha256: claimed.sha256 };
}

/** Kumpulkan apa saja yang sempat keluar dari stream sebelum galat. */
async function drain(stream: Readable): Promise<{ out: Buffer; error: unknown }> {
  const chunks: Buffer[] = [];
  try {
    for await (const c of stream) chunks.push(c as Buffer);
    return { out: Buffer.concat(chunks), error: null };
  } catch (error) {
    return { out: Buffer.concat(chunks), error };
  }
}

describe('gerbang integritas unduhan', () => {
  const expected = { sha256: sha(BODY), size: BODY.length };

  it('checksum penyimpanan cocok: isi di-stream utuh', async () => {
    const r = await drain(await verifiedContent(stored(BODY, { sha256: sha(BODY) }), expected));
    expect(r.error).toBeNull();
    expect(r.out.equals(BODY)).toBe(true);
  });

  it('checksum atau ukuran penyimpanan beda dari DB: ditolak sebelum satu byte pun dikirim', async () => {
    await expect(verifiedContent(stored(BODY, { sha256: 'a'.repeat(64) }), expected)).rejects.toBeInstanceOf(
      StorageIntegrityError,
    );
    await expect(
      verifiedContent(stored(BODY, { sha256: sha(BODY), size: BODY.length + 1 }), expected),
    ).rejects.toBeInstanceOf(StorageIntegrityError);
  });

  it('tanpa checksum (disk): dibaca utuh dan di-hash dulu', async () => {
    const ok = await drain(await verifiedContent(stored(BODY, { sha256: null }), expected));
    expect(ok.out.equals(BODY)).toBe(true);
    const forged = Buffer.from(BODY);
    forged[3] = 0x21;
    await expect(verifiedContent(stored(forged, { sha256: null }), expected)).rejects.toBeInstanceOf(
      StorageIntegrityError,
    );
  });

  it('isi tidak cocok dengan checksum yang diklaim: stream gagal dan bagian akhir tidak pernah terkirim', async () => {
    const forged = Buffer.from(BODY);
    forged[forged.length - 1] = 0x21;
    const r = await drain(await verifiedContent(stored(forged, { sha256: sha(BODY) }), expected));
    expect(r.error).toBeInstanceOf(StorageIntegrityError);
    expect(r.out.length).toBeLessThan(BODY.length);
    // Sumber lebih panjang dari ukuran tercatat juga diputus.
    const longer = Buffer.concat([BODY, Buffer.from('ekstra')]);
    const r2 = await drain(
      await verifiedContent(stored(longer, { sha256: sha(BODY), size: BODY.length }), expected),
    );
    expect(r2.error).toBeInstanceOf(StorageIntegrityError);
  });
});

describe('driver disk', () => {
  const root = join(tmpdir(), `simrs-storage-uji-${randomUUID()}`);
  const disk = new DiskObjectStorage(root);
  afterAll(() => rm(root, { recursive: true, force: true }));

  it('tulis lalu buka; tidak menimpa; kunci dan hash divalidasi; tanpa operasi hapus', async () => {
    const k = key();
    await disk.put(k, BODY, sha(BODY));
    const obj = await disk.open(k);
    expect(obj).toMatchObject({ size: BODY.length, sha256: null });
    expect(await text(obj.body)).toBe(BODY.toString());
    await expect(disk.put(k, BODY, sha(BODY))).rejects.toThrow(/sudah dipakai/);
    await expect(disk.put('../../etc/passwd', BODY, sha(BODY))).rejects.toThrow(/tidak valid/);
    await expect(disk.put(key(), BODY, 'b'.repeat(64))).rejects.toBeInstanceOf(StorageIntegrityError);
    await expect(disk.open(key())).rejects.toThrow();
    expect('delete' in disk).toBe(false);
    await disk.check();
  });
});

describe('driver s3 (MinIO lokal, bucket uji)', () => {
  let bucket: string;
  let s3: S3ObjectStorage;

  beforeAll(async () => {
    bucket = await createTestBucket();
    s3 = new S3ObjectStorage(testS3Client(), bucket);
  });
  afterAll(() => removeTestBucket(bucket));

  it('tulis dengan checksum sisi server; buka mengembalikan checksum yang sama dan isi utuh', async () => {
    const k = key();
    await s3.put(k, BODY, sha(BODY));
    const obj = await s3.open(k);
    expect(obj).toMatchObject({ size: BODY.length, sha256: sha(BODY) });
    expect(await text(obj.body)).toBe(BODY.toString());
    expect(await listTestKeys(bucket)).toEqual([k]);
    expect('delete' in s3).toBe(false);
  });

  it('kunci yang sudah ada tidak ditimpa (If-None-Match); hash yang tidak cocok ditolak server', async () => {
    const k = key();
    await s3.put(k, BODY, sha(BODY));
    await expect(s3.put(k, Buffer.from('%PDF-1.4 lain'), sha(Buffer.from('%PDF-1.4 lain')))).rejects.toThrow(
      /sudah dipakai/,
    );
    expect(await text((await s3.open(k)).body)).toBe(BODY.toString());
    // Hash palsu: server MinIO menolak (isi tidak cocok dengan x-amz-content-sha256 / checksum).
    const other = key();
    await expect(s3.put(other, BODY, 'c'.repeat(64))).rejects.toBeInstanceOf(StorageIntegrityError);
    expect(await listTestKeys(bucket)).not.toContain(other);
  });

  it('kunci tidak valid ditolak sebelum ke jaringan; kunci tak ada → 404', async () => {
    await expect(s3.put('simrs-documents/../x', BODY, sha(BODY))).rejects.toThrow(/tidak valid/);
    await expect(s3.open('a/b')).rejects.toThrow(/tidak valid/);
    await expect(s3.open(key())).rejects.toMatchObject({ status: 404, code: 'NoSuchKey' });
  });

  it('objek yang ditimpa di luar aplikasi: checksum baru (atau tanpa checksum) terdeteksi saat dibuka', async () => {
    const k = key();
    await s3.put(k, BODY, sha(BODY));
    const forged = Buffer.from(BODY);
    forged[forged.length - 2] = 0x21;
    await overwriteTestObject(bucket, k, forged, { checksum: true });
    await expect(
      verifiedContent(await s3.open(k), { sha256: sha(BODY), size: BODY.length }),
    ).rejects.toBeInstanceOf(StorageIntegrityError);
    await overwriteTestObject(bucket, k, forged);
    const noChecksum = await s3.open(k);
    expect(noChecksum.sha256).toBeNull();
    await expect(
      verifiedContent(noChecksum, { sha256: sha(BODY), size: BODY.length }),
    ).rejects.toBeInstanceOf(StorageIntegrityError);
  });

  it('HeadBucket: bucket ada → siap; bucket tak ada atau kredensial salah → galat S3 tanpa detail', async () => {
    await s3.check();
    const missing = new S3ObjectStorage(testS3Client(), `${bucket}-tidak-ada`);
    await expect(missing.check()).rejects.toMatchObject({ name: 'S3Error', status: 404 });
    const wrong = new S3ObjectStorage(testS3Client({ secretAccessKey: 'bukan-rahasia-yang-benar' }), bucket);
    const err = await wrong.open(key()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(S3Error);
    expect(err).toMatchObject({ status: 403, code: 'SignatureDoesNotMatch' });
    expect(String((err as Error).message)).not.toContain(bucket);
  });

  it('/ready memakai HeadBucket dan melaporkan driver: bucket hilang → storage tidak siap (503)', async () => {
    const ok = await createTestApp({ STORAGE_DRIVER: 's3', S3_BUCKET_DOCUMENTS: bucket });
    const bad = await createTestApp({ STORAGE_DRIVER: 's3', S3_BUCKET_DOCUMENTS: `${bucket}-tidak-ada` });
    const disk = await createTestApp();
    try {
      const good = await request(ok.getHttpServer()).get('/ready');
      expect(good.body.checks.storage).toMatchObject({ ok: true, driver: 's3' });
      const res = await request(bad.getHttpServer()).get('/ready').expect(503);
      expect(res.body.checks.storage).toMatchObject({ ok: false, error: 'S3Error', driver: 's3' });
      const local = await request(disk.getHttpServer()).get('/ready');
      expect(local.body.checks.storage).toMatchObject({ ok: true, driver: 'disk' });
    } finally {
      await ok.close();
      await bad.close();
      await disk.close();
    }
  });
});

describe('aturan driver per APP_ENV', () => {
  const base = { ...process.env, TRUST_PROXY: 'loopback', INTEGRATION_MODE: 'sandbox' };

  it('disk hanya untuk APP_ENV=local; staging dan produksi wajib s3', () => {
    expect(loadApiEnv({ ...base, APP_ENV: 'local', STORAGE_DRIVER: 'disk' }).STORAGE_DRIVER).toBe('disk');
    for (const appEnv of ['staging', 'production', '']) {
      expect(() => loadApiEnv({ ...base, APP_ENV: appEnv, STORAGE_DRIVER: 'disk' }), appEnv).toThrow(
        /STORAGE_DRIVER=disk hanya untuk APP_ENV=local/,
      );
      // Tidak disetel = disk (bawaan) → tetap ditolak di luar lokal (gagal aman).
      expect(() => loadApiEnv({ ...base, APP_ENV: appEnv, STORAGE_DRIVER: undefined }), appEnv).toThrow(
        /STORAGE_DRIVER=disk/,
      );
    }
    for (const appEnv of ['local', 'staging', 'production']) {
      const env = loadApiEnv({ ...base, APP_ENV: appEnv, STORAGE_DRIVER: 's3' });
      expect(createObjectStorage(env).driver).toBe('s3');
    }
    expect(() => loadApiEnv({ ...base, APP_ENV: 'local', S3_BUCKET_DOCUMENTS: '../rahasia' })).toThrow(
      /S3_BUCKET_DOCUMENTS/,
    );
  });
});
