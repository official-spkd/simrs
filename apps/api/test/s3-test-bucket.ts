import { createHash, randomBytes } from 'node:crypto';
import { S3Client } from '../src/infra/s3-client';

/**
 * Bucket uji sekali pakai di MinIO lokal (`docker compose up -d`): dibuat per berkas tes dan dihapus beserta isinya
 * di akhir. Hanya nama `simrs-test-<acak>` yang boleh dibersihkan, jadi bucket `simrs-documents`/`simrs-backups`
 * tidak pernah tersentuh.
 */
const TEST_BUCKET = /^simrs-test-[0-9a-f]{12}$/;

export function testS3Client(overrides: { secretAccessKey?: string } = {}): S3Client {
  return new S3Client({
    endpoint: process.env.S3_ENDPOINT ?? 'http://localhost:9000',
    region: process.env.S3_REGION ?? 'ap-southeast-3',
    accessKeyId: process.env.S3_ACCESS_KEY ?? 'simrs_local',
    secretAccessKey: overrides.secretAccessKey ?? process.env.S3_SECRET_KEY ?? 'simrs_local_secret',
  });
}

export async function createTestBucket(): Promise<string> {
  const bucket = `simrs-test-${randomBytes(6).toString('hex')}`;
  await testS3Client().send({ method: 'PUT', bucket });
  return bucket;
}

/** Semua kunci di bucket uji (ListObjectsV2, berhalaman). */
export async function listTestKeys(bucket: string): Promise<string[]> {
  if (!TEST_BUCKET.test(bucket)) throw new Error(`Menolak membaca bucket bukan uji: ${bucket}`);
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const query: Record<string, string> = { 'list-type': '2' };
    if (token) query['continuation-token'] = token;
    const xml = (await testS3Client().send({ method: 'GET', bucket, query })).body.toString('utf8');
    keys.push(...[...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => m[1] as string));
    token = /<IsTruncated>true<\/IsTruncated>/.test(xml)
      ? /<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(xml)?.[1]
      : undefined;
  } while (token);
  return keys;
}

export async function removeTestBucket(bucket: string | undefined): Promise<void> {
  if (!bucket) return;
  if (!TEST_BUCKET.test(bucket)) throw new Error(`Menolak menghapus bucket bukan uji: ${bucket}`);
  const client = testS3Client();
  for (const key of await listTestKeys(bucket)) await client.send({ method: 'DELETE', bucket, key });
  await client.send({ method: 'DELETE', bucket });
}

/** Timpa isi objek langsung di bucket uji (mensimulasikan perusakan di luar aplikasi). */
export async function overwriteTestObject(
  bucket: string,
  key: string,
  bytes: Buffer,
  opts: { checksum?: boolean } = {},
): Promise<void> {
  if (!TEST_BUCKET.test(bucket)) throw new Error(`Menolak menulis ke bucket bukan uji: ${bucket}`);
  const headers: Record<string, string> = {};
  if (opts.checksum) headers['x-amz-checksum-sha256'] = createHash('sha256').update(bytes).digest('base64');
  await testS3Client().send({ method: 'PUT', bucket, key, body: bytes, headers });
}
