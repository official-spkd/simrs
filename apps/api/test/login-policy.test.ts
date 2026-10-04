/**
 * P02 · Kebijakan login per RS (pengaturan P12):
 * - kode cadangan: kanal yang aktif, peran wajib aplikasi autentikator (bawaan: peran sensitif), penolakan diaudit;
 * - PIN masuk cepat: bisa dimatikan per RS atau dipersempit perannya (ADR-0024).
 */
import type { NestExpressApplication } from '@nestjs/platform-express';
import { withTenant } from '@simrs/db';
import { newId, SENSITIVE_ROLES } from '@simrs/shared';
import { decryptField, encryptField } from '@simrs/shared/node';
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
let unitId: string;
let adminTok: Tokens;
let admin: TestUser;
const http = () => request(app.getHttpServer());
const key = () => process.env.FIELD_ENCRYPTION_KEY ?? '';
const PIN = '730594';

const setSetting = (k: string, value: unknown, tok = adminTok) =>
  http().put(`/api/v1/settings/${k}`).set(bearer(tok)).send({ value });

async function userWith(roles: Array<{ code: string; unitId?: string }>): Promise<TestUser> {
  const u = await createTestUser(T.id, { roles, tenantCode: T.code });
  await withTenant(testDb(), T.id, (tx) =>
    tx.user.update({
      where: { id: u.id },
      data: {
        email: `${u.username}@rs-fiktif.test`,
        phoneEnc: encryptField('6281200007777', { keyB64: key(), tenantId: T.id, purpose: 'staff_phone' }),
      },
    }),
  );
  return u;
}

const challengeOf = async (u: TestUser) =>
  (
    await http()
      .post('/api/v1/auth/login')
      .send({ tenantCode: u.tenantCode, username: u.username, password: u.password })
      .expect(200)
  ).body.challengeToken as string;

const options = (challengeToken: string) =>
  http().post('/api/v1/auth/mfa/backup-options').send({ challengeToken });
const sendCode = (challengeToken: string, channel: 'whatsapp' | 'email') =>
  http().post('/api/v1/auth/mfa/backup-code').send({ challengeToken, channel });

beforeAll(async () => {
  app = await createTestApp();
  T = await createTestTenant();
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
  admin = await createTestUser(T.id, { roles: [{ code: 'admin_tenant' }], tenantCode: T.code });
  adminTok = await login(app, admin);
});

afterAll(async () => {
  await app?.close();
});

describe('kode cadangan menurut pengaturan RS', () => {
  it('bawaan: peran sensitif wajib aplikasi (ditolak + diaudit), peran layanan boleh dua kanal', async () => {
    const perawat = await userWith([{ code: 'perawat' }]);
    expect((await options(await challengeOf(perawat)).expect(200)).body).toEqual({
      channels: ['whatsapp', 'email'],
    });
    // Akun dengan posisi sensitif di salah satu penugasannya: tanpa kode cadangan.
    const kasir = await userWith([{ code: 'perawat' }, { code: 'kasir' }]);
    const ch = await challengeOf(kasir);
    expect((await options(ch).expect(200)).body).toEqual({ channels: [] });
    const denied = await sendCode(ch, 'whatsapp').expect(403);
    expect(denied.body.message).toMatch(/Kasir wajib memakai kode dari aplikasi autentikator/);
    const audit = await withTenant(testDb(), T.id, (tx) =>
      tx.auditEvent.findFirstOrThrow({
        where: { actorUserId: kasir.id, action: 'access_denied' },
        orderBy: { seq: 'desc' },
      }),
    );
    expect(audit).toMatchObject({
      resourceType: 'login_challenge',
      outcome: 'denied',
      details: { backupCode: 'whatsapp', reason: 'totp_only' },
    });
    // TOTP tetap jalan.
    await http()
      .post('/api/v1/auth/mfa/verify')
      .send({ challengeToken: ch, code: nextTotp(kasir) })
      .expect(200);
    await options(`${ch.slice(0, -2)}xx`).expect(401);
  });

  it('kanal dipersempit, daftar wajib-TOTP diubah; kode yang terkirim sebelum diperketat tidak berlaku', async () => {
    const perawat = await userWith([{ code: 'perawat' }]);
    await setSetting('login.backup_code_channels', ['email']).expect(200);
    try {
      const ch = await challengeOf(perawat);
      expect((await options(ch).expect(200)).body).toEqual({ channels: ['email'] });
      expect((await sendCode(ch, 'whatsapp').expect(403)).body.message).toMatch(/WhatsApp tidak diaktifkan/);
      await sendCode(ch, 'email').expect(200);

      // Kasir diizinkan kode cadangan bila RS mengosongkan daftar wajib-TOTP.
      const kasir = await userWith([{ code: 'kasir' }]);
      await setSetting('login.totp_only_roles', []).expect(200);
      expect((await options(await challengeOf(kasir)).expect(200)).body).toEqual({ channels: ['email'] });
      await setSetting('login.totp_only_roles', [...SENSITIVE_ROLES]).expect(200);

      // Kode terkirim, lalu RS mematikan kode cadangan: kode itu ditolak.
      const ch2 = await challengeOf(perawat);
      await sendCode(ch2, 'email').expect(200);
      const id = ch2.split('.')[2] as string;
      const row = await withTenant(testDb(), T.id, (tx) =>
        tx.loginChallenge.findUniqueOrThrow({ where: { id }, select: { otpEnc: true } }),
      );
      const code = decryptField(row.otpEnc as string, {
        keyB64: key(),
        tenantId: T.id,
        purpose: 'login_otp',
      });
      await setSetting('login.backup_code_channels', []).expect(200);
      await http().post('/api/v1/auth/mfa/verify').send({ challengeToken: ch2, code }).expect(401);
      expect((await options(await challengeOf(perawat)).expect(200)).body).toEqual({ channels: [] });
    } finally {
      await setSetting('login.backup_code_channels', ['whatsapp', 'email']).expect(200);
      await setSetting('login.totp_only_roles', [...SENSITIVE_ROLES]).expect(200);
    }
  });

  it('pengaturan divalidasi: kanal/peran ganda, kanal tak dikenal, peran PIN di luar daftar layanan', async () => {
    await setSetting('login.backup_code_channels', ['email', 'email']).expect(400);
    await setSetting('login.backup_code_channels', ['sms']).expect(400);
    await setSetting('login.totp_only_roles', ['kasir', 'kasir']).expect(400);
    await setSetting('pin.allowed_roles', ['perawat', 'kasir']).expect(400);
    await setSetting('pin.enabled', 'ya').expect(400);
    const list = await http().get('/api/v1/settings').set(bearer(adminTok)).expect(200);
    const byKey = Object.fromEntries(
      (list.body as Array<{ key: string; value: unknown }>).map((s) => [s.key, s.value]),
    );
    expect(byKey['pin.enabled']).toBe(true);
    expect(byKey['login.totp_only_roles']).toContain('petugas_rm');
    expect(byKey['pin.allowed_roles']).toContain('perawat');
  });
});

describe('PIN masuk cepat menurut pengaturan RS', () => {
  it('ketersediaan di /auth/me; RS mematikan PIN atau mempersempit peran → daftar dan masuk ditolak', async () => {
    const perawat = await userWith([{ code: 'perawat', unitId }]);
    const tok = await login(app, perawat);
    const me = async (t: Tokens) => (await http().get('/api/v1/auth/me').set(bearer(t)).expect(200)).body.pin;
    expect(await me(tok)).toEqual({ available: true, reason: null });
    const reg = await http()
      .post('/api/v1/auth/pin/devices')
      .set(bearer(tok))
      .send({ name: 'Komputer nurse station', pin: PIN, password: perawat.password })
      .expect(201);
    const pinLogin = () =>
      http().post('/api/v1/auth/pin/login').send({ deviceToken: reg.body.token, pin: PIN });
    const accounts = () =>
      http()
        .post('/api/v1/auth/pin/accounts')
        .send({ deviceTokens: [reg.body.token] })
        .expect(200);
    const pinSession = (await pinLogin().expect(200)).body;
    expect(await me(pinSession)).toEqual({ available: false, reason: 'quick_session' });

    await setSetting('pin.enabled', false).expect(200);
    try {
      expect(await me(tok)).toEqual({ available: false, reason: 'disabled' });
      expect((await pinLogin().expect(401)).body.details).toEqual({ pin: 'not_allowed' });
      expect((await accounts()).body).toEqual([]);
      const off = await http()
        .post('/api/v1/auth/pin/devices')
        .set(bearer(tok))
        .send({ name: 'Komputer lain', pin: PIN, password: perawat.password })
        .expect(403);
      expect(off.body.message).toMatch(/dinonaktifkan oleh RS/);
    } finally {
      await setSetting('pin.enabled', true).expect(200);
    }
    // PIN tidak dicabut saat dimatikan: aktif lagi begitu RS menyalakannya kembali.
    expect((await accounts()).body).toHaveLength(1);

    await setSetting('pin.allowed_roles', ['dokter', 'bidan']).expect(200);
    try {
      expect(await me(tok)).toEqual({ available: false, reason: 'role' });
      expect((await pinLogin().expect(401)).body.details).toEqual({ pin: 'not_allowed' });
      const narrowed = await http()
        .post('/api/v1/auth/pin/devices')
        .set(bearer(tok))
        .send({ name: 'Komputer lain', pin: PIN, password: perawat.password })
        .expect(403);
      expect(narrowed.body.message).toMatch(/tidak mengizinkan PIN masuk cepat untuk posisi Perawat/);
    } finally {
      await setSetting('pin.allowed_roles', ['perawat', 'dokter', 'bidan']).expect(200);
    }
    await pinLogin().expect(200);
  });

  it('alasan lain: peran sensitif, posisi tanpa unit', async () => {
    const kasir = await userWith([{ code: 'kasir', unitId }]);
    const noUnit = await userWith([{ code: 'perawat' }]);
    for (const [u, reason] of [
      [kasir, 'role'],
      [noUnit, 'no_unit'],
    ] as const) {
      const t = await login(app, u);
      expect((await http().get('/api/v1/auth/me').set(bearer(t)).expect(200)).body.pin).toEqual({
        available: false,
        reason,
      });
    }
  });
});
