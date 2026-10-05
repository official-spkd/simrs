/**
 * Layar Akses: perangkat tepercaya ("percayai perangkat ini 12 jam", ADR-0022) terlihat di detail pengguna dan bisa
 * dicabut admin; pencabutan diaudit, tunduk izin kelola pengguna, isolasi tenant, dan larangan mengubah akun sendiri.
 * (Pencabutan PIN perangkat oleh admin diuji di pin-login.test.ts.)
 */
import type { NestExpressApplication } from '@nestjs/platform-express';
import { withTenant } from '@simrs/db';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bearer,
  createTestApp,
  createTestTenant,
  createTestUser,
  login,
  nextTotp,
  type TestUser,
  testDb,
  type Tokens,
} from './helpers';

let app: NestExpressApplication;
let T: { id: string; code: string };
let admin: TestUser;
let adminTok: Tokens;
const http = () => request(app.getHttpServer());
const userWith = (roles: Array<{ code: string }>) => createTestUser(T.id, { roles, tenantCode: T.code });
const challengeOf = async (u: TestUser) =>
  (
    await http()
      .post('/api/v1/auth/login')
      .send({ tenantCode: u.tenantCode, username: u.username, password: u.password })
      .expect(200)
  ).body.challengeToken as string;

beforeAll(async () => {
  app = await createTestApp();
  T = await createTestTenant();
  admin = await createTestUser(T.id, { roles: [{ code: 'admin_tenant' }], tenantCode: T.code });
  adminTok = await login(app, admin);
});

afterAll(async () => {
  await app?.close();
});

describe('perangkat tepercaya di layar Akses (admin)', () => {
  it('terlihat di detail pengguna; admin mencabut → login berikutnya wajib kode; tercatat; batas akses', async () => {
    const u = await userWith([{ code: 'perawat' }]);
    const first = await challengeOf(u);
    const trusted = (
      await http()
        .post('/api/v1/auth/mfa/verify')
        .send({ challengeToken: first, code: nextTotp(u), trustDevice: true })
        .expect(200)
    ).body.trustedDevice as { token: string };
    const loginWith = () =>
      http()
        .post('/api/v1/auth/login')
        .send({
          tenantCode: u.tenantCode,
          username: u.username,
          password: u.password,
          trustedDeviceToken: trusted.token,
        })
        .expect(200);
    expect((await loginWith()).body.status).toBe('authenticated');

    const detail = await http().get(`/api/v1/iam/users/${u.id}`).set(bearer(adminTok)).expect(200);
    expect(detail.body.trustedDevices).toEqual([
      expect.objectContaining({ id: expect.any(String), expiresAt: expect.any(String) }),
    ]);
    const deviceId = detail.body.trustedDevices[0].id as string;

    // Tanpa izin kelola pengguna → 403; admin RS lain → 404; admin sendiri tidak lewat menu admin.
    const peerTok = await login(app, await userWith([{ code: 'perawat' }]));
    await http().post(`/api/v1/iam/trusted-devices/${deviceId}/revoke`).set(bearer(peerTok)).expect(403);
    const U = await createTestTenant();
    const otherAdmin = await createTestUser(U.id, { roles: [{ code: 'admin_tenant' }], tenantCode: U.code });
    const otherTok = await login(app, otherAdmin);
    await http().post(`/api/v1/iam/trusted-devices/${deviceId}/revoke`).set(bearer(otherTok)).expect(404);

    await http().post(`/api/v1/iam/trusted-devices/${deviceId}/revoke`).set(bearer(adminTok)).expect(200);
    expect((await loginWith()).body.status).toBe('mfa_required');
    expect(
      (await http().get(`/api/v1/iam/users/${u.id}`).set(bearer(adminTok)).expect(200)).body.trustedDevices,
    ).toEqual([]);
    await http().post(`/api/v1/iam/trusted-devices/${deviceId}/revoke`).set(bearer(adminTok)).expect(404);
    const audit = await withTenant(testDb(), T.id, (tx) =>
      tx.auditEvent.findFirstOrThrow({
        where: { actorUserId: admin.id, action: 'deactivate', resourceType: 'trusted_device' },
        orderBy: { seq: 'desc' },
      }),
    );
    expect(audit).toMatchObject({ resourceId: deviceId, details: { reason: 'admin_revoked' } });

    // Perangkat tepercaya milik admin sendiri tidak bisa dicabut lewat menu admin.
    const selfCh = await challengeOf(admin);
    await http()
      .post('/api/v1/auth/mfa/verify')
      .send({ challengeToken: selfCh, code: nextTotp(admin), trustDevice: true })
      .expect(200);
    const own = (await http().get(`/api/v1/iam/users/${admin.id}`).set(bearer(adminTok)).expect(200)).body
      .trustedDevices[0].id as string;
    await http().post(`/api/v1/iam/trusted-devices/${own}/revoke`).set(bearer(adminTok)).expect(409);
  });
});
