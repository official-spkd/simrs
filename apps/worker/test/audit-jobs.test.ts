/**
 * P04 · Job jangkar hash audit + ringkasan harian (ADR-0072) terhadap Postgres uji dan MinIO sungguhan.
 * Bucket WORM uji sendiri (`simrs-audit-anchors-t108`, object lock aktif) dengan masa kunci 30 detik; objek yang
 * masa kuncinya habis dibersihkan di awal/akhir run (yang masih terkunci dibersihkan run berikutnya). Penyerang =
 * superuser Postgres (`asTestSuperuser`) dan pemegang kredensial bucket.
 */
import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { createPrismaClient, type PrismaClient, verifyAuditTrail, withTenant } from '@simrs/db';
import { asTestSuperuser, testDbUrls } from '@simrs/db/testing';
import { newId } from '@simrs/shared';
import { auditAnchorObjectKey, createAuditAnchorDocument } from '@simrs/shared/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { S3WormAnchorStore } from '../src/audit/anchor-store';
import { AuditAnchorJob } from '../src/audit/audit-anchor.job';
import { AuditSummaryJob } from '../src/audit/audit-summary.job';
import { md5Base64, S3Error, S3Lite, xmlValues } from '../src/audit/s3-lite';
import { loadWorkerEnv, type WorkerEnv } from '../src/config/env';

try {
  process.loadEnvFile('../../.env');
} catch {
  // opsional
}

const KEY = randomBytes(32).toString('base64');
const BUCKET = process.env.AUDIT_ANCHOR_TEST_BUCKET ?? 'simrs-audit-anchors-t108';
if (!/^simrs-audit-anchors-t[a-z0-9-]{1,30}$/.test(BUCKET)) {
  throw new Error(`Tes menolak bucket "${BUCKET}": hanya bucket uji simrs-audit-anchors-t<nama>`);
}
const hasS3 = Boolean(process.env.S3_ENDPOINT && process.env.S3_ACCESS_KEY && process.env.S3_SECRET_KEY);

let env: WorkerEnv;
let owner: PrismaClient;
let app: PrismaClient;
let s3: S3Lite;
let store: S3WormAnchorStore;
let job: AuditAnchorJob;
let dbOnlyJob: AuditAnchorJob;
let summaries: AuditSummaryJob;

/** Hapus semua versi objek di bucket uji yang masa kuncinya sudah habis (yang masih terkunci ditolak, diabaikan). */
async function purgeExpired(): Promise<void> {
  const res = await s3.send({ method: 'GET', bucket: BUCKET, query: { versions: '', 'max-keys': '1000' } });
  const xml = res.body.toString('utf8');
  for (const block of xml.match(/<(Version|DeleteMarker)>[\s\S]*?<\/(Version|DeleteMarker)>/g) ?? []) {
    const key = xmlValues(block, 'Key')[0];
    const versionId = xmlValues(block, 'VersionId')[0];
    if (!key || !versionId) continue;
    await s3.send({ method: 'DELETE', bucket: BUCKET, key, query: { versionId } }).catch(() => undefined);
  }
}

beforeAll(async () => {
  env = loadWorkerEnv({
    ...process.env,
    NODE_ENV: 'test',
    DATABASE_URL: testDbUrls().app,
    AUDIT_ANCHOR_KEY: KEY,
    AUDIT_ANCHOR_BUCKET: hasS3 ? BUCKET : '',
  });
  owner = createPrismaClient({ connectionString: testDbUrls().migrator, max: 1 });
  app = createPrismaClient({ connectionString: testDbUrls().app, max: 2 });
  if (hasS3) {
    s3 = new S3Lite({
      endpoint: env.S3_ENDPOINT ?? '',
      region: env.S3_REGION,
      accessKeyId: env.S3_ACCESS_KEY ?? '',
      secretAccessKey: env.S3_SECRET_KEY ?? '',
    });
    await s3
      .send({ method: 'PUT', bucket: BUCKET, headers: { 'x-amz-bucket-object-lock-enabled': 'true' } })
      .catch((err: unknown) => {
        if (!(err instanceof S3Error && /BucketAlready(OwnedByYou|Exists)/.test(err.code))) throw err;
      });
    await purgeExpired();
    store = new S3WormAnchorStore(s3, { bucket: BUCKET, retentionMs: 30_000 });
    await store.assertWorm();
  }
  job = new AuditAnchorJob(env, hasS3 ? store : null);
  dbOnlyJob = new AuditAnchorJob(env, null);
  summaries = new AuditSummaryJob(env);
});

afterAll(async () => {
  if (hasS3) await purgeExpired().catch(() => undefined);
  await job?.onModuleDestroy();
  await dbOnlyJob?.onModuleDestroy();
  await summaries?.onModuleDestroy();
  await owner?.$disconnect();
  await app?.$disconnect();
});

async function freshTenant(events: number): Promise<string> {
  const id = newId();
  await withTenant(owner, id, (tx) =>
    tx.tenant.create({ data: { id, code: `WRM${id.slice(-8).toUpperCase()}`, name: 'RS Fiktif Uji WORM' } }),
  );
  for (let i = 0; i < events; i++) {
    await withTenant(app, id, (tx) =>
      tx.auditEvent.create({ data: { id: newId(), tenantId: id, resourceType: 'test', action: 'read' } }),
    );
  }
  return id;
}

const anchorsOf = (T: string) =>
  withTenant(app, T, (tx) =>
    tx.auditAnchor.findMany({
      orderBy: { seq: 'asc' },
      select: { seq: true, objectKey: true, source: true, hmac: true, anchoredAt: true },
    }),
  );

const verify = (T: string) =>
  withTenant(app, T, (tx) => verifyAuditTrail(tx, { tenantId: T, anchorKeyB64: KEY, mode: 'checkpoint' }));

describe.skipIf(!hasS3)('jangkar audit ke bucket WORM', () => {
  it('job menulis jangkar ke database dan bucket (COMPLIANCE); dijalankan ulang tidak menggandakan', async () => {
    const T = await freshTenant(3);
    const first = await job.runOnce({ tenantIds: [T] });
    expect(first).toMatchObject({ tenants: 1, anchored: 1, failed: 0 });
    expect(first.results[0]).toMatchObject({ anchoredSeq: '3', issues: [], restored: 0, invalidWorm: 0 });

    const [row] = await anchorsOf(T);
    expect(row).toMatchObject({ seq: 3n, source: 'job', objectKey: auditAnchorObjectKey(T, 3n) });
    const stored = await store.get(row?.objectKey ?? '');
    expect(stored).toMatchObject({ tenantId: T, seq: '3', hmac: row?.hmac });
    expect(stored?.anchoredAt).toBe(row?.anchoredAt.toISOString());

    const again = await job.runOnce({ tenantIds: [T] });
    expect(again.results[0]).toMatchObject({ anchoredSeq: null, skipped: 'unchanged', restored: 0 });
    expect(await anchorsOf(T)).toHaveLength(1);
    expect(await store.listAfter(T, null)).toEqual([auditAnchorObjectKey(T, 3n)]);
  });

  it('objek WORM tidak bisa ditimpa atau dihapus; versi palsu dan penanda hapus tidak mengubah isi jangkar', async () => {
    const T = await freshTenant(2);
    await job.runOnce({ tenantIds: [T] });
    const key = auditAnchorObjectKey(T, 2n);
    const original = await store.get(key);
    if (!original) throw new Error('objek jangkar tidak ada');

    // Penulisan ulang oleh job (If-None-Match) ditolak server → "exists", isi lama dikembalikan.
    const rewrite = await store.put({ ...original, anchoredAt: new Date().toISOString() });
    expect(rewrite).toMatchObject({ status: 'exists', stored: original });

    // Pemegang kredensial bucket menimpa paksa: menjadi versi baru, versi pertama tetap utuh dan terkunci.
    const forged = Buffer.from(JSON.stringify({ ...original, hash: 'f'.repeat(64) }));
    await s3.send({
      method: 'PUT',
      bucket: BUCKET,
      key,
      body: forged,
      headers: { 'content-type': 'application/json', 'content-md5': md5Base64(forged) },
    });
    expect(await store.get(key)).toEqual(original);

    const versions = await s3.send({ method: 'GET', bucket: BUCKET, query: { versions: '', prefix: key } });
    const ids = xmlValues(versions.body.toString('utf8'), 'VersionId');
    const firstVersion = ids.at(-1) ?? '';
    expect(ids).toHaveLength(2);
    const retention = await s3.send({
      method: 'GET',
      bucket: BUCKET,
      key,
      query: { retention: '', versionId: firstVersion },
    });
    expect(xmlValues(retention.body.toString('utf8'), 'Mode')).toEqual(['COMPLIANCE']);
    await expect(
      s3.send({ method: 'DELETE', bucket: BUCKET, key, query: { versionId: firstVersion } }),
    ).rejects.toBeInstanceOf(S3Error);
    // Hapus tanpa versi hanya menambah penanda hapus; jangkar tetap terdaftar dan terbaca.
    await s3.send({ method: 'DELETE', bucket: BUCKET, key });
    expect(await store.listAfter(T, null)).toEqual([key]);
    expect(await store.get(key)).toEqual(original);
  });

  it('ekor rantai + baris jangkar dihapus superuser → job memulihkan jangkar dari WORM → TRUNCATION_DETECTED', async () => {
    const T = await freshTenant(5);
    await job.runOnce({ tenantIds: [T] });
    await asTestSuperuser(async (tx) => {
      await tx.$executeRaw`DELETE FROM audit_events WHERE tenant_id = ${T}::uuid AND seq = 5`;
      await tx.$executeRaw`DELETE FROM audit_anchors WHERE tenant_id = ${T}::uuid`;
    });
    // Tanpa salinan WORM, database saja tampak utuh.
    expect((await verify(T)).intact).toBe(true);

    const run = await job.runOnce({ tenantIds: [T] });
    expect(run.results[0]).toMatchObject({ restored: 1, anchoredSeq: null, skipped: 'unchanged' });
    expect(run.results[0]?.issues).toEqual(['TRUNCATION_DETECTED']);
    expect(await anchorsOf(T)).toEqual([expect.objectContaining({ seq: 5n, source: 'worm' })]);
    const v = await verify(T);
    expect(v.intact).toBe(false);
    expect(v.issues).toContainEqual(expect.objectContaining({ code: 'TRUNCATION_DETECTED', seq: 5n }));
  });

  it('objek palsu di bucket (tanda tangan salah) tidak dipulihkan dan dilaporkan', async () => {
    const T = await freshTenant(2);
    await job.runOnce({ tenantIds: [T] });
    const fake = createAuditAnchorDocument(
      { tenantId: T, seq: '50', hash: 'd'.repeat(64), anchoredAt: new Date().toISOString() },
      randomBytes(32).toString('base64'),
    );
    await store.put(fake);
    const run = await job.runOnce({ tenantIds: [T] });
    expect(run.results[0]).toMatchObject({ invalidWorm: 1, restored: 0 });
    expect((await anchorsOf(T)).map((a) => a.seq)).toEqual([2n]);
  });

  it('isolasi tenant: objek dan baris jangkar per tenant', async () => {
    const A = await freshTenant(2);
    const B = await freshTenant(4);
    const run = await job.runOnce({ tenantIds: [A, B] });
    expect(run.anchored).toBe(2);
    expect(await store.listAfter(A, null)).toEqual([auditAnchorObjectKey(A, 2n)]);
    expect(await store.listAfter(B, null)).toEqual([auditAnchorObjectKey(B, 4n)]);
    expect((await anchorsOf(A)).map((a) => a.seq)).toEqual([2n]);
    expect((await anchorsOf(B)).map((a) => a.seq)).toEqual([4n]);
  });
});

describe('job jangkar tanpa bucket dan ringkasan harian', () => {
  it('tanpa bucket: jangkar hanya di database; tanpa kunci: job tidak berjalan', async () => {
    const T = await freshTenant(2);
    const run = await dbOnlyJob.runOnce({ tenantIds: [T] });
    expect(run.anchored).toBe(1);
    expect(await anchorsOf(T)).toEqual([
      expect.objectContaining({ seq: 2n, objectKey: null, source: 'job' }),
    ]);

    const noKey = new AuditAnchorJob({ ...env, AUDIT_ANCHOR_KEY: undefined }, null);
    try {
      expect(noKey.enabled).toBe(false);
      expect(await noKey.runOnce({ tenantIds: [T] })).toEqual({
        tenants: 0,
        anchored: 0,
        failed: 0,
        results: [],
      });
    } finally {
      await noKey.onModuleDestroy();
    }
  });

  it('ringkasan harian: menulis hari yang sudah final, idempoten bila dijalankan ulang', async () => {
    const T = await freshTenant(1);
    const first = await summaries.runOnce({ tenantIds: [T], maxDays: 100 });
    expect(first.failed).toBe(0);
    expect(first.created).toBeGreaterThanOrEqual(88);
    const count = await withTenant(app, T, (tx) => tx.auditDailySummary.count());
    expect(count).toBe(first.created);
    expect(await summaries.runOnce({ tenantIds: [T], maxDays: 100 })).toEqual({
      tenants: 1,
      created: 0,
      failed: 0,
    });
    // Batas per putaran: tenant baru dengan maxDays 5 hanya menulis 5 hari (terbaru dulu).
    const U = await freshTenant(0);
    expect((await summaries.runOnce({ tenantIds: [U], maxDays: 5 })).created).toBe(5);
  });

  it('env: produksi wajib kunci + bucket; bucket wajib kredensial S3; kunci jangkar ≠ kunci kolom', () => {
    const base = {
      DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
      REDIS_URL: 'redis://127.0.0.1:1',
      FIELD_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
      FIELD_HASH_KEY: Buffer.alloc(32, 2).toString('base64'),
    };
    const key = Buffer.alloc(32, 3).toString('base64');
    const s3Env = { S3_ENDPOINT: 'http://localhost:9000', S3_ACCESS_KEY: 'a', S3_SECRET_KEY: 'b' };
    expect(() => loadWorkerEnv({ ...base, APP_ENV: 'production' })).toThrow(/AUDIT_ANCHOR_KEY wajib/);
    expect(() => loadWorkerEnv({ ...base, APP_ENV: 'production', AUDIT_ANCHOR_KEY: key })).toThrow(
      /AUDIT_ANCHOR_BUCKET wajib/,
    );
    expect(() =>
      loadWorkerEnv({
        ...base,
        APP_ENV: 'local',
        AUDIT_ANCHOR_KEY: key,
        AUDIT_ANCHOR_BUCKET: 'simrs-audit-anchors',
      }),
    ).toThrow(/butuh S3_ENDPOINT/);
    expect(() => loadWorkerEnv({ ...base, APP_ENV: 'local', AUDIT_ANCHOR_KEY: base.FIELD_HASH_KEY })).toThrow(
      /harus berbeda/,
    );
    const ok = loadWorkerEnv({
      ...base,
      ...s3Env,
      APP_ENV: 'production',
      AUDIT_ANCHOR_KEY: key,
      AUDIT_ANCHOR_BUCKET: 'simrs-audit-anchors',
    });
    expect(ok.AUDIT_ANCHOR_RETENTION_DAYS).toBe(3650);
    expect(loadWorkerEnv({ ...base, APP_ENV: 'local' }).AUDIT_ANCHOR_KEY).toBeUndefined();
  });
});
