/**
 * Fase 1 potongan 10d · Staf seed tanpa sandi bawaan: tidak bisa masuk dengan sandi apa pun sampai admin SIM RS
 * mereset sandinya, lalu login pertama berjalan seperti undangan biasa (daftar MFA → ganti sandi → posisi).
 * Isi seed (peran, penugasan, idempoten, isolasi) diuji di packages/db (`seed-staff.test.ts`).
 */
import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  createPrismaClient,
  SEED_STAFF,
  seedHospitalStructure,
  seedStaff,
  seedStaffPhone,
  withTenant,
} from '@simrs/db';
import { testDbUrls } from '@simrs/db/testing';
import { base32Decode, totpCode, totpStep } from '@simrs/shared/node';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bearer,
  createTestApp,
  createTestTenant,
  createTestUser,
  login,
  type Tokens,
  testDb,
} from './helpers';

let app: NestExpressApplication;
const http = () => request(app.getHttpServer());
let tenant: { id: string; code: string };
let admin: Tokens;

const kasir = SEED_STAFF.find((s) => s.positions.length === 1 && s.positions[0]?.[0] === 'kasir');

beforeAll(async () => {
  app = await createTestApp();
  // RS baru (16 peran) + struktur + staf seed, persis seperti `pnpm db:seed`, dengan kunci .env yang dipakai API.
  tenant = await createTestTenant();
  const owner = createPrismaClient({ connectionString: testDbUrls().migrator, max: 2 });
  try {
    await withTenant(owner, tenant.id, (tx) => seedHospitalStructure(tx, tenant.id));
    await seedStaff(owner, tenant.id, { encKeyB64: process.env.FIELD_ENCRYPTION_KEY ?? '' });
  } finally {
    await owner.$disconnect();
  }
  const adminUser = await createTestUser(tenant.id, {
    roles: [{ code: 'admin_tenant' }],
    tenantCode: tenant.code,
  });
  admin = await login(app, adminUser);
});

afterAll(async () => {
  await app?.close();
});

const loginAs = (username: string, password: string) =>
  http().post('/api/v1/auth/login').send({ tenantCode: tenant.code, username, password });

async function seededUser(nip: string) {
  return withTenant(testDb(), tenant.id, (tx) =>
    tx.user.findFirstOrThrow({
      where: { username: nip },
      select: {
        id: true,
        failedLoginCount: true,
        lockedUntil: true,
        credential: { select: { userId: true } },
      },
    }),
  );
}

describe('staf seed tanpa sandi bawaan (10d)', () => {
  it('ditolak masuk dengan sandi apa pun, sama seperti akun tak dikenal, tanpa mengunci akun', async () => {
    if (!kasir) throw new Error('SEED_STAFF tanpa kasir satu posisi');
    const unknown = await loginAs('9999tidakada000000', 'sandi apa saja').expect(401);
    for (const guess of [kasir.nip, 'password', 'Rahasia123!', 'simrs', kasir.displayName]) {
      const r = await loginAs(kasir.nip, guess).expect(401);
      expect({ code: r.body.code, message: r.body.message }).toEqual({
        code: unknown.body.code,
        message: unknown.body.message,
      });
    }
    const u = await seededUser(kasir.nip);
    expect(u).toMatchObject({ credential: null, failedLoginCount: 0, lockedUntil: null });
    const denied = await withTenant(testDb(), tenant.id, (tx) =>
      tx.auditEvent.count({ where: { action: 'login_failed', actorUserId: u.id, outcome: 'denied' } }),
    );
    expect(denied).toBe(5);

    // Layar Akses: akun aktif, belum pernah masuk, belum MFA, wajib ganti sandi (menunggu diaktifkan admin).
    const list = await http().get(`/api/v1/iam/users?search=${kasir.nip}`).set(bearer(admin)).expect(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]).toMatchObject({
      username: kasir.nip,
      displayName: kasir.displayName,
      status: 'active',
      neverLoggedIn: true,
      mfaEnrolled: false,
      mustChangePassword: true,
    });
    expect(list.body.items[0].assignments).toMatchObject([{ roleCode: 'kasir', unitName: 'Kasir' }]);
    const detail = await http().get(`/api/v1/iam/users/${u.id}`).set(bearer(admin)).expect(200);
    expect(detail.body.phone).toBe(`0813•••${seedStaffPhone(kasir).slice(-4)}`);
  });

  it('setelah admin mereset sandi: daftar MFA, ganti sandi, lalu masuk biasa (sandi baru + TOTP)', async () => {
    if (!kasir) throw new Error('SEED_STAFF tanpa kasir satu posisi');
    const u = await seededUser(kasir.nip);
    const reset = await http()
      .post(`/api/v1/iam/users/${u.id}/reset-password`)
      .set(bearer(admin))
      .expect(200);
    const temporary: string = reset.body.temporaryPassword;
    expect(temporary).toHaveLength(16);
    expect((await seededUser(kasir.nip)).credential).not.toBeNull();

    // Login pertama: sesi terbatas sampai MFA didaftarkan dan sandi diganti.
    const first = await loginAs(kasir.nip, temporary).expect(200);
    expect(first.body).toMatchObject({ status: 'mfa_enrollment_required', mustChangePassword: true });
    const t = { accessToken: first.body.accessToken as string };
    expect((await http().get('/api/v1/tenancy/current').set(bearer(t)).expect(403)).body.code).toBe(
      'MFA_REQUIRED',
    );
    const enroll = await http().post('/api/v1/auth/mfa/enroll').set(bearer(t)).expect(200);
    const secret = base32Decode(enroll.body.secret as string);
    const enrolledStep = totpStep();
    await http()
      .post('/api/v1/auth/mfa/enroll/confirm')
      .set(bearer(t))
      .send({ code: totpCode(secret, enrolledStep) })
      .expect(200);
    expect((await http().get('/api/v1/tenancy/current').set(bearer(t)).expect(403)).body.code).toBe(
      'PASSWORD_CHANGE_REQUIRED',
    );
    const newPassword = 'frasa baru staf seed cukup panjang';
    await http()
      .post('/api/v1/auth/password')
      .set(bearer(t))
      .send({ currentPassword: temporary, newPassword })
      .expect(200);
    const me = await http().get('/api/v1/auth/me').set(bearer(t)).expect(200);
    expect(me.body.role).toMatchObject({ code: 'kasir' });
    expect(me.body.unit).toMatchObject({ name: 'Kasir' });
    await http().get('/api/v1/tenancy/current').set(bearer(t)).expect(200);

    // Selanjutnya: sandi sementara mati; sandi baru + kode TOTP membuka sesi penuh.
    await loginAs(kasir.nip, temporary).expect(401);
    const next = await loginAs(kasir.nip, newPassword).expect(200);
    expect(next.body.status).toBe('mfa_required');
    const verified = await http()
      .post('/api/v1/auth/mfa/verify')
      .send({ challengeToken: next.body.challengeToken, code: totpCode(secret, enrolledStep + 1) })
      .expect(200);
    await http().get('/api/v1/tenancy/current').set(bearer(verified.body)).expect(200);
  });
});
