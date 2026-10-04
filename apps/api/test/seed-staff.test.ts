/**
 * Fase 1 potongan 10d · Staf seed tanpa sandi bawaan: tidak bisa masuk dengan sandi apa pun sampai admin SIM RS
 * mereset sandinya, lalu login pertama berjalan seperti undangan biasa (daftar MFA → ganti sandi → posisi). Layar
 * Akses menandainya "belum diaktifkan", dan admin seed yang belum diaktifkan tidak dihitung sebagai admin aktif
 * (aturan "minimal satu admin", ADR-0012). Isi seed (peran, penugasan, idempoten, isolasi) diuji di packages/db.
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

/** RS baru (16 peran) + struktur + staf seed, persis seperti `pnpm db:seed`, dengan kunci .env yang dipakai API. */
async function seededTenant(): Promise<{ id: string; code: string }> {
  const t = await createTestTenant();
  const owner = createPrismaClient({ connectionString: testDbUrls().migrator, max: 2 });
  try {
    await withTenant(owner, t.id, (tx) => seedHospitalStructure(tx, t.id));
    await seedStaff(owner, t.id, { encKeyB64: process.env.FIELD_ENCRYPTION_KEY ?? '' });
  } finally {
    await owner.$disconnect();
  }
  return t;
}

beforeAll(async () => {
  app = await createTestApp();
  tenant = await seededTenant();
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

/** NIP akun yang masih "belum diaktifkan" menurut filter daftar pengguna (tanpa kata sandi). */
async function notActivated(): Promise<string[]> {
  const r = await http()
    .get('/api/v1/iam/users?status=not_activated&limit=200')
    .set(bearer(admin))
    .expect(200);
  const items = r.body.items as Array<{ username: string; activated: boolean }>;
  expect(items.every((u) => !u.activated)).toBe(true);
  return items.map((u) => u.username).sort();
}

async function seededUser(nip: string, tenantId = tenant.id) {
  return withTenant(testDb(), tenantId, (tx) =>
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
      activated: false,
    });
    expect(list.body.items[0].assignments).toMatchObject([{ roleCode: 'kasir', unitName: 'Kasir' }]);
    const detail = await http().get(`/api/v1/iam/users/${u.id}`).set(bearer(admin)).expect(200);
    expect(detail.body.phone).toBe(`0813•••${seedStaffPhone(kasir).slice(-4)}`);
    expect(detail.body.activated).toBe(false);

    // Filter "belum diaktifkan" = semua staf seed, bukan admin uji yang sudah punya sandi; ringkasan ikut menghitung.
    expect(await notActivated()).toEqual([...SEED_STAFF.map((s) => s.nip)].sort());
    const summary = await http().get('/api/v1/iam/summary').set(bearer(admin)).expect(200);
    expect(summary.body.notActivated).toBe(SEED_STAFF.length);
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
    const detail = await http().get(`/api/v1/iam/users/${u.id}`).set(bearer(admin)).expect(200);
    expect(detail.body).toMatchObject({ activated: true, neverLoggedIn: true, mustChangePassword: true });
    expect(await notActivated()).not.toContain(kasir.nip);
    const summary = await http().get('/api/v1/iam/summary').set(bearer(admin)).expect(200);
    expect(summary.body.notActivated).toBe(SEED_STAFF.length - 1);

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

describe('aturan "minimal satu admin" hanya menghitung admin yang bisa masuk', () => {
  const seededAdmin = SEED_STAFF.find((s) => s.positions.some(([role]) => role === 'admin_tenant'));

  for (const change of ['dinonaktifkan', 'dicabut peran adminnya'] as const) {
    it(`admin seed belum diaktifkan: admin nyata terakhir tidak bisa ${change}; bisa setelah admin seed diaktifkan`, async () => {
      if (!seededAdmin) throw new Error('SEED_STAFF tanpa admin_tenant');
      const T = await seededTenant();
      const real = await createTestUser(T.id, { roles: [{ code: 'admin_tenant' }], tenantCode: T.code });
      const tok = await login(app, real);
      const assignments = await http().get('/api/v1/auth/assignments').set(bearer(tok)).expect(200);
      const own = (assignments.body as Array<{ id: string }>)[0];
      const asOperator = (userId: string, status: 'active' | 'disabled') =>
        http().patch(`/api/v1/iam/users/${userId}`).set('X-Tenant-Id', T.id).send({ status });
      const apply = () =>
        change === 'dinonaktifkan'
          ? asOperator(real.id, 'disabled')
          : http()
              .post(`/api/v1/iam/assignments/${own?.id}/end`)
              .set(bearer(tok))
              .send({ reason: 'Serah terima admin SIM RS' });

      // Admin seed ada (penugasan admin_tenant berlaku) tetapi tanpa sandi: tidak bisa memulihkan RS.
      const blocked = await apply().expect(409);
      expect(blocked.body.message).toMatch(/minimal satu admin/);

      // Diaktifkan lewat reset sandi (belum MFA, belum ganti sandi): kini dihitung, perubahan boleh.
      const seeded = await seededUser(seededAdmin.nip, T.id);
      await http().post(`/api/v1/iam/users/${seeded.id}/reset-password`).set(bearer(tok)).expect(200);
      await apply().expect(200);
      // Admin seed yang sudah diaktifkan kini admin terakhir: dijaga dengan aturan yang sama.
      const last = await asOperator(seeded.id, 'disabled').expect(409);
      expect(last.body.message).toMatch(/minimal satu admin/);
    });
  }
});
