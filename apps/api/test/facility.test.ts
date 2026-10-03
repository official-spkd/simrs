import type { NestExpressApplication } from '@nestjs/platform-express';
import { createPrismaClient, type PrismaClient, withTenant } from '@simrs/db';
import { testDbUrls } from '@simrs/db/testing';
import { newId } from '@simrs/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, TENANT_A, TENANT_B } from './helpers';

let app: NestExpressApplication;
let db: PrismaClient;
const http = () => request(app.getHttpServer());
const uniq = () => newId().slice(-8).toUpperCase();

const as = (tenant: string) => ({
  get: (url: string) => http().get(url).set('X-Tenant-Id', tenant),
  post: (url: string, body: object) => http().post(url).set('X-Tenant-Id', tenant).send(body),
  patch: (url: string, body: object) => http().patch(url).set('X-Tenant-Id', tenant).send(body),
});

beforeAll(async () => {
  app = await createTestApp();
  db = createPrismaClient({ connectionString: testDbUrls().app, max: 2 });
});

afterAll(async () => {
  await app?.close();
  await db?.$disconnect();
});

async function setupBangsal(tenant: string) {
  const f = await as(tenant)
    .post('/api/v1/facility/facilities', { code: `F-${uniq()}`, name: 'Gedung Utama' })
    .expect(201);
  const u = await as(tenant)
    .post('/api/v1/facility/units', {
      facilityId: f.body.id,
      code: `MELATI-${uniq()}`,
      name: 'Bangsal Melati',
      kind: 'rawat_inap',
    })
    .expect(201);
  const kamar = await as(tenant)
    .post('/api/v1/facility/locations', {
      unitId: u.body.id,
      kind: 'kamar',
      code: `K-${uniq()}`,
      name: 'Kamar 201',
      careClass: 'kelas_2',
    })
    .expect(201);
  return { facility: f.body, unit: u.body, kamar: kamar.body };
}

describe('struktur RS (P01)', () => {
  it('membuat faskes → unit → kamar → bed; bed mewarisi kelas kamar; kode dinormalisasi', async () => {
    const { unit, kamar } = await setupBangsal(TENANT_A);
    // Kode unik per run (kode unik per RS); huruf kecil untuk menguji normalisasi ke kapital.
    const code = `b-${uniq()}`.toLowerCase();
    const bed = await as(TENANT_A)
      .post('/api/v1/facility/locations', {
        unitId: unit.id,
        parentId: kamar.id,
        kind: 'bed',
        code,
        name: 'Bed A',
      })
      .expect(201);
    expect(bed.body).toMatchObject({
      code: code.toUpperCase(),
      careClass: 'kelas_2',
      parentId: kamar.id,
      kind: 'bed',
    });
  });

  it('perubahan tercatat di audit dengan nama field saja', async () => {
    const { unit } = await setupBangsal(TENANT_A);
    const requestId = `uji-${newId()}`;
    await as(TENANT_A)
      .patch(`/api/v1/facility/units/${unit.id}`, { name: 'Bangsal Melati Baru' })
      .set('X-Request-Id', requestId)
      .expect(200);
    const [row] = await withTenant(db, TENANT_A, (tx) => tx.auditEvent.findMany({ where: { requestId } }));
    expect(row).toMatchObject({
      action: 'update',
      resourceType: 'unit',
      resourceId: unit.id,
      details: { fields: ['name'] },
    });
    expect(JSON.stringify(row?.details)).not.toContain('Bangsal Melati Baru');
  });

  it('aturan hierarki: bed tanpa kamar, ruang berinduk, induk beda unit → 400', async () => {
    const a = await setupBangsal(TENANT_A);
    const b = await setupBangsal(TENANT_A);
    const bad = [
      { unitId: a.unit.id, kind: 'bed', code: `X-${uniq()}`, name: 'Bed', careClass: 'kelas_1' },
      { unitId: a.unit.id, parentId: a.kamar.id, kind: 'ruang', code: `X-${uniq()}`, name: 'Ruang' },
      { unitId: a.unit.id, parentId: b.kamar.id, kind: 'bed', code: `X-${uniq()}`, name: 'Bed' },
    ];
    for (const body of bad) {
      const res = await as(TENANT_A).post('/api/v1/facility/locations', body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    }
  });

  it('kode ganda → 409 CONFLICT dengan nama kolom, bukan nilai', async () => {
    const code = `DUP-${uniq()}`;
    await as(TENANT_A).post('/api/v1/facility/facilities', { code, name: 'Satu' }).expect(201);
    const dup = await as(TENANT_A).post('/api/v1/facility/facilities', { code, name: 'Dua' }).expect(409);
    expect(dup.body.code).toBe('CONFLICT');
    expect(JSON.stringify(dup.body)).not.toContain(code);
  });

  it('tidak bisa menonaktifkan induk yang masih punya turunan aktif', async () => {
    const { unit, kamar } = await setupBangsal(TENANT_A);
    await as(TENANT_A).patch(`/api/v1/facility/units/${unit.id}`, { active: false }).expect(409);
    await as(TENANT_A).patch(`/api/v1/facility/locations/${kamar.id}`, { active: false }).expect(200);
    await as(TENANT_A).patch(`/api/v1/facility/units/${unit.id}`, { active: false }).expect(200);
  });

  it('siklus pohon unit ditolak', async () => {
    const { facility, unit } = await setupBangsal(TENANT_A);
    const child = await as(TENANT_A)
      .post('/api/v1/facility/units', {
        facilityId: facility.id,
        parentId: unit.id,
        code: `SUB-${uniq()}`,
        name: 'Sub',
        kind: 'rawat_inap',
      })
      .expect(201);
    const res = await as(TENANT_A)
      .patch(`/api/v1/facility/units/${unit.id}`, { parentId: child.body.id })
      .expect(400);
    expect(res.body.message).toMatch(/siklus/);
  });

  it('isolasi tenant: B tidak melihat, mengubah, atau mereferensikan data A', async () => {
    const a = await setupBangsal(TENANT_A);
    const list = await as(TENANT_B).get('/api/v1/facility/units?limit=200').expect(200);
    expect(list.body.items.map((u: { id: string }) => u.id)).not.toContain(a.unit.id);
    await as(TENANT_B).patch(`/api/v1/facility/units/${a.unit.id}`, { name: 'Diambil alih' }).expect(404);
    const fB = await as(TENANT_B)
      .post('/api/v1/facility/facilities', { code: `F-${uniq()}`, name: 'Faskes B' })
      .expect(201);
    // Referensi ke unit A dari tenant B: tidak terlihat → ditolak sebagai validasi, tanpa membocorkan keberadaannya.
    const ref = await as(TENANT_B)
      .post('/api/v1/facility/units', {
        facilityId: fB.body.id,
        parentId: a.unit.id,
        code: `X-${uniq()}`,
        name: 'X',
        kind: 'poli',
      })
      .expect(400);
    expect(ref.body.code).toBe('VALIDATION_FAILED');
  });

  it('paginasi kursor + filter; field tak dikenal ditolak', async () => {
    const { facility } = await setupBangsal(TENANT_A);
    for (let i = 0; i < 3; i++) {
      await as(TENANT_A)
        .post('/api/v1/facility/units', {
          facilityId: facility.id,
          code: `P-${uniq()}`,
          name: `Poli ${i}`,
          kind: 'poli',
        })
        .expect(201);
    }
    const p1 = await as(TENANT_A)
      .get(`/api/v1/facility/units?facilityId=${facility.id}&kind=poli&limit=2`)
      .expect(200);
    expect(p1.body.items).toHaveLength(2);
    expect(p1.body.nextCursor).toBe(p1.body.items[1].id);
    const p2 = await as(TENANT_A)
      .get(`/api/v1/facility/units?facilityId=${facility.id}&kind=poli&limit=2&cursor=${p1.body.nextCursor}`)
      .expect(200);
    expect(p2.body.items).toHaveLength(1);
    expect(p2.body.nextCursor).toBeNull();
    await as(TENANT_A).get('/api/v1/facility/units?sortBy=name').expect(400);
  });
});

describe('pengaturan dan modul (P10, P12)', () => {
  it('daftar pengaturan efektif; ubah nilai valid; tolak kunci asing dan nilai salah', async () => {
    const list = await as(TENANT_B).get('/api/v1/settings').expect(200);
    expect(list.body.map((s: { key: string }) => s.key)).toContain('session.idle_minutes');
    const set = await http()
      .put('/api/v1/settings/session.idle_minutes')
      .set('X-Tenant-Id', TENANT_B)
      .send({ value: 20 })
      .expect(200);
    expect(set.body).toMatchObject({ key: 'session.idle_minutes', value: 20, isDefault: false });
    await http()
      .put('/api/v1/settings/tidak.dikenal')
      .set('X-Tenant-Id', TENANT_B)
      .send({ value: 1 })
      .expect(404);
    await http()
      .put('/api/v1/settings/password.min_length')
      .set('X-Tenant-Id', TENANT_B)
      .send({ value: 6 })
      .expect(400);
    const a = await as(TENANT_A).get('/api/v1/settings').expect(200);
    const idleA = a.body.find((s: { key: string }) => s.key === 'session.idle_minutes');
    expect(idleA.value === 20 && !idleA.isDefault).toBe(false);
  });

  it('modul inti tidak bisa dimatikan; modul mati → endpoint 403 MODULE_DISABLED', async () => {
    await http()
      .put('/api/v1/settings/modules/P04')
      .set('X-Tenant-Id', TENANT_B)
      .send({ enabled: false })
      .expect(409);
    await http()
      .put('/api/v1/settings/modules/Z99')
      .set('X-Tenant-Id', TENANT_B)
      .send({ enabled: false })
      .expect(400);
    try {
      await http()
        .put('/api/v1/settings/modules/I01')
        .set('X-Tenant-Id', TENANT_B)
        .send({ enabled: false })
        .expect(200);
      const res = await as(TENANT_B).post('/api/v1/dev/outbox-ping', { target: 'bpjs' }).expect(403);
      expect(res.body.code).toBe('MODULE_DISABLED');
      await as(TENANT_A).post('/api/v1/dev/outbox-ping', { target: 'bpjs' }).expect(201);
    } finally {
      await http()
        .put('/api/v1/settings/modules/I01')
        .set('X-Tenant-Id', TENANT_B)
        .send({ enabled: true })
        .expect(200);
    }
  });
});
