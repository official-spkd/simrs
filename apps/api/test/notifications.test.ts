/**
 * P09 · Notifikasi staf lewat API: akses darurat → notifikasi in-app ke petugas privasi + salinan email/WhatsApp di
 * outbox (payload hanya ID); hanya pemilik yang bisa membaca/menandai; no. HP staf disimpan terenkripsi dan tampil
 * tersamar di layar Akses.
 */
import type { NestExpressApplication } from '@nestjs/platform-express';
import { withTenant } from '@simrs/db';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bearer,
  createTestApp,
  createTestPatient,
  createTestTenant,
  createTestUser,
  login,
  type TestUser,
  testDb,
  type Tokens,
} from './helpers';

let app: NestExpressApplication;
let T: { id: string; code: string };
const u: Record<string, TestUser> = {};
const tok: Record<string, Tokens> = {};
const http = () => request(app.getHttpServer());
const as = (who: string) => {
  const auth = () => bearer(tok[who] as Tokens);
  return {
    get: (url: string) => http().get(url).set(auth()),
    post: (url: string, body: object = {}) => http().post(url).set(auth()).send(body),
    patch: (url: string, body: object) => http().patch(url).set(auth()).send(body),
  };
};

beforeAll(async () => {
  app = await createTestApp();
  T = await createTestTenant();
  for (const [who, role] of [
    ['admin', 'admin_tenant'],
    ['privasi', 'petugas_privasi'],
    ['perawat', 'perawat'],
  ] as const) {
    u[who] = await createTestUser(T.id, { roles: [{ code: role }], tenantCode: T.code });
    tok[who] = await login(app, u[who] as TestUser);
  }
});

afterAll(async () => {
  await app.close();
});

describe('no. HP staf (IAM)', () => {
  it('disimpan terenkripsi bentuk baku, tampil tersamar; format salah ditolak; bisa dihapus', async () => {
    await as('admin').patch(`/api/v1/iam/users/${u.privasi?.id}`, { phone: '12345' }).expect(400);
    await as('admin')
      .patch(`/api/v1/iam/users/${u.privasi?.id}`, {
        phone: '0812-3456-7890',
        email: 'privasi@rs-fiktif.test',
      })
      .expect(200);
    const detail = await as('admin').get(`/api/v1/iam/users/${u.privasi?.id}`).expect(200);
    expect(detail.body.phone).toBe('0812•••7890');
    expect(JSON.stringify(detail.body)).not.toContain('81234567890');
    const row = await withTenant(testDb(), T.id, (tx) =>
      tx.user.findUniqueOrThrow({ where: { id: u.privasi?.id as string }, select: { phoneEnc: true } }),
    );
    expect(row.phoneEnc).toMatch(/^v1\./);

    const created = await as('admin')
      .post('/api/v1/iam/users', {
        username: 'staf.hp',
        displayName: 'Staf Ber-HP',
        phone: '+62 813 0000 1111',
      })
      .expect(201);
    const d2 = await as('admin').get(`/api/v1/iam/users/${created.body.id}`).expect(200);
    expect(d2.body.phone).toBe('0813•••1111');
    await as('admin').patch(`/api/v1/iam/users/${created.body.id}`, { phone: null }).expect(200);
    expect((await as('admin').get(`/api/v1/iam/users/${created.body.id}`).expect(200)).body.phone).toBeNull();
  });
});

describe('notifikasi akses darurat', () => {
  it('petugas privasi menerima in-app + email + WhatsApp (outbox, ID saja); tanpa PHI', async () => {
    const patient = await createTestPatient(T.id);
    const reason = 'Pasien henti napas di koridor, perlu riwayat alergi';
    const grant = await as('perawat')
      .post('/api/v1/authz/break-glass', { patientId: patient.id, reason })
      .expect(201);
    expect(grant.body.notified).toBe(1);

    const list = await as('privasi').get('/api/v1/notifications').expect(200);
    expect(list.body.unread).toBe(1);
    const [n] = list.body.items;
    expect(n).toMatchObject({
      kind: 'break_glass',
      title: 'Akses darurat digunakan',
      link: `/sistem/audit?tinjau=${grant.body.id}`,
      readAt: null,
    });
    expect(JSON.stringify(n)).not.toContain(reason);
    expect(JSON.stringify(n)).not.toContain(patient.id);

    const outbox = await withTenant(testDb(), T.id, (tx) =>
      tx.outboxMessage.findMany({
        where: { idempotencyKey: { endsWith: n.id } },
        orderBy: { target: 'asc' },
        select: { target: true, operation: true, payload: true },
      }),
    );
    expect(outbox).toEqual([
      { target: 'email', operation: 'notify.email', payload: { notificationId: n.id } },
      { target: 'whatsapp', operation: 'notify.whatsapp', payload: { notificationId: n.id } },
    ]);

    // Hanya pemilik yang bisa menandai.
    await as('perawat').post(`/api/v1/notifications/${n.id}/read`).expect(404);
    expect((await as('perawat').get('/api/v1/notifications').expect(200)).body.items).toEqual([]);
    await as('privasi').post(`/api/v1/notifications/${n.id}/read`).expect(200);
    expect((await as('privasi').get('/api/v1/notifications/unread-count').expect(200)).body.unread).toBe(0);
    expect((await as('privasi').get('/api/v1/notifications?unread=true').expect(200)).body.items).toEqual([]);
  });

  it('tandai semua dibaca; tanpa login ditolak', async () => {
    const patient = await createTestPatient(T.id);
    await as('perawat')
      .post('/api/v1/authz/break-glass', {
        patientId: patient.id,
        reason: 'Konsul jaga malam, DPJP belum tiba',
      })
      .expect(201);
    expect((await as('privasi').get('/api/v1/notifications/unread-count').expect(200)).body.unread).toBe(1);
    expect((await as('privasi').post('/api/v1/notifications/read-all').expect(200)).body.updated).toBe(1);
    // Tanpa sesi: ditolak (mode uji memakai header tenant pengembang → TENANT_REQUIRED; produksi → 401).
    const anon = await http().get('/api/v1/notifications');
    expect([400, 401]).toContain(anon.status);
  });
});
