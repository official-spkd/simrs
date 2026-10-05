/**
 * P04: hash berantai audit (DoD fase 1: "hash berantai terverifikasi oleh tes").
 * Tes berjalan sebagai simrs_app; simulasi perusakan memakai pemilik tabel (migrator) yang mematikan trigger.
 * Setiap tes memakai tenant fiktif baru: rantai tenant seed (RSFA/RSFB) ikut ditulis tes lain dan proses lain yang
 * memakai database tes yang sama (API, E2E), sehingga jumlah baris di antara dua transaksi bisa berubah.
 */
import { newId } from '@simrs/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient, type PrismaClient, verifyAuditChain, withTenant } from '../src/index';
import { testDbUrls } from '../src/testing';

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

/** Tenant fiktif baru (dibuat pemilik tabel `tenants`); hanya tes ini yang menulis rantainya. */
async function freshTenant(): Promise<string> {
  const id = newId();
  await withTenant(owner, id, (tx) =>
    tx.tenant.create({ data: { id, code: `AUD${id.slice(-8).toUpperCase()}`, name: 'RS Fiktif Uji Audit' } }),
  );
  return id;
}

describe('rantai audit', () => {
  it('seq berurutan tanpa celah walau ditulis paralel, dan rantai terverifikasi', async () => {
    const A = await freshTenant();
    await Promise.all(
      Array.from({ length: 12 }, () => withTenant(app, A, (tx) => tx.auditEvent.create({ data: event(A) }))),
    );
    const rows = await withTenant(app, A, (tx) =>
      tx.auditEvent.findMany({ orderBy: { seq: 'asc' }, select: { seq: true, prevHash: true, hash: true } }),
    );
    expect(rows).toHaveLength(12);
    rows.forEach((r, i) => {
      expect(r.seq).toBe(BigInt(i + 1));
      expect(r.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(r.prevHash).toBe(i === 0 ? null : rows[i - 1]?.hash);
    });
    expect(await withTenant(app, A, (tx) => verifyAuditChain(tx))).toEqual({
      checked: 12,
      firstBrokenSeq: null,
    });
  });

  it('waktu, urutan, dan hash dari server menimpa nilai kiriman aplikasi', async () => {
    const A = await freshTenant();
    const forged = await withTenant(app, A, (tx) =>
      tx.auditEvent.create({
        data: {
          ...event(A),
          seq: 999_999n,
          hash: 'palsu',
          prevHash: 'palsu',
          occurredAt: new Date('2000-01-01'),
        },
      }),
    );
    expect(forged.seq).toBe(1n);
    expect(forged.hash).not.toBe('palsu');
    expect(forged.prevHash).toBeNull();
    expect(forged.occurredAt.getUTCFullYear()).toBeGreaterThan(2020);
  });

  it('rantai tiap tenant terpisah: ditulis bersamaan, masing-masing mulai dari seq 1', async () => {
    const [P, Q] = [await freshTenant(), await freshTenant()];
    await Promise.all(
      [P, P, Q, P, Q].map((t) => withTenant(app, t, (tx) => tx.auditEvent.create({ data: event(t) }))),
    );
    expect(await withTenant(app, P, (tx) => verifyAuditChain(tx))).toEqual({
      checked: 3,
      firstBrokenSeq: null,
    });
    expect(await withTenant(app, Q, (tx) => verifyAuditChain(tx))).toEqual({
      checked: 2,
      firstBrokenSeq: null,
    });
  });

  it('baris yang diubah langsung di database terdeteksi', async () => {
    // Tenant khusus tes ini agar tenant lain tidak ikut "rusak".
    const T = { id: await freshTenant() };
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
