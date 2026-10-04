/**
 * P02 · Kode cadangan login (WhatsApp/email) dan "percayai perangkat ini" (mockup Login): kode terenkripsi di
 * tantangan, dikirim lewat outbox (payload ID), jeda + batas kiriman, berbagi batas percobaan; perangkat tepercaya
 * melewati MFA sampai kedaluwarsa/dicabut.
 */
import type { NestExpressApplication } from '@nestjs/platform-express';
import { withTenant } from '@simrs/db';
import { decryptField, encryptField } from '@simrs/shared/node';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, createTestTenant, createTestUser, nextTotp, type TestUser, testDb } from './helpers';

let app: NestExpressApplication;
let T: { id: string; code: string };
const http = () => request(app.getHttpServer());
const key = () => process.env.FIELD_ENCRYPTION_KEY ?? '';

async function userWith(contact: { phone?: string; email?: string }): Promise<TestUser> {
  const user = await createTestUser(T.id, { roles: [{ code: 'perawat' }], tenantCode: T.code });
  await withTenant(testDb(), T.id, (tx) =>
    tx.user.update({
      where: { id: user.id },
      data: {
        email: contact.email ?? null,
        phoneEnc: contact.phone
          ? encryptField(contact.phone, { keyB64: key(), tenantId: T.id, purpose: 'staff_phone' })
          : null,
      },
    }),
  );
  return user;
}

const login = (user: TestUser, extra: object = {}) =>
  http()
    .post('/api/v1/auth/login')
    .send({ tenantCode: user.tenantCode, username: user.username, password: user.password, ...extra })
    .expect(200);

const otpOf = async (challengeToken: string) => {
  const id = challengeToken.split('.')[2] as string;
  const ch = await withTenant(testDb(), T.id, (tx) =>
    tx.loginChallenge.findUniqueOrThrow({ where: { id }, select: { otpEnc: true } }),
  );
  return decryptField(ch.otpEnc as string, { keyB64: key(), tenantId: T.id, purpose: 'login_otp' });
};

beforeAll(async () => {
  app = await createTestApp();
  T = await createTestTenant();
});

afterAll(async () => {
  await app.close();
});

describe('kode cadangan lewat WhatsApp/email', () => {
  it('terkirim tersamar lewat outbox; jeda 30 detik; kode benar membuka sesi dan tercatat', async () => {
    const user = await userWith({ phone: '6281200002222', email: 'rina@rs-fiktif.test' });
    const { challengeToken } = (await login(user)).body;
    const sent = await http()
      .post('/api/v1/auth/mfa/backup-code')
      .send({ challengeToken, channel: 'whatsapp' })
      .expect(200);
    expect(sent.body).toMatchObject({ channel: 'whatsapp', sentTo: '0812•••2222' });
    const again = await http()
      .post('/api/v1/auth/mfa/backup-code')
      .send({ challengeToken, channel: 'email' });
    expect(again.status).toBe(429);

    const id = challengeToken.split('.')[2];
    const msg = await withTenant(testDb(), T.id, (tx) =>
      tx.outboxMessage.findFirstOrThrow({ where: { idempotencyKey: `login-otp:${id}:1` } }),
    );
    expect(msg).toMatchObject({
      target: 'whatsapp',
      operation: 'auth.backup_code',
      payload: { challengeId: id },
    });

    const code = await otpOf(challengeToken);
    const wrong = code === '000000' ? '111111' : '000000';
    await http().post('/api/v1/auth/mfa/verify').send({ challengeToken, code: wrong }).expect(401);
    const ok = await http().post('/api/v1/auth/mfa/verify').send({ challengeToken, code }).expect(200);
    expect(ok.body.accessToken).toBeTruthy();
    expect(ok.body.trustedDevice).toBeNull();
    const audit = await withTenant(testDb(), T.id, (tx) =>
      tx.auditEvent.findFirstOrThrow({
        where: { actorUserId: user.id, action: 'login' },
        orderBy: { seq: 'desc' },
      }),
    );
    expect(audit.details).toMatchObject({ mfa: 'backup_whatsapp' });
    // Tantangan sekali pakai: kode yang sama tidak bisa dipakai lagi.
    await http().post('/api/v1/auth/mfa/verify').send({ challengeToken, code }).expect(401);
  });

  it('kanal tanpa alamat ditolak; tantangan palsu ditolak; TOTP tetap berlaku', async () => {
    const user = await userWith({ email: 'tanpa.hp@rs-fiktif.test' });
    const { challengeToken } = (await login(user)).body;
    const noPhone = await http()
      .post('/api/v1/auth/mfa/backup-code')
      .send({ challengeToken, channel: 'whatsapp' })
      .expect(400);
    expect(noPhone.body.message).toMatch(/WhatsApp belum terdaftar/);
    const mail = await http()
      .post('/api/v1/auth/mfa/backup-code')
      .send({ challengeToken, channel: 'email' })
      .expect(200);
    expect(mail.body.sentTo).toBe('t•••@rs-fiktif.test');
    await http()
      .post('/api/v1/auth/mfa/backup-code')
      .send({ challengeToken: `${challengeToken.slice(0, -2)}xx`, channel: 'email' })
      .expect(401);
    await http()
      .post('/api/v1/auth/mfa/verify')
      .send({ challengeToken, code: nextTotp(user) })
      .expect(200);
  });
});

describe('percayai perangkat ini (12 jam)', () => {
  it('lewati MFA dengan token perangkat; token akun lain/dicabut diabaikan', async () => {
    const user = await userWith({});
    const first = (await login(user)).body;
    const verified = await http()
      .post('/api/v1/auth/mfa/verify')
      .send({ challengeToken: first.challengeToken, code: nextTotp(user), trustDevice: true })
      .expect(200);
    const trusted = verified.body.trustedDevice;
    expect(trusted.token).toMatch(/^st1\./);
    expect(Date.parse(trusted.expiresAt) - Date.now()).toBeGreaterThan(11.9 * 3_600_000);

    const second = await login(user, { trustedDeviceToken: trusted.token });
    expect(second.body.status).toBe('authenticated');
    expect(second.body.accessToken).toBeTruthy();

    const other = await userWith({});
    expect((await login(other, { trustedDeviceToken: trusted.token })).body.status).toBe('mfa_required');
    expect((await login(user, { trustedDeviceToken: 'st1.palsu.palsu.palsu' })).body.status).toBe(
      'mfa_required',
    );

    await withTenant(testDb(), T.id, (tx) =>
      tx.trustedDevice.updateMany({ where: { userId: user.id }, data: { revokedAt: new Date() } }),
    );
    expect((await login(user, { trustedDeviceToken: trusted.token })).body.status).toBe('mfa_required');
  });
});
