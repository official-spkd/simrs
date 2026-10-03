/**
 * P02 · Identitas dan login. DoD fase 1: "Login + MFA berjalan; akun tanpa MFA tidak bisa membuka modul sensitif".
 */
import type { NestExpressApplication } from '@nestjs/platform-express';
import { withTenant } from '@simrs/db';
import { createPrismaClient } from '@simrs/db';
import { testDbUrls } from '@simrs/db/testing';
import { base32Decode, totpCode, totpStep } from '@simrs/shared/node';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bearer,
  createTestApp,
  createTestUser,
  login,
  nextTotp,
  TENANT_A,
  TENANT_B,
  testDb,
} from './helpers';

let app: NestExpressApplication;
const http = () => request(app.getHttpServer());

beforeAll(async () => {
  app = await createTestApp();
});

afterAll(async () => {
  await app?.close();
});

const GENERIC = /NIP\/email atau kata sandi salah/;

describe('login dengan MFA', () => {
  it('kata sandi → TOTP → token; token membuka endpoint tenant tanpa header', async () => {
    const u = await createTestUser(TENANT_A);
    const t = await login(app, u);
    expect(t.accessToken).toMatch(/^sa1\./);
    expect(t.refreshToken).toMatch(/^sr1\./);
    const me = await http().get('/api/v1/auth/me').set(bearer(t)).expect(200);
    expect(me.body).toMatchObject({
      user: { username: u.username },
      tenant: { code: 'RSFA' },
      mfa: { enrolled: true, sessionVerified: true },
    });
    const cur = await http().get('/api/v1/tenancy/current').set(bearer(t)).expect(200);
    expect(cur.body.id).toBe(TENANT_A);
  });

  it('pesan galat seragam untuk RS tak dikenal, pengguna tak dikenal, dan sandi salah', async () => {
    const u = await createTestUser(TENANT_A);
    const cases = [
      { tenantCode: 'TIDAKADA', username: u.username, password: u.password },
      { tenantCode: 'RSFA', username: 'tidak.ada.siapa', password: u.password },
      { tenantCode: 'RSFA', username: u.username, password: 'kata sandi yang salah sekali' },
    ];
    for (const body of cases) {
      const res = await http().post('/api/v1/auth/login').send(body).expect(401);
      expect(res.body.code).toBe('UNAUTHENTICATED');
      expect(res.body.message).toMatch(GENERIC);
    }
  });

  it('gagal berulang mengunci akun; sandi benar pun ditolak selama terkunci; semua tercatat di audit', async () => {
    const u = await createTestUser(TENANT_A);
    for (let i = 0; i < 5; i++) {
      await http()
        .post('/api/v1/auth/login')
        .send({ tenantCode: 'RSFA', username: u.username, password: 'salah salah salah' })
        .expect(401);
    }
    const locked = await http()
      .post('/api/v1/auth/login')
      .send({ tenantCode: 'RSFA', username: u.username, password: u.password })
      .expect(401);
    expect(locked.body.message).toMatch(GENERIC);
    const rows = await withTenant(testDb(), TENANT_A, (tx) =>
      tx.auditEvent.findMany({
        where: { actorUserId: u.id, action: 'login_failed' },
        orderBy: { seq: 'asc' },
      }),
    );
    expect(rows).toHaveLength(6);
    expect(rows.at(-1)?.details).toMatchObject({ reason: 'locked' });
    expect(rows[4]?.details).toMatchObject({ reason: 'bad_password', locked: true });
  });

  it('pengguna nonaktif tidak bisa login', async () => {
    const u = await createTestUser(TENANT_A, { status: 'disabled' });
    await http()
      .post('/api/v1/auth/login')
      .send({ tenantCode: 'RSFA', username: u.username, password: u.password })
      .expect(401);
  });

  it('kode TOTP salah 5× menghanguskan tantangan; kode benar sesudahnya ditolak', async () => {
    const u = await createTestUser(TENANT_A);
    const s1 = await http()
      .post('/api/v1/auth/login')
      .send({ tenantCode: 'RSFA', username: u.username, password: u.password })
      .expect(200);
    for (let i = 0; i < 5; i++) {
      await http()
        .post('/api/v1/auth/mfa/verify')
        .send({ challengeToken: s1.body.challengeToken, code: '000000' })
        .expect(401);
    }
    await http()
      .post('/api/v1/auth/mfa/verify')
      .send({ challengeToken: s1.body.challengeToken, code: nextTotp(u) })
      .expect(401);
  });

  it('kode TOTP yang sama tidak bisa dipakai dua kali (anti-replay)', async () => {
    const u = await createTestUser(TENANT_A);
    const code = totpCode(base32Decode(u.totpSecret ?? ''), totpStep());
    const c1 = await http()
      .post('/api/v1/auth/login')
      .send({ tenantCode: 'RSFA', username: u.username, password: u.password })
      .expect(200);
    await http()
      .post('/api/v1/auth/mfa/verify')
      .send({ challengeToken: c1.body.challengeToken, code })
      .expect(200);
    const c2 = await http()
      .post('/api/v1/auth/login')
      .send({ tenantCode: 'RSFA', username: u.username, password: u.password })
      .expect(200);
    await http()
      .post('/api/v1/auth/mfa/verify')
      .send({ challengeToken: c2.body.challengeToken, code })
      .expect(401);
  });
});

describe('akun tanpa MFA atau wajib ganti sandi', () => {
  it('tanpa MFA: sesi terbatas → 403 MFA_REQUIRED sampai MFA didaftarkan', async () => {
    const u = await createTestUser(TENANT_A, { mfa: false });
    const res = await http()
      .post('/api/v1/auth/login')
      .send({ tenantCode: 'RSFA', username: u.username, password: u.password })
      .expect(200);
    expect(res.body.status).toBe('mfa_enrollment_required');
    const t = { accessToken: res.body.accessToken as string };
    const blocked = await http().get('/api/v1/tenancy/current').set(bearer(t)).expect(403);
    expect(blocked.body.code).toBe('MFA_REQUIRED');

    const start = await http().post('/api/v1/auth/mfa/enroll').set(bearer(t)).expect(200);
    expect(start.body.otpauthUri).toMatch(/^otpauth:\/\/totp\//);
    await http().post('/api/v1/auth/mfa/enroll/confirm').set(bearer(t)).send({ code: '000000' }).expect(400);
    const code = totpCode(base32Decode(start.body.secret), totpStep());
    await http().post('/api/v1/auth/mfa/enroll/confirm').set(bearer(t)).send({ code }).expect(200);
    await http().get('/api/v1/tenancy/current').set(bearer(t)).expect(200);
    await http().post('/api/v1/auth/mfa/enroll').set(bearer(t)).expect(409);
  });

  it('wajib ganti sandi: 403 sampai diganti; kebijakan ditegakkan; sesi lain dicabut', async () => {
    const u = await createTestUser(TENANT_A, { mustChangePassword: true });
    const other = await login(app, u);
    const t = await login(app, u);
    const blocked = await http().get('/api/v1/tenancy/current').set(bearer(t)).expect(403);
    expect(blocked.body.code).toBe('PASSWORD_CHANGE_REQUIRED');

    const weak = await http()
      .post('/api/v1/auth/password')
      .set(bearer(t))
      .send({ currentPassword: u.password, newPassword: 'password1234' })
      .expect(400);
    expect(weak.body).toMatchObject({ code: 'PASSWORD_POLICY', details: { violations: ['common'] } });
    await http()
      .post('/api/v1/auth/password')
      .set(bearer(t))
      .send({ currentPassword: 'bukan sandi lama', newPassword: 'frasa baru yang cukup panjang' })
      .expect(401);
    await http()
      .post('/api/v1/auth/password')
      .set(bearer(t))
      .send({ currentPassword: u.password, newPassword: 'frasa baru yang cukup panjang' })
      .expect(200);
    await http().get('/api/v1/tenancy/current').set(bearer(t)).expect(200);
    await http().get('/api/v1/auth/me').set(bearer(other)).expect(401);
  });
});

describe('sesi', () => {
  it('refresh berotasi; token akses lama mati; pemakaian ulang refresh lama mencabut sesi', async () => {
    const u = await createTestUser(TENANT_A);
    const t1 = await login(app, u);
    const r = await http().post('/api/v1/auth/refresh').send({ refreshToken: t1.refreshToken }).expect(200);
    await http().get('/api/v1/auth/me').set(bearer(t1)).expect(401);
    await http().get('/api/v1/auth/me').set(bearer(r.body)).expect(200);
    // Penyerang memakai refresh token lama → sesi dicabut, token baru pun mati.
    await http().post('/api/v1/auth/refresh').send({ refreshToken: t1.refreshToken }).expect(401);
    await http().get('/api/v1/auth/me').set(bearer(r.body)).expect(401);
    await http().post('/api/v1/auth/refresh').send({ refreshToken: r.body.refreshToken }).expect(401);
    const [audit] = await withTenant(testDb(), TENANT_A, (tx) =>
      tx.auditEvent.findMany({ where: { actorUserId: u.id, action: 'session_revoked' } }),
    );
    expect(audit?.details).toMatchObject({ reason: 'refresh_reuse' });
  });

  it('logout mematikan token seketika', async () => {
    const u = await createTestUser(TENANT_A);
    const t = await login(app, u);
    await http().post('/api/v1/auth/logout').set(bearer(t)).expect(200);
    await http().get('/api/v1/auth/me').set(bearer(t)).expect(401);
  });

  it('sesi idle melewati batas dicabut', async () => {
    const u = await createTestUser(TENANT_A);
    const t = await login(app, u);
    const sessionId = t.accessToken.split('.')[2] as string;
    await withTenant(testDb(), TENANT_A, (tx) =>
      tx.authSession.update({
        where: { id: sessionId },
        data: { lastSeenAt: new Date(Date.now() - 20 * 60_000) },
      }),
    );
    await http().get('/api/v1/auth/me').set(bearer(t)).expect(401);
    const s = await withTenant(testDb(), TENANT_A, (tx) =>
      tx.authSession.findUnique({ where: { id: sessionId } }),
    );
    expect(s).toMatchObject({ status: 'revoked', revokedReason: 'idle_timeout' });
  });

  it('akun dinonaktifkan → sesi aktif langsung tidak berlaku', async () => {
    const u = await createTestUser(TENANT_A);
    const t = await login(app, u);
    await withTenant(testDb(), TENANT_A, (tx) =>
      tx.user.update({ where: { id: u.id }, data: { status: 'disabled' } }),
    );
    await http().get('/api/v1/auth/me').set(bearer(t)).expect(401);
  });

  it('header tenant berbeda dari sesi → 403 TENANT_MISMATCH', async () => {
    const u = await createTestUser(TENANT_A);
    const t = await login(app, u);
    const res = await http()
      .get('/api/v1/tenancy/current')
      .set(bearer(t))
      .set('X-Tenant-Id', TENANT_B)
      .expect(403);
    expect(res.body.code).toBe('TENANT_MISMATCH');
  });

  it('token dipalsukan (tenant diganti, jenis salah, rahasia salah) → 401', async () => {
    const u = await createTestUser(TENANT_A);
    const t = await login(app, u);
    const [, , sid, secret] = t.accessToken.split('.');
    for (const forged of [
      `sa1.${TENANT_B}.${sid}.${secret}`,
      `sr1.${TENANT_A}.${sid}.${secret}`,
      `sa1.${TENANT_A}.${sid}.${'A'.repeat(43)}`,
      t.refreshToken,
    ]) {
      await http().get('/api/v1/auth/me').set('Authorization', `Bearer ${forged}`).expect(401);
    }
  });

  it('kata sandi dan rahasia MFA tidak tersimpan dalam bentuk asli', async () => {
    const u = await createTestUser(TENANT_A);
    await login(app, u);
    const row = await withTenant(testDb(), TENANT_A, async (tx) => ({
      cred: await tx.userCredential.findUnique({ where: { userId: u.id } }),
      factor: await tx.mfaFactor.findFirst({ where: { userId: u.id } }),
      session: await tx.authSession.findFirst({ where: { userId: u.id } }),
    }));
    expect(row.cred?.passwordHash).toMatch(/^\$argon2id\$/);
    expect(row.cred?.passwordHash).not.toContain(u.password);
    expect(row.factor?.secretEnc).not.toContain(u.totpSecret ?? '-');
    expect(row.session?.accessHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('produksi: RS dari subdomain, tanpa mode header', () => {
  it('login lewat host terdaftar; kode RS di formulir diabaikan; header tenant tanpa token ditolak', async () => {
    const prod = await createTestApp({ APP_ENV: 'production' });
    const owner = createPrismaClient({ connectionString: testDbUrls().migrator, max: 1 });
    try {
      await owner.$executeRaw`INSERT INTO tenant_domains (host, tenant_id) VALUES ('rsfa.simrs.test', ${TENANT_A}::uuid)
        ON CONFLICT (host) DO NOTHING`;
      const u = await createTestUser(TENANT_A);
      const ph = () => request(prod.getHttpServer());
      await ph()
        .post('/api/v1/auth/login')
        .set('Host', 'tidak.terdaftar.test')
        .send({ tenantCode: 'RSFA', username: u.username, password: u.password })
        .expect(401);
      const s1 = await ph()
        .post('/api/v1/auth/login')
        .set('Host', 'rsfa.simrs.test')
        .send({ username: u.username, password: u.password })
        .expect(200);
      const s2 = await ph()
        .post('/api/v1/auth/mfa/verify')
        .send({ challengeToken: s1.body.challengeToken, code: nextTotp(u) })
        .expect(200);
      await ph().get('/api/v1/tenancy/current').set(bearer(s2.body)).expect(200);
      await ph().get('/api/v1/tenancy/current').set('X-Tenant-Id', TENANT_A).expect(401);
    } finally {
      await owner.$disconnect();
      await prod.close();
    }
  });
});

describe('rate limit endpoint kredensial', () => {
  it('permintaan login ke-4 dalam semenit (batas 3) → 429', async () => {
    const limited = await createTestApp({ AUTH_RATE_LIMIT_PER_MIN: '3' });
    try {
      for (let i = 0; i < 3; i++) {
        await request(limited.getHttpServer())
          .post('/api/v1/auth/login')
          .send({ tenantCode: 'RSFA', username: 'x.y.z', password: 'x' })
          .expect(401);
      }
      const res = await request(limited.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ tenantCode: 'RSFA', username: 'x.y.z', password: 'x' })
        .expect(429);
      expect(res.body.code).toBe('RATE_LIMITED');
    } finally {
      await limited.close();
    }
  });
});
