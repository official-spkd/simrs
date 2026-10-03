/**
 * Data untuk layar Akses (/sistem/akses): ringkasan reviu akses, filter daftar pengguna, detail penugasan.
 * Memakai tenant fiktif baru agar angka ringkasan pasti.
 */
import type { NestExpressApplication } from '@nestjs/platform-express';
import { withTenant } from '@simrs/db';
import { newId } from '@simrs/shared';
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
let adminTok: Tokens;
const u: Record<string, TestUser> = {};
let unitId: string;
const http = () => request(app.getHttpServer());
const asAdmin = (url: string) => http().get(url).set(bearer(adminTok));
const DAY = 86_400_000;

beforeAll(async () => {
  app = await createTestApp();
  T = await createTestTenant();
  const mk = (
    roles: Array<{ code: string; unitId?: string }>,
    opts: { mfa?: boolean; status?: 'disabled' } = {},
  ) => createTestUser(T.id, { roles, tenantCode: T.code, ...opts });

  unitId = await withTenant(testDb(), T.id, async (tx) => {
    const facilityId = newId();
    await tx.facility.create({ data: { id: facilityId, tenantId: T.id, code: 'UTAMA', name: 'Gedung uji' } });
    const unit = await tx.unit.create({
      data: {
        id: newId(),
        tenantId: T.id,
        facilityId,
        code: 'MELATI',
        name: 'Bangsal Melati',
        kind: 'rawat_inap',
      },
    });
    return unit.id;
  });

  u.admin = await mk([{ code: 'admin_tenant' }]);
  u.perawat = await mk([{ code: 'perawat', unitId }], { mfa: false });
  u.kasir = await mk([{ code: 'kasir' }], { status: 'disabled' });
  u.locked = await mk([{ code: 'koder' }]);
  u.dormant = await mk([{ code: 'akuntan' }]);
  adminTok = await login(app, u.admin);
  const patient = await createTestPatient(T.id);

  await withTenant(testDb(), T.id, async (tx) => {
    await tx.user.update({
      where: { id: u.locked?.id },
      data: { lockedUntil: new Date(Date.now() + 3_600_000) },
    });
    await tx.user.update({
      where: { id: u.dormant?.id },
      data: { lastLoginAt: new Date(Date.now() - 90 * DAY) },
    });
    const grant = (daysAgo: number) => {
      const grantedAt = new Date(Date.now() - daysAgo * DAY);
      return tx.breakGlassGrant.create({
        data: {
          id: newId(),
          tenantId: T.id,
          userId: u.locked?.id as string,
          patientId: patient.id,
          reason: 'Alasan klinis uji yang cukup panjang',
          grantedAt,
          expiresAt: new Date(grantedAt.getTime() + 3_600_000),
        },
      });
    };
    await grant(0);
    await grant(10);
  });
});

afterAll(async () => {
  await app?.close();
});

describe('layar Akses: data', () => {
  it('ringkasan reviu akses', async () => {
    const res = await asAdmin('/api/v1/iam/summary').expect(200);
    expect(res.body).toEqual({
      total: 5,
      active: 4,
      locked: 1,
      mfaMissing: 1,
      dormant: 1,
      breakGlass7d: 1,
      breakGlassPending: 2,
      dormantDays: 60,
    });
  });

  it('daftar pengguna: filter peran dan unit; tanda akun', async () => {
    const byRole = await asAdmin('/api/v1/iam/users?role=perawat').expect(200);
    expect(byRole.body.items.map((x: { id: string }) => x.id)).toEqual([u.perawat?.id]);
    expect(byRole.body.items[0]).toMatchObject({
      mfaEnrolled: false,
      neverLoggedIn: true,
      dormant: false,
      locked: false,
    });
    const byUnit = await asAdmin(`/api/v1/iam/users?unitId=${unitId}`).expect(200);
    expect(byUnit.body.items.map((x: { id: string }) => x.id)).toEqual([u.perawat?.id]);
    const all = await asAdmin('/api/v1/iam/users?limit=200').expect(200);
    const flags = Object.fromEntries(
      all.body.items.map((x: { id: string; locked: boolean; dormant: boolean }) => [x.id, x]),
    );
    expect(flags[u.locked?.id as string]).toMatchObject({ locked: true });
    expect(flags[u.dormant?.id as string]).toMatchObject({ dormant: true });
    await asAdmin('/api/v1/iam/users?role=Bukan-Kode').expect(400);
  });

  it('detail: penugasan akan datang ditandai, yang dibatalkan tidak tampil', async () => {
    const next = new Date(Date.now() + 10 * DAY).toISOString();
    const created = await http()
      .post(`/api/v1/iam/users/${u.perawat?.id}/assignments`)
      .set(bearer(adminTok))
      .send({ roleCode: 'bidan', validFrom: next })
      .expect(201);
    const cancelled = await http()
      .post(`/api/v1/iam/users/${u.perawat?.id}/assignments`)
      .set(bearer(adminTok))
      .send({ roleCode: 'apoteker', validFrom: next })
      .expect(201);
    await http()
      .post(`/api/v1/iam/assignments/${cancelled.body.id}/end`)
      .set(bearer(adminTok))
      .send({ reason: 'Batal rotasi' })
      .expect(200);

    const d = await asAdmin(`/api/v1/iam/users/${u.perawat?.id}`).expect(200);
    expect(d.body).toMatchObject({ id: u.perawat?.id, username: u.perawat?.username, mfaEnrolled: false });
    const roles = d.body.assignments.map((a: { roleCode: string; pending: boolean }) => [
      a.roleCode,
      a.pending,
    ]);
    expect(roles).toEqual([
      ['perawat', false],
      ['bidan', true],
    ]);
    expect(d.body.assignments.find((a: { id: string }) => a.id === created.body.id)).toMatchObject({
      unitName: null,
      validFrom: next,
    });
    await asAdmin(`/api/v1/iam/users/${newId()}`).expect(404);
  });

  it('tanpa izin baca pengguna → 403', async () => {
    const perawatTok = await login(
      app,
      await createTestUser(T.id, { roles: [{ code: 'perawat' }], tenantCode: T.code }),
    );
    await http().get('/api/v1/iam/summary').set(bearer(perawatTok)).expect(403);
    await http().get(`/api/v1/iam/users/${u.admin?.id}`).set(bearer(perawatTok)).expect(403);
  });
});
