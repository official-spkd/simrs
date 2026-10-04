/**
 * P08 · API dokumen dengan driver `s3` terhadap MinIO lokal, di bucket uji sekali pakai (dibuat dan dihapus di sini;
 * `simrs-documents` tidak disentuh). Isi tes bersama di `documents.suite.ts`, ditambah perilaku khusus S3: kunci
 * berawalan tenant, checksum objek = hash di DB, unduhan besar di-stream, perusakan tanpa checksum, objek hilang.
 */
import { MAX_DOCUMENT_BYTES } from '@simrs/shared';
import { sha256Hex } from '@simrs/shared/node';
import { describe, expect, it } from 'vitest';
import { auth, documentsSuite, http, PDF, storageKeyOf, tenantId, upload } from './documents.suite';
import {
  createTestBucket,
  listTestKeys,
  overwriteTestObject,
  removeTestBucket,
  testS3Client,
} from './s3-test-bucket';

let bucket: string;

documentsSuite({
  driver: 's3',
  before: async () => {
    bucket = await createTestBucket();
  },
  after: () => removeTestBucket(bucket),
  env: () => ({ STORAGE_DRIVER: 's3', S3_BUCKET_DOCUMENTS: bucket }),
  tamper: (key, bytes) => overwriteTestObject(bucket, key, bytes, { checksum: true }),
});

describe('khusus driver s3', () => {
  it('kunci berawalan tenant; checksum objek di MinIO = hash di DB; /ready memeriksa bucket', async () => {
    const doc = (await upload('dokter', PDF).expect(201)).body;
    const key = await storageKeyOf(doc.id);
    expect(key).toMatch(new RegExp(`^${tenantId()}/\\d{4}/\\d{2}/${doc.id}$`));
    expect(await listTestKeys(bucket)).toContain(key);
    const head = await testS3Client().send({
      method: 'HEAD',
      bucket,
      key,
      headers: { 'x-amz-checksum-mode': 'ENABLED' },
    });
    expect(Buffer.from(head.headers['x-amz-checksum-sha256'] as string, 'base64').toString('hex')).toBe(
      doc.sha256,
    );
    const ready = await http().get('/ready');
    expect(ready.body.checks.storage).toMatchObject({ ok: true });
  });

  it('unduhan besar di-stream utuh dengan Content-Length', async () => {
    const big = Buffer.alloc(MAX_DOCUMENT_BYTES - 1024, 0x20);
    PDF.copy(big);
    const doc = (await upload('dokter', big, { title: 'Hasil pindai besar' }).expect(201)).body;
    const res = await http()
      .get(`/api/v1/documents/${doc.id}/content`)
      .set(auth('dokter'))
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(res.headers['content-length']).toBe(String(big.length));
    expect(sha256Hex(res.body as Buffer)).toBe(sha256Hex(big));
  });

  it('objek ditimpa tanpa checksum atau hilang dari bucket → ditahan (DOCUMENT_INTEGRITY)', async () => {
    const doc = (await upload('dokter', PDF).expect(201)).body;
    const key = await storageKeyOf(doc.id);
    // Ukuran sama, isi beda, tanpa checksum penyimpanan: dibaca utuh lalu di-hash sebelum dikirim.
    const forged = Buffer.from(PDF);
    forged[forged.length - 2] = 0x21;
    await overwriteTestObject(bucket, key, forged);
    const tampered = await http().get(`/api/v1/documents/${doc.id}/content`).set(auth('dokter')).expect(500);
    expect(tampered.body.code).toBe('DOCUMENT_INTEGRITY');

    const gone = (await upload('dokter', PDF).expect(201)).body;
    await testS3Client().send({ method: 'DELETE', bucket, key: await storageKeyOf(gone.id) });
    const missing = await http().get(`/api/v1/documents/${gone.id}/content`).set(auth('dokter')).expect(500);
    expect(missing.body).toMatchObject({ code: 'DOCUMENT_INTEGRITY' });
    expect(missing.body.message).toContain('tidak ditemukan');
  });
});
