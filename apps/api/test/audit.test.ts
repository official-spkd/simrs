import type { NestExpressApplication } from '@nestjs/platform-express';
import { createPrismaClient, type PrismaClient, withTenant } from '@simrs/db';
import { testDbUrls } from '@simrs/db/testing';
import { newId } from '@simrs/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TenantDb } from '../src/infra/tenant-db';
import { createTestApp, TENANT_A, TENANT_B } from './helpers';

let app: NestExpressApplication;
let db: PrismaClient;
const http = () => request(app.getHttpServer());

beforeAll(async () => {
  app = await createTestApp();
  db = createPrismaClient({ connectionString: testDbUrls().app, max: 2 });
});

afterAll(async () => {
  await app?.close();
  await db?.$disconnect();
});

function auditByRequest(tenantId: string, requestId: string) {
  return withTenant(db, tenantId, (tx) => tx.auditEvent.findMany({ where: { requestId } }));
}

describe('@Audited dalam transaksi permintaan', () => {
  it('aksi berhasil tercatat sekali dengan request id, sumber, dan id hasil', async () => {
    const requestId = `uji-${newId()}`;
    const res = await http()
      .post('/api/v1/dev/outbox-ping')
      .set('X-Tenant-Id', TENANT_A)
      .set('X-Request-Id', requestId)
      .send({ target: 'satusehat' })
      .expect(201);
    const rows = await auditByRequest(TENANT_A, requestId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: 'create',
      resourceType: 'outbox_message',
      resourceId: res.body.id,
      outcome: 'success',
      tenantId: TENANT_A,
    });
    expect(rows[0]?.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('permintaan gagal tidak meninggalkan data maupun audit (satu transaksi)', async () => {
    const requestId = `uji-${newId()}`;
    await http()
      .post('/api/v1/dev/outbox-ping')
      .set('X-Tenant-Id', TENANT_A)
      .set('X-Request-Id', requestId)
      .send({ target: 'bukan-sistem' })
      .expect(400);
    expect(await auditByRequest(TENANT_A, requestId)).toHaveLength(0);
  });

  it('membaca jejak audit per pasien juga diaudit, dengan id pasiennya', async () => {
    const requestId = `uji-${newId()}`;
    const patientId = newId();
    await http()
      .get(`/api/v1/audit/events?patientId=${patientId}`)
      .set('X-Tenant-Id', TENANT_A)
      .set('X-Request-Id', requestId)
      .expect(200);
    const [row] = await auditByRequest(TENANT_A, requestId);
    expect(row).toMatchObject({ action: 'read', resourceType: 'audit_event', patientId });
  });

  it('rantai audit tenant terverifikasi lewat API', async () => {
    const res = await http().get('/api/v1/audit/verify').set('X-Tenant-Id', TENANT_A).expect(200);
    expect(res.body).toMatchObject({ intact: true, firstBrokenSeq: null });
    expect(res.body.checked).toBeGreaterThan(0);
  });

  it('daftar audit hanya berisi tenant sendiri dan berpaginasi kursor', async () => {
    const requestId = `uji-${newId()}`;
    await http()
      .post('/api/v1/dev/outbox-ping')
      .set('X-Tenant-Id', TENANT_A)
      .set('X-Request-Id', requestId)
      .send({ target: 'bpjs' })
      .expect(201);
    const b = await http().get('/api/v1/audit/events?limit=200').set('X-Tenant-Id', TENANT_B).expect(200);
    expect(b.body.items.map((i: { requestId: string }) => i.requestId)).not.toContain(requestId);

    const p1 = await http().get('/api/v1/audit/events?limit=2').set('X-Tenant-Id', TENANT_A).expect(200);
    expect(p1.body.items).toHaveLength(2);
    expect(p1.body.nextCursor).toBe(p1.body.items[1].seq);
    const p2 = await http()
      .get(`/api/v1/audit/events?limit=2&cursor=${p1.body.nextCursor}`)
      .set('X-Tenant-Id', TENANT_A)
      .expect(200);
    expect(BigInt(p2.body.items[0].seq)).toBeLessThan(BigInt(p1.body.items[1].seq));
  });

  it('kursor bukan angka ditolak', async () => {
    await http().get('/api/v1/audit/events?cursor=1;DROP').set('X-Tenant-Id', TENANT_A).expect(400);
  });
});

describe('TenantDb', () => {
  it('menolak akses data di luar transaksi permintaan', () => {
    const tenantDb = app.get(TenantDb);
    expect(() => tenantDb.tx()).toThrow(/di luar transaksi tenant/);
  });
});
