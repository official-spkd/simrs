/**
 * P02 · PIN masuk cepat per perangkat terdaftar (docs/05 §1, ADR-0024): daftar dari login penuh, masuk dengan token
 * perangkat + PIN, sesi pendek terkunci ke posisi pendaftaran, batas percobaan (juga tebakan paralel), pencabutan
 * (hapus, ganti/reset sandi, reset MFA, nonaktif, penugasan berakhir, admin), kedaluwarsa, isolasi tenant, subdomain
 * produksi, audit, dan penolakan untuk peran sensitif/operator platform.
 */
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createPrismaClient, withTenant } from '@simrs/db';
import { testDbUrls } from '@simrs/db/testing';
import { newId, PIN_MAX_DEVICES_PER_USER } from '@simrs/shared';
import { hashPassword } from '@simrs/shared/node';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { issueToken } from '../src/infra/auth/session-tokens';
import { pinSecret } from '../src/modules/auth/pin';
import {
  bearer,
  createTestApp,
  createTestTenant,
  createTestUser,
  jsonText,
  login,
  TENANT_PLATFORM,
  type TestUser,
  testDb,
  type Tokens,
} from './helpers';

let app: NestExpressApplication;
let T: { id: string; code: string };
let unitId: string;
const http = () => request(app.getHttpServer());
const DAY = 86_400_000;
const PIN = '730594';
const WRONG = '730595';

async function createUnit(tenantId: string): Promise<string> {
  return withTenant(testDb(), tenantId, async (tx) => {
    const facilityId = newId();
    const suffix = facilityId.slice(-6).toUpperCase();
    await tx.facility.create({ data: { id: facilityId, tenantId, code: `F${suffix}`, name: 'Gedung uji' } });
    const unit = await tx.unit.create({
      data: {
        id: newId(),
        tenantId,
        facilityId,
        code: `M${suffix}`,
        name: 'Bangsal Melati',
        kind: 'rawat_inap',
      },
    });
    return unit.id;
  });
}

const nurse = (roles: Array<{ code: string; unitId?: string }> = [{ code: 'perawat', unitId }]) =>
  createTestUser(T.id, { roles, tenantCode: T.code });

const register = (user: TestUser, tok: Tokens, body: object = {}) =>
  http()
    .post('/api/v1/auth/pin/devices')
    .set(bearer(tok))
    .send({ name: 'Komputer nurse station', pin: PIN, password: user.password, ...body });

const pinLogin = (deviceToken: string, pin: string, server = http()) =>
  server.post('/api/v1/auth/pin/login').send({ deviceToken, pin });

/** Login penuh + daftar PIN; mengembalikan token perangkat dan ID-nya. */
async function enrolled(user: TestUser): Promise<{ tok: Tokens; token: string; id: string }> {
  const tok = await login(app, user);
  const reg = await register(user, tok).expect(201);
  return { tok, token: reg.body.token, id: reg.body.id };
}

const pinRow = (id: string, tenantId = T.id) =>
  withTenant(testDb(), tenantId, (tx) => tx.pinDevice.findUniqueOrThrow({ where: { id } }));

const auditOf = (userId: string, action: string) =>
  withTenant(testDb(), T.id, (tx) =>
    tx.auditEvent.findMany({ where: { actorUserId: userId, action }, orderBy: { seq: 'asc' } }),
  );

beforeAll(async () => {
  app = await createTestApp();
  T = await createTestTenant();
  unitId = await createUnit(T.id);
});

afterAll(async () => {
  await app?.close();
});

describe('daftar PIN dan masuk dengan PIN', () => {
  it('daftar dari login penuh → masuk dengan PIN: sesi pendek di posisi pendaftaran, tercatat di audit', async () => {
    const user = await nurse();
    const tok = await login(app, user);
    const reg = await register(user, tok).expect(201);
    expect(reg.body).toMatchObject({
      name: 'Komputer nurse station',
      roleName: 'Perawat',
      unitName: 'Bangsal Melati',
    });
    expect(reg.body.token).toMatch(/^sd1\./);
    const ttl = Date.parse(reg.body.expiresAt) - Date.now();
    expect(ttl).toBeGreaterThan(29.9 * DAY);
    expect(ttl).toBeLessThanOrEqual(30 * DAY);

    const row = await pinRow(reg.body.id);
    expect(row.pinHash).toMatch(/^\$argon2id\$/);
    expect(row.pinHash).not.toContain(PIN);
    expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(reg.body.token).not.toContain(row.tokenHash);

    const list = await http().get('/api/v1/auth/pin/devices').set(bearer(tok)).expect(200);
    expect(list.body).toEqual([
      expect.objectContaining({
        id: reg.body.id,
        roleName: 'Perawat',
        unitName: 'Bangsal Melati',
        current: false,
      }),
    ]);

    const s = await pinLogin(reg.body.token, PIN).expect(200);
    expect(s.body.status).toBe('authenticated');
    expect(Date.parse(s.body.refreshExpiresAt) - Date.now()).toBeLessThanOrEqual(2 * 3_600_000);
    const me = await http().get('/api/v1/auth/me').set(bearer(s.body)).expect(200);
    expect(me.body.role).toEqual({ code: 'perawat', name: 'Perawat' });
    expect(me.body.unit).toEqual({ id: unitId, name: 'Bangsal Melati' });
    expect(me.body.session.quickLogin).toBe(true);
    expect(me.body.mfa.sessionVerified).toBe(true);
    const session = await withTenant(testDb(), T.id, (tx) =>
      tx.authSession.findFirstOrThrow({ where: { userId: user.id, pinDeviceId: reg.body.id } }),
    );
    expect(session.idleTimeoutMinutes).toBeLessThanOrEqual(5);
    // Halaman staf langsung bisa dibuka (sesi lengkap, posisi sudah dipilih).
    await http().get('/api/v1/tenancy/current').set(bearer(s.body)).expect(200);
    const mine = await http().get('/api/v1/auth/pin/devices').set(bearer(s.body)).expect(200);
    expect(mine.body[0].current).toBe(true);

    const created = await auditOf(user.id, 'create');
    expect(created.find((a) => a.resourceType === 'pin_device')).toMatchObject({
      resourceId: reg.body.id,
      details: { method: 'pin', role: 'perawat', unitId },
    });
    const logins = await auditOf(user.id, 'login');
    expect(logins.at(-1)?.details).toMatchObject({ method: 'pin', pinDeviceId: reg.body.id });
    const trail = jsonText([...created, ...logins]);
    expect(trail).not.toContain(PIN);
    expect(trail).not.toContain(reg.body.token.split('.')[3]);
  });

  it('sesi PIN terkunci ke posisinya: posisi lain (sensitif) dan daftar PIN baru ditolak', async () => {
    const user = await nurse([{ code: 'perawat', unitId }, { code: 'admin_tenant' }]);
    const tok = await login(app, user);
    const options = await http().get('/api/v1/auth/assignments').set(bearer(tok)).expect(200);
    const perawat = options.body.find((o: { roleCode: string }) => o.roleCode === 'perawat');
    const admin = options.body.find((o: { roleCode: string }) => o.roleCode === 'admin_tenant');
    // Daftar PIN butuh posisi terpilih.
    expect((await register(user, tok).expect(409)).body.message).toMatch(/Pilih posisi/);
    await http()
      .post('/api/v1/auth/assignment')
      .set(bearer(tok))
      .send({ assignmentId: perawat.id })
      .expect(200);
    const reg = await register(user, tok).expect(201);

    const s = (await pinLogin(reg.body.token, PIN).expect(200)).body;
    const list = await http().get('/api/v1/auth/assignments').set(bearer(s)).expect(200);
    expect(list.body.map((o: { id: string }) => o.id)).toEqual([perawat.id]);
    const denied = await http()
      .post('/api/v1/auth/assignment')
      .set(bearer(s))
      .send({ assignmentId: admin.id })
      .expect(403);
    expect(denied.body.message).toMatch(/Sesi PIN terikat/);
    await http().get('/api/v1/iam/users').set(bearer(s)).expect(403);
    const again = await register(user, s).expect(403);
    expect(again.body.message).toMatch(/kata sandi dan kode verifikasi/);
  });

  it('daftar ditolak: sandi salah, PIN lemah, peran sensitif, posisi tanpa unit, operator platform, batas perangkat', async () => {
    const user = await nurse();
    const tok = await login(app, user);
    const badPassword = await register(user, tok, { password: 'bukan sandinya' }).expect(400);
    expect(badPassword.body.details).toEqual({ field: 'password' });
    const weak = await register(user, tok, { pin: '123456' }).expect(400);
    expect(weak.body).toMatchObject({ code: 'VALIDATION_FAILED', details: { field: 'pin' } });
    await register(user, tok, { pin: '12345' }).expect(400);
    await http()
      .post('/api/v1/auth/pin/devices')
      .set('Authorization', `Bearer sa1.${T.id}.${newId()}.${'A'.repeat(43)}`)
      .send({ name: 'Komputer', pin: PIN, password: 'x' })
      .expect(401);

    const kasir = await nurse([{ code: 'kasir', unitId }]);
    const kasirTok = await login(app, kasir);
    expect((await register(kasir, kasirTok).expect(403)).body.message).toMatch(/Kasir/);

    const dokter = await nurse([{ code: 'dokter' }]);
    const dokterTok = await login(app, dokter);
    expect((await register(dokter, dokterTok).expect(400)).body.message).toMatch(/unit kerja/);

    const operator = await createTestUser(TENANT_PLATFORM, { roles: [{ code: 'superadmin_platform' }] });
    const operatorTok = await login(app, operator);
    expect((await register(operator, operatorTok).expect(403)).body.message).toMatch(/operator platform/);

    for (let i = 0; i < PIN_MAX_DEVICES_PER_USER; i++) await register(user, tok).expect(201);
    expect((await register(user, tok).expect(409)).body.message).toMatch(/Maksimal 5/);
  });

  it('akun ber-PIN di peramban: hanya token sah dan masih berlaku, urut seperti cookie', async () => {
    const a = await nurse();
    const b = await nurse();
    const ea = await enrolled(a);
    const eb = await enrolled(b);
    const forged = `${ea.token.slice(0, -4)}AAAA`;
    const res = await http()
      .post('/api/v1/auth/pin/accounts')
      .send({ deviceTokens: [eb.token, forged, 'sd1.bukan-token-sah-sama-sekali', ea.token] })
      .expect(200);
    expect(res.body).toEqual([
      { id: eb.id, displayName: 'Pengguna Uji Fiktif', roleName: 'Perawat', unitName: 'Bangsal Melati' },
      { id: ea.id, displayName: 'Pengguna Uji Fiktif', roleName: 'Perawat', unitName: 'Bangsal Melati' },
    ]);
    await http().post('/api/v1/auth/pin/accounts').send({ deviceTokens: [] }).expect(400);
  });
});

describe('batas percobaan PIN', () => {
  it('sisa percobaan; PIN benar mereset hitungan; salah ke-5 mencabut PIN → wajib login penuh', async () => {
    const user = await nurse();
    const { token, id } = await enrolled(user);
    for (const remaining of [4, 3]) {
      const r = await pinLogin(token, WRONG).expect(401);
      expect(r.body.details).toEqual({ pin: 'wrong', remaining });
    }
    await pinLogin(token, PIN).expect(200);
    expect((await pinRow(id)).failedAttempts).toBe(0);
    for (const remaining of [4, 3, 2, 1]) {
      expect((await pinLogin(token, WRONG).expect(401)).body.details).toEqual({ pin: 'wrong', remaining });
    }
    const fifth = await pinLogin(token, WRONG).expect(401);
    expect(fifth.body.details).toEqual({ pin: 'revoked' });
    expect(fifth.body.message).toMatch(/dinonaktifkan/);
    expect((await pinLogin(token, PIN).expect(401)).body.details).toEqual({ pin: 'revoked' });
    const row = await pinRow(id);
    expect(row).toMatchObject({ failedAttempts: 5, revokedReason: 'too_many_attempts', revokedBy: null });
    expect(
      (
        await http()
          .post('/api/v1/auth/pin/accounts')
          .send({ deviceTokens: [token] })
          .expect(200)
      ).body,
    ).toEqual([]);
    const failed = await auditOf(user.id, 'login_failed');
    expect(failed.filter((a) => (a.details as { reason?: string }).reason === 'bad_pin')).toHaveLength(7);
    expect(failed.every((a) => a.outcome === 'denied')).toBe(true);
    // Login penuh tetap bisa; PIN didaftarkan ulang dari sana.
    const tok = await login(app, user);
    await register(user, tok).expect(201);
  });

  it('tebakan paralel tidak melewati batas: tepat 5 PIN diperiksa', async () => {
    const user = await nurse();
    const { token, id } = await enrolled(user);
    const results = await Promise.all(Array.from({ length: 8 }, () => pinLogin(token, WRONG)));
    expect(results.every((r) => r.status === 401)).toBe(true);
    const kinds = results.map((r) => (r.body.details as { pin: string }).pin).sort();
    expect(kinds).toEqual(['revoked', 'revoked', 'revoked', 'revoked', 'wrong', 'wrong', 'wrong', 'wrong']);
    expect(await pinRow(id)).toMatchObject({ failedAttempts: 5, revokedReason: 'too_many_attempts' });
    const failed = await auditOf(user.id, 'login_failed');
    expect(failed.filter((a) => (a.details as { reason?: string }).reason === 'bad_pin')).toHaveLength(5);
  });

  it('akun terkunci sementara (sandi salah berulang): PIN ditolak tanpa dicabut', async () => {
    const user = await nurse();
    const { token, id } = await enrolled(user);
    const lock = (until: Date | null) =>
      withTenant(testDb(), T.id, (tx) =>
        tx.user.update({ where: { id: user.id }, data: { lockedUntil: until } }),
      );
    await lock(new Date(Date.now() + 10 * 60_000));
    expect((await pinLogin(token, PIN).expect(401)).body.details).toEqual({ pin: 'not_allowed' });
    expect((await pinRow(id)).revokedAt).toBeNull();
    await lock(null);
    await pinLogin(token, PIN).expect(200);
  });

  it('PIN lewat 30 hari tidak berlaku', async () => {
    const user = await nurse();
    const assignment = await withTenant(testDb(), T.id, (tx) =>
      tx.staffAssignment.findFirstOrThrow({ where: { userId: user.id } }),
    );
    const id = newId();
    const t = issueToken('sd1', T.id, id);
    const createdAt = new Date(Date.now() - 30 * DAY - 3_600_000);
    await withTenant(testDb(), T.id, async (tx) =>
      tx.pinDevice.create({
        data: {
          id,
          tenantId: T.id,
          userId: user.id,
          assignmentId: assignment.id,
          name: 'Perangkat lama',
          tokenHash: t.hash,
          pinHash: await hashPassword(
            pinSecret(
              process.env.FIELD_HASH_KEY ?? '',
              { tenantId: T.id, deviceId: id, userId: user.id },
              PIN,
            ),
          ),
          createdAt,
          expiresAt: new Date(createdAt.getTime() + 30 * DAY),
        },
      }),
    );
    expect((await pinLogin(t.token, PIN).expect(401)).body.details).toEqual({ pin: 'revoked' });
    expect(
      (
        await http()
          .post('/api/v1/auth/pin/accounts')
          .send({ deviceTokens: [t.token] })
          .expect(200)
      ).body,
    ).toEqual([]);
  });
});

describe('pencabutan PIN', () => {
  it('pemilik menghapus perangkat: sesi PIN berakhir, token tidak berlaku, tercatat; akun lain tidak bisa', async () => {
    const user = await nurse();
    const { tok, token, id } = await enrolled(user);
    const s = (await pinLogin(token, PIN).expect(200)).body;
    const other = await nurse();
    const otherTok = await login(app, other);
    await http().post(`/api/v1/auth/pin/devices/${id}/revoke`).set(bearer(otherTok)).expect(404);

    await http().post(`/api/v1/auth/pin/devices/${id}/revoke`).set(bearer(tok)).expect(200);
    await http().get('/api/v1/auth/me').set(bearer(s)).expect(401);
    await http().post('/api/v1/auth/refresh').send({ refreshToken: s.refreshToken }).expect(401);
    expect((await pinLogin(token, PIN).expect(401)).body.details).toEqual({ pin: 'revoked' });
    expect((await http().get('/api/v1/auth/pin/devices').set(bearer(tok)).expect(200)).body).toEqual([]);
    expect(await pinRow(id)).toMatchObject({ revokedReason: 'user_removed', revokedBy: user.id });
    const audit = await auditOf(user.id, 'deactivate');
    expect(audit.at(-1)).toMatchObject({
      resourceType: 'pin_device',
      resourceId: id,
      details: { reason: 'user_removed' },
    });
    await http().post(`/api/v1/auth/pin/devices/${id}/revoke`).set(bearer(tok)).expect(404);
  });

  it('ganti sandi, reset sandi/MFA oleh admin, nonaktif, penugasan berakhir, dan cabut admin mencabut PIN', async () => {
    const admin = await nurse([{ code: 'admin_tenant' }]);
    const adminTok = await login(app, admin);
    const asAdmin = (path: string, body: object = {}) =>
      http().post(path).set(bearer(adminTok)).send(body).expect(200);

    const changed = await nurse();
    const c = await enrolled(changed);
    await http()
      .post('/api/v1/auth/password')
      .set(bearer(c.tok))
      .send({ currentPassword: changed.password, newPassword: `kalimat sandi baru yang panjang ${newId()}` })
      .expect(200);

    const reset = await nurse();
    const r = await enrolled(reset);
    await asAdmin(`/api/v1/iam/users/${reset.id}/reset-password`);

    const mfa = await nurse();
    const m = await enrolled(mfa);
    await asAdmin(`/api/v1/iam/users/${mfa.id}/reset-mfa`);

    const disabled = await nurse();
    const d = await enrolled(disabled);
    await http()
      .patch(`/api/v1/iam/users/${disabled.id}`)
      .set(bearer(adminTok))
      .send({ status: 'disabled' })
      .expect(200);

    const moved = await nurse();
    const e = await enrolled(moved);
    const assignment = await withTenant(testDb(), T.id, (tx) =>
      tx.staffAssignment.findFirstOrThrow({ where: { userId: moved.id } }),
    );
    await asAdmin(`/api/v1/iam/assignments/${assignment.id}/end`, { reason: 'Pindah ke unit lain' });

    const lost = await nurse();
    const l = await enrolled(lost);
    const detail = await http().get(`/api/v1/iam/users/${lost.id}`).set(bearer(adminTok)).expect(200);
    expect(detail.body.pinDevices).toEqual([
      expect.objectContaining({ id: l.id, name: 'Komputer nurse station', roleName: 'Perawat' }),
    ]);
    await asAdmin(`/api/v1/iam/pin-devices/${l.id}/revoke`);
    expect((await http().get(`/api/v1/iam/users/${lost.id}`).set(bearer(adminTok))).body.pinDevices).toEqual(
      [],
    );
    await http().post(`/api/v1/iam/pin-devices/${l.id}/revoke`).set(bearer(adminTok)).expect(404);

    const expected: Array<[{ token: string; id: string }, string, string | null]> = [
      [c, 'password_changed', changed.id],
      [r, 'password_reset', admin.id],
      [m, 'mfa_reset', admin.id],
      [d, 'user_disabled', admin.id],
      [e, 'assignment_ended', admin.id],
      [l, 'admin_revoked', admin.id],
    ];
    for (const [device, reason, by] of expected) {
      expect(await pinRow(device.id)).toMatchObject({ revokedReason: reason, revokedBy: by });
      expect((await pinLogin(device.token, PIN).expect(401)).body.details).toEqual({ pin: 'revoked' });
    }
    const adminAudit = await auditOf(admin.id, 'deactivate');
    expect(adminAudit.at(-1)).toMatchObject({
      resourceType: 'pin_device',
      resourceId: l.id,
      details: { reason: 'admin_revoked' },
    });
    // Peran tanpa izin kelola pengguna tidak bisa mencabut PIN orang lain.
    const peer = await nurse();
    const peerTok = await login(app, peer);
    const victim = await nurse();
    const v = await enrolled(victim);
    await http().post(`/api/v1/iam/pin-devices/${v.id}/revoke`).set(bearer(peerTok)).expect(403);
    expect((await pinRow(v.id)).revokedAt).toBeNull();
  });
});

describe('isolasi tenant dan subdomain produksi', () => {
  it('token dengan tenant lain tidak dikenali; pengguna/admin RS lain tidak bisa mencabut', async () => {
    const user = await nurse();
    const { token, id } = await enrolled(user);
    const U = await createTestTenant();
    const swapped = token.replace(T.id, U.id);
    expect((await pinLogin(swapped, PIN).expect(401)).body.details).toEqual({ pin: 'unknown' });
    expect(
      (
        await http()
          .post('/api/v1/auth/pin/accounts')
          .send({ deviceTokens: [swapped] })
          .expect(200)
      ).body,
    ).toEqual([]);

    const otherAdmin = await createTestUser(U.id, { roles: [{ code: 'admin_tenant' }], tenantCode: U.code });
    const otherTok = await login(app, otherAdmin);
    await http().post(`/api/v1/iam/pin-devices/${id}/revoke`).set(bearer(otherTok)).expect(404);
    await http().post(`/api/v1/auth/pin/devices/${id}/revoke`).set(bearer(otherTok)).expect(404);
    expect((await pinRow(id)).revokedAt).toBeNull();
    await pinLogin(token, PIN).expect(200);
  });

  it('produksi: token perangkat hanya berlaku di subdomain RS-nya', async () => {
    const user = await nurse();
    const { token } = await enrolled(user);
    const host = `pin-${T.code.toLowerCase()}.simrs.test`;
    const owner = createPrismaClient({ connectionString: testDbUrls().migrator, max: 1 });
    const prod = await createTestApp({ APP_ENV: 'production' });
    try {
      await owner.$executeRaw`INSERT INTO tenant_domains (host, tenant_id) VALUES (${host}, ${T.id}::uuid)
        ON CONFLICT (host) DO NOTHING`;
      const ph = () => request(prod.getHttpServer());
      const accounts = (h: string) =>
        ph()
          .post('/api/v1/auth/pin/accounts')
          .set('Host', h)
          .send({ deviceTokens: [token] })
          .expect(200);
      expect((await accounts('tidak.terdaftar.test')).body).toEqual([]);
      expect((await accounts(host)).body).toHaveLength(1);
      await ph()
        .post('/api/v1/auth/pin/login')
        .set('Host', 'tidak.terdaftar.test')
        .send({ deviceToken: token, pin: PIN })
        .expect(401);
      await ph()
        .post('/api/v1/auth/pin/login')
        .set('Host', host)
        .send({ deviceToken: token, pin: PIN })
        .expect(200);
    } finally {
      await owner.$disconnect();
      await prod.close();
    }
  });
});
