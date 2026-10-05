/**
 * P02 · Daftar kata sandi bocor offline (`ref.breached_passwords`, diisi `pnpm db:import-breached`): kata sandi baru
 * yang ada di daftar ditolak dengan pesan kebijakan yang sama dengan daftar statis.
 */
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createPrismaClient, passwordSha1 } from '@simrs/db';
import { testDbUrls } from '@simrs/db/testing';
import { newId } from '@simrs/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createTestApp, createTestUser, login, TENANT_A } from './helpers';

let app: NestExpressApplication;
const http = () => request(app.getHttpServer());

beforeAll(async () => {
  app = await createTestApp();
});

afterAll(async () => {
  await app?.close();
});

describe('daftar kata sandi bocor', () => {
  it('sandi baru yang ada di daftar ditolak dengan pesan kebijakan; sandi lain diterima', async () => {
    const owner = createPrismaClient({ connectionString: testDbUrls().migrator, max: 1 });
    const leaked = `kalimat bocor uji ${newId()}`;
    const hex = passwordSha1(leaked);
    try {
      await owner.$executeRaw`INSERT INTO ref.breached_passwords (sha1, occurrences)
        VALUES (decode(${hex}, 'hex'), 1234) ON CONFLICT DO NOTHING`;
      const u = await createTestUser(TENANT_A, { roles: [{ code: 'perawat' }] });
      const t = await login(app, u);
      const r = await http()
        .post('/api/v1/auth/password')
        .set(bearer(t))
        .send({ currentPassword: u.password, newPassword: leaked })
        .expect(400);
      expect(r.body.code).toBe('PASSWORD_POLICY');
      expect(r.body.details.violations).toContain('common');
      expect(r.body.details.messages.join(' ')).toMatch(/pernah bocor/);
      await http()
        .post('/api/v1/auth/password')
        .set(bearer(t))
        .send({ currentPassword: u.password, newPassword: `kalimat aman uji ${newId()}` })
        .expect(200);
    } finally {
      await owner.$executeRaw`DELETE FROM ref.breached_passwords WHERE sha1 = decode(${hex}, 'hex')`;
      await owner.$disconnect();
    }
  });
});
