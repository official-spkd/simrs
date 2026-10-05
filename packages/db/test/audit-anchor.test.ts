/**
 * P04 · Jangkar hash audit + titik periksa (ADR-0072). Penyerang disimulasikan sebagai superuser Postgres yang
 * mematikan trigger (`asTestSuperuser`): bisa menghapus ekor rantai, menulis ulang rantai dengan hash yang dihitung
 * ulang, atau mengubah baris jangkar. Semua harus ketahuan; tenant lain tidak ikut terpengaruh.
 */
import { randomBytes } from 'node:crypto';
import { newId } from '@simrs/shared';
import { auditAnchorObjectKey, createAuditAnchorDocument } from '@simrs/shared/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createPrismaClient,
  prepareAuditAnchor,
  type PrismaClient,
  recordAuditAnchor,
  verifyAuditChain,
  verifyAuditTrail,
  withTenant,
} from '../src/index';
import { asTestSuperuser, testDbUrls } from '../src/testing';

let app: PrismaClient;
let owner: PrismaClient;
const KEY = randomBytes(32).toString('base64');
const OTHER_KEY = randomBytes(32).toString('base64');

beforeAll(() => {
  app = createPrismaClient({ connectionString: testDbUrls().app, max: 4 });
  owner = createPrismaClient({ connectionString: testDbUrls().migrator, max: 2 });
});

afterAll(async () => {
  await app.$disconnect();
  await owner.$disconnect();
});

/** Tenant fiktif baru per tes: rantai dan jangkarnya tidak bercampur dengan tes lain. */
async function freshTenant(): Promise<string> {
  const id = newId();
  await withTenant(owner, id, (tx) =>
    tx.tenant.create({
      data: { id, code: `ANC${id.slice(-8).toUpperCase()}`, name: 'RS Fiktif Uji Jangkar' },
    }),
  );
  return id;
}

async function addEvents(tenantId: string, n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    await withTenant(app, tenantId, (tx) =>
      tx.auditEvent.create({
        data: { id: newId(), tenantId, resourceType: 'test', action: 'read', details: { i } },
      }),
    );
  }
}

async function anchor(tenantId: string, key = KEY) {
  const prepared = await withTenant(app, tenantId, (tx) =>
    prepareAuditAnchor(tx, { tenantId, anchorKeyB64: key }),
  );
  const doc = prepared.document;
  const recorded = doc
    ? await withTenant(app, tenantId, (tx) => recordAuditAnchor(tx, doc, { objectKey: null }))
    : false;
  return { prepared, recorded };
}

const verify = (tenantId: string, mode: 'checkpoint' | 'full', key: string | null = KEY) =>
  withTenant(app, tenantId, (tx) => verifyAuditTrail(tx, { tenantId, anchorKeyB64: key, mode }));

const codes = (v: { issues: Array<{ code: string }> }) => v.issues.map((i) => i.code);

describe('jangkar hash audit', () => {
  it('menjangkar kepala yang terverifikasi; idempoten; pemeriksaan titik periksa hanya menghitung ulang sejak jangkar', async () => {
    const T = await freshTenant();
    expect((await anchor(T)).prepared.skipped).toBe('empty');
    await addEvents(T, 5);

    const first = await anchor(T);
    expect(first.prepared.document).toMatchObject({ tenantId: T, seq: '5', v: 1 });
    expect(first.recorded).toBe(true);
    // Dijalankan ulang tanpa entri baru: tidak ada jangkar kedua.
    expect((await anchor(T)).prepared.skipped).toBe('unchanged');
    // Dokumen yang sama dicatat ulang (mis. job diulang setelah gagal di tengah): tidak menggandakan.
    const again = first.prepared.document;
    if (!again) throw new Error('dokumen jangkar kosong');
    expect(await withTenant(app, T, (tx) => recordAuditAnchor(tx, again, { objectKey: null }))).toBe(false);

    await addEvents(T, 3);
    const cp = await verify(T, 'checkpoint');
    expect(cp).toMatchObject({ intact: true, mode: 'checkpoint', checked: 4, issueCount: 0 });
    expect(cp.checkpoint?.seq).toBe(5n);
    expect(cp.anchors).toMatchObject({ total: 1, verified: 1, keyConfigured: true, latestSeq: 5n });
    const full = await verify(T, 'full');
    expect(full).toMatchObject({ intact: true, mode: 'full', checked: 8 });

    await anchor(T);
    const rows = await withTenant(app, T, (tx) =>
      tx.auditAnchor.findMany({ orderBy: { seq: 'asc' }, select: { seq: true, source: true } }),
    );
    expect(rows).toEqual([
      { seq: 5n, source: 'job' },
      { seq: 8n, source: 'job' },
    ]);
    expect((await verify(T, 'checkpoint')).checked).toBe(1);
  });

  it('baris audit TERAKHIR dihapus superuser → TRUNCATION_DETECTED (titik periksa maupun penuh)', async () => {
    const T = await freshTenant();
    await addEvents(T, 4);
    await anchor(T);
    // Rantai tanpa jangkar tetap "utuh" setelah ekornya dipotong: celah yang ditutup jangkar.
    await asTestSuperuser(
      (tx) => tx.$executeRaw`DELETE FROM audit_events WHERE tenant_id = ${T}::uuid AND seq = 4`,
    );
    expect(await withTenant(app, T, (tx) => verifyAuditChain(tx))).toEqual({
      checked: 3,
      firstBrokenSeq: null,
    });

    for (const mode of ['checkpoint', 'full'] as const) {
      const v = await verify(T, mode);
      expect(v.intact).toBe(false);
      expect(v.issues).toContainEqual(expect.objectContaining({ code: 'TRUNCATION_DETECTED', seq: 4n }));
      expect(v.head?.seq).toBe(3n);
    }
    // Penjangkaran tidak "memutihkan" pemotongan: kepala di bawah jangkar sah tidak dijangkar ulang.
    expect((await anchor(T)).prepared.skipped).toBe('unchanged');

    // Ekor dipotong lalu ditambah entri baru (seq yang sama, hash lain) → tetap ketahuan.
    await addEvents(T, 2);
    expect(codes(await verify(T, 'checkpoint'))).toContain('ANCHOR_MISMATCH');
  });

  it('rantai ditulis ulang dengan hash dihitung ulang: rantai tampak utuh, jangkar membongkarnya', async () => {
    const T = await freshTenant();
    await addEvents(T, 4);
    await anchor(T);
    await asTestSuperuser(async (tx) => {
      await tx.$executeRaw`UPDATE audit_events SET action = 'dihapus-diam-diam' WHERE tenant_id = ${T}::uuid AND seq = 2`;
      // Hitung ulang hash berantai mulai seq 2 (penyerang tahu algoritmanya; hash rantai tidak berkunci).
      for (const seq of [2, 3, 4]) {
        await tx.$executeRaw`
          UPDATE audit_events e SET prev_hash = (SELECT hash FROM audit_events p WHERE p.tenant_id = e.tenant_id AND p.seq = e.seq - 1)
          WHERE e.tenant_id = ${T}::uuid AND e.seq = ${seq}`;
        await tx.$executeRaw`
          UPDATE audit_events e SET hash = app_audit_hash(e) WHERE e.tenant_id = ${T}::uuid AND e.seq = ${seq}`;
      }
    });
    expect((await withTenant(app, T, (tx) => verifyAuditChain(tx))).firstBrokenSeq).toBeNull();
    const v = await verify(T, 'full');
    expect(v.intact).toBe(false);
    expect(codes(v)).toEqual(['ANCHOR_MISMATCH']);
    // Rantai yang ditulis ulang tidak pernah dijangkar ulang di seq yang sama.
    expect((await anchor(T)).prepared.skipped).toBe('unchanged');
  });

  it('baris jangkar dirusak (seq diturunkan / hash diganti) → ANCHOR_TAMPERED; kunci lain → ANCHOR_KEY_UNKNOWN', async () => {
    const T = await freshTenant();
    await addEvents(T, 3);
    await anchor(T);
    await addEvents(T, 3);
    await anchor(T);
    // Penyerang menurunkan seq jangkar terakhir agar pemotongan ekor tidak ketahuan.
    await asTestSuperuser(async (tx) => {
      await tx.$executeRaw`DELETE FROM audit_events WHERE tenant_id = ${T}::uuid AND seq IN (5, 6)`;
      await tx.$executeRaw`
        UPDATE audit_anchors SET seq = 4, hash = (SELECT hash FROM audit_events WHERE tenant_id = ${T}::uuid AND seq = 4)
        WHERE tenant_id = ${T}::uuid AND seq = 6`;
    });
    const v = await verify(T, 'checkpoint');
    expect(v.intact).toBe(false);
    expect(v.issues).toContainEqual(expect.objectContaining({ code: 'ANCHOR_TAMPERED', seq: 4n }));
    // Jangkar sah sebelumnya tetap menjadi titik periksa.
    expect(v.checkpoint?.seq).toBe(3n);

    const other = await verify(T, 'checkpoint', OTHER_KEY);
    expect(new Set(codes(other))).toEqual(new Set(['ANCHOR_KEY_UNKNOWN']));
    expect(other.checkpoint).toBeNull();
  });

  it('jangkar palsu bernomor besar tidak menghentikan penjangkaran berikutnya', async () => {
    const T = await freshTenant();
    await addEvents(T, 2);
    await anchor(T);
    const forged = createAuditAnchorDocument(
      { tenantId: T, seq: '999', hash: 'a'.repeat(64), anchoredAt: new Date().toISOString() },
      OTHER_KEY,
    );
    await withTenant(app, T, (tx) => recordAuditAnchor(tx, forged, { objectKey: null }));
    await addEvents(T, 1);
    const next = await anchor(T);
    expect(next.prepared.document?.seq).toBe('3');
    expect(codes(await verify(T, 'checkpoint'))).toEqual(['ANCHOR_KEY_UNKNOWN']);
  });

  it('perubahan mentah SEBELUM titik periksa hanya tertangkap pemeriksaan penuh (dokumentasi trade-off)', async () => {
    const T = await freshTenant();
    await addEvents(T, 4);
    await anchor(T);
    await asTestSuperuser(
      (tx) =>
        tx.$executeRaw`UPDATE audit_events SET action = 'diubah' WHERE tenant_id = ${T}::uuid AND seq = 2`,
    );
    expect((await verify(T, 'checkpoint')).intact).toBe(true);
    const full = await verify(T, 'full');
    expect(full).toMatchObject({ intact: false, firstBrokenSeq: 2n });
    expect(codes(full)).toEqual(['CHAIN_BROKEN']);
  });

  it('tanpa kunci jangkar: selalu pemeriksaan penuh, jangkar tidak dinilai', async () => {
    const T = await freshTenant();
    await addEvents(T, 2);
    await anchor(T);
    const v = await verify(T, 'checkpoint', null);
    expect(v).toMatchObject({ intact: true, mode: 'full', checked: 2, checkpoint: null });
    expect(v.anchors).toMatchObject({ total: 1, verified: 0, keyConfigured: false });
  });

  it('isolasi tenant: jangkar tenant lain tidak terlihat dan tidak bisa ditulis atas nama tenant lain', async () => {
    const A = await freshTenant();
    const B = await freshTenant();
    await addEvents(A, 2);
    await anchor(A);
    expect(await withTenant(app, B, (tx) => tx.auditAnchor.count())).toBe(0);
    expect(await withTenant(app, A, (tx) => tx.auditAnchor.count())).toBe(1);
    const docA = createAuditAnchorDocument(
      { tenantId: A, seq: '7', hash: 'b'.repeat(64), anchoredAt: new Date().toISOString() },
      KEY,
    );
    await expect(
      withTenant(app, B, (tx) => recordAuditAnchor(tx, docA, { objectKey: null })),
    ).rejects.toThrow();
    expect((await verify(B, 'checkpoint')).anchors.total).toBe(0);
  });

  it('jangkar append-only; kunci objek dan waktu dijaga database', async () => {
    const T = await freshTenant();
    await addEvents(T, 1);
    await anchor(T);
    await expect(
      withTenant(app, T, (tx) => tx.$executeRaw`UPDATE audit_anchors SET source = 'worm'`),
    ).rejects.toThrow();
    await expect(withTenant(app, T, (tx) => tx.$executeRaw`DELETE FROM audit_anchors`)).rejects.toThrow();
    await expect(
      withTenant(owner, T, (tx) => tx.$executeRaw`DELETE FROM audit_anchors WHERE tenant_id = ${T}::uuid`),
    ).rejects.toThrow(/APPEND_ONLY/);

    const doc = (seq: string, at = new Date()) =>
      createAuditAnchorDocument(
        { tenantId: T, seq, hash: 'c'.repeat(64), anchoredAt: at.toISOString() },
        KEY,
      );
    await expect(
      withTenant(app, T, (tx) =>
        recordAuditAnchor(tx, doc('20'), { objectKey: auditAnchorObjectKey(T, 20n) }),
      ),
    ).resolves.toBe(true);
    await expect(
      withTenant(app, T, (tx) =>
        tx.auditAnchor.create({
          data: { ...rowOf(doc('21')), objectKey: auditAnchorObjectKey(T, 22n) },
        }),
      ),
    ).rejects.toThrow();
    await expect(
      withTenant(app, T, (tx) =>
        recordAuditAnchor(tx, doc('23', new Date(Date.now() + 3_600_000)), { objectKey: null }),
      ),
    ).rejects.toThrow(/AUDIT_ANCHOR_FUTURE/);
  });
});

function rowOf(doc: ReturnType<typeof createAuditAnchorDocument>) {
  return {
    id: newId(),
    tenantId: doc.tenantId,
    seq: BigInt(doc.seq),
    hash: doc.hash,
    anchoredAt: new Date(doc.anchoredAt),
    keyId: doc.keyId,
    hmac: doc.hmac,
  };
}
