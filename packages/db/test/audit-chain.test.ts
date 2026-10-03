/**
 * P04: hash berantai audit (DoD fase 1: "hash berantai terverifikasi oleh tes").
 * Tes berjalan sebagai simrs_app; simulasi perusakan memakai pemilik tabel (migrator) yang mematikan trigger.
 */
import { newId } from '@simrs/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient, type PrismaClient, verifyAuditChain, withTenant } from '../src/index';
import { SEED_TENANTS } from '../src/seed-data';
import { testDbUrls } from '../src/testing';

const [A, B] = SEED_TENANTS;
let app: PrismaClient;
let owner: PrismaClient;

beforeAll(() => {
  app = createPrismaClient({ connectionString: testDbUrls().app, max: 8 });
  owner = createPrismaClient({ connectionString: testDbUrls().migrator, max: 2 });
});

afterAll(async () => {
  await app.$disconnect();
  await owner.$disconnect();
});

function event(tenantId: string, action = 'read') {
  return { id: newId(), tenantId, resourceType: 'test', action, details: { n: 1 } };
}

describe('rantai audit', () => {
  it('seq berurutan tanpa celah walau ditulis paralel, dan rantai terverifikasi', async () => {
    await Promise.all(
      Array.from({ length: 12 }, () =>
        withTenant(app, A.id, (tx) => tx.auditEvent.create({ data: event(A.id) })),
      ),
    );
    const rows = await withTenant(app, A.id, (tx) =>
      tx.auditEvent.findMany({ orderBy: { seq: 'asc' }, select: { seq: true, prevHash: true, hash: true } }),
    );
    rows.forEach((r, i) => {
      expect(r.seq).toBe(BigInt(i + 1));
      expect(r.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(r.prevHash).toBe(i === 0 ? null : rows[i - 1]?.hash);
    });
    expect(await withTenant(app, A.id, (tx) => verifyAuditChain(tx))).toEqual({
      checked: rows.length,
      firstBrokenSeq: null,
    });
  });

  it('waktu, urutan, dan hash dari server menimpa nilai kiriman aplikasi', async () => {
    const forged = await withTenant(app, A.id, (tx) =>
      tx.auditEvent.create({
        data: {
          ...event(A.id),
          seq: 999_999n,
          hash: 'palsu',
          prevHash: 'palsu',
          occurredAt: new Date('2000-01-01'),
        },
      }),
    );
    expect(forged.seq).not.toBe(999_999n);
    expect(forged.hash).not.toBe('palsu');
    expect(forged.occurredAt.getUTCFullYear()).toBeGreaterThan(2020);
  });

  it('rantai tiap tenant terpisah', async () => {
    await withTenant(app, B.id, (tx) => tx.auditEvent.create({ data: event(B.id) }));
    const result = await withTenant(app, B.id, (tx) => verifyAuditChain(tx));
    expect(result.firstBrokenSeq).toBeNull();
    expect(result.checked).toBeGreaterThan(0);
  });

  it('baris yang diubah langsung di database terdeteksi', async () => {
    // Tenant khusus tes ini agar tenant lain tidak ikut "rusak".
    const T = { id: newId(), code: `AUD${Date.now()}`, name: 'RS Fiktif Uji Audit' };
    await withTenant(owner, T.id, (tx) => tx.tenant.create({ data: T }));
    for (let i = 0; i < 3; i++)
      await withTenant(app, T.id, (tx) => tx.auditEvent.create({ data: event(T.id) }));
    expect((await withTenant(app, T.id, (tx) => verifyAuditChain(tx))).firstBrokenSeq).toBeNull();

    // Penyerang dengan hak pemilik tabel mematikan trigger lalu mengubah baris ke-2.
    await withTenant(owner, T.id, async (tx) => {
      await tx.$executeRawUnsafe('ALTER TABLE audit_events DISABLE TRIGGER audit_events_append_only');
      await tx.$executeRaw`UPDATE audit_events SET action = 'dihapus-diam-diam' WHERE tenant_id = ${T.id}::uuid AND seq = 2`;
      await tx.$executeRawUnsafe('ALTER TABLE audit_events ENABLE TRIGGER audit_events_append_only');
    });
    expect(await withTenant(app, T.id, (tx) => verifyAuditChain(tx))).toEqual({
      checked: 2,
      firstBrokenSeq: 2n,
    });
  });
});
