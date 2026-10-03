/**
 * Profil sesi untuk web (peran, unit, izin, jenis tenant), tenant PLATFORM + superadmin_platform, dan IP/host
 * klien di balik web BFF (TRUST_PROXY).
 */
import type { NestExpressApplication } from '@nestjs/platform-express';
import { withTenant } from '@simrs/db';
import { newId } from '@simrs/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadApiEnv, parseTrustProxy } from '../src/config/env';
import { bearer, createTestApp, createTestUser, login, TENANT_A, TENANT_PLATFORM, testDb } from './helpers';

let app: NestExpressApplication;
const http = () => request(app.getHttpServer());

beforeAll(async () => {
  app = await createTestApp();
});

afterAll(async () => {
  await app?.close();
});

describe('profil sesi (/auth/me)', () => {
  it('peran, unit, dan izin dari penugasan aktif; jenis tenant RS', async () => {
    const suffix = newId().slice(-8).toUpperCase();
    const igd = await withTenant(testDb(), TENANT_A, async (tx) => {
      const facilityId = newId();
      await tx.facility.create({
        data: { id: facilityId, tenantId: TENANT_A, code: `F-${suffix}`, name: 'Gedung uji' },
      });
      return tx.unit.create({
        data: {
          id: newId(),
          tenantId: TENANT_A,
          facilityId,
          code: `IGD-${suffix}`,
          name: 'IGD uji',
          kind: 'igd',
        },
        select: { id: true, name: true },
      });
    });
    const u = await createTestUser(TENANT_A, { roles: [{ code: 'perawat', unitId: igd.id }] });
    const t = await login(app, u);
    const me = await http().get('/api/v1/auth/me').set(bearer(t)).expect(200);
    expect(me.body.tenant).toMatchObject({ id: TENANT_A, code: 'RSFA', kind: 'hospital' });
    expect(me.body.role).toEqual({ code: 'perawat', name: 'Perawat' });
    expect(me.body.unit).toEqual(igd);
    expect(me.body.permissions).toContainEqual({
      resource: 'patient',
      action: 'read',
      scope: 'relationship',
    });
    expect(me.body.permissions.map((g: { resource: string }) => g.resource)).not.toContain('iam.users');
  });

  it('tanpa penugasan: peran dan izin kosong', async () => {
    const u = await createTestUser(TENANT_A);
    const t = await login(app, u);
    const me = await http().get('/api/v1/auth/me').set(bearer(t)).expect(200);
    expect(me.body).toMatchObject({ role: null, unit: null, permissions: [] });
  });
});

describe('tenant PLATFORM dan superadmin_platform', () => {
  it('superadmin login dengan kode PLATFORM; berizin panduan, tanpa akses data RS', async () => {
    const su = await createTestUser(TENANT_PLATFORM, { roles: [{ code: 'superadmin_platform' }] });
    const t = await login(app, su);
    const me = await http().get('/api/v1/auth/me').set(bearer(t)).expect(200);
    expect(me.body.tenant).toMatchObject({ code: 'PLATFORM', kind: 'platform' });
    expect(me.body.role.code).toBe('superadmin_platform');
    expect(me.body.permissions).toContainEqual({ resource: 'platform.guide', action: 'read', scope: 'all' });
    expect(me.body.permissions.map((g: { resource: string }) => g.resource)).not.toContain('patient');
    // Token tenant PLATFORM tidak bisa dipakai untuk RS lain.
    await http().get('/api/v1/iam/users').set(bearer(t)).set('X-Tenant-Id', TENANT_A).expect(403);
    // Daftar pengguna yang terlihat hanya milik tenant PLATFORM.
    const users = await http().get('/api/v1/iam/users?limit=200').set(bearer(t)).expect(200);
    const tenantIds = await withTenant(testDb(), TENANT_A, (tx) =>
      tx.user.findMany({ where: { id: { in: users.body.items.map((x: { id: string }) => x.id) } } }),
    );
    expect(tenantIds).toEqual([]);
  });

  it('admin RS tidak bisa memberi izin platform ke peran RS', async () => {
    const admin = await createTestUser(TENANT_A, { roles: [{ code: 'admin_tenant' }] });
    const t = await login(app, admin);
    await http()
      .put('/api/v1/iam/roles/perawat/permissions')
      .set(bearer(t))
      .send({ grants: [{ resource: 'platform.guide', action: 'read', scope: 'all' }] })
      .expect(400);
  });

  it('superadmin terakhir terlindungi seperti admin RS', async () => {
    const su = await createTestUser(TENANT_PLATFORM, { roles: [{ code: 'superadmin_platform' }] });
    const t = await login(app, su);
    const roles = await http().get('/api/v1/iam/roles').set(bearer(t)).expect(200);
    const own = roles.body.roles.find((r: { code: string }) => r.code === 'superadmin_platform');
    const crippled = (own.permissions as Array<{ resource: string; action: string }>).filter(
      (g) => g.resource !== 'iam.roles',
    );
    await http()
      .put('/api/v1/iam/roles/superadmin_platform/permissions')
      .set(bearer(t))
      .send({ grants: crippled })
      .expect(409);
  });
});

describe('IP dan host klien di balik web BFF (TRUST_PROXY)', () => {
  const failedLoginIp = async (target: NestExpressApplication, headers: Record<string, string>) => {
    const requestId = `uji-${newId()}`;
    await request(target.getHttpServer())
      .post('/api/v1/auth/login')
      .set({ 'X-Request-Id': requestId, ...headers })
      .send({ tenantCode: 'RSFA', username: `tidak.ada.${newId().slice(-8)}`, password: 'salah sekali' })
      .expect(401);
    const [row] = await withTenant(testDb(), TENANT_A, (tx) =>
      tx.auditEvent.findMany({ where: { requestId, action: 'login_failed' } }),
    );
    return row?.ip;
  };

  it('X-Forwarded-For dipercaya hanya dari proxy yang dikonfigurasi', async () => {
    expect(await failedLoginIp(app, { 'X-Forwarded-For': '203.0.113.7' })).toBe('203.0.113.7');
    const untrusted = await createTestApp({ TRUST_PROXY: '' });
    try {
      const ip = await failedLoginIp(untrusted, { 'X-Forwarded-For': '203.0.113.7' });
      expect(ip).not.toBe('203.0.113.7');
      expect(ip).toMatch(/127\.0\.0\.1|::1/);
    } finally {
      await untrusted.close();
    }
  });

  it('batas laju login per IP klien asli, bukan per server web', async () => {
    const limited = await createTestApp({ AUTH_RATE_LIMIT_PER_MIN: '2' });
    try {
      const attempt = (ip: string) =>
        request(limited.getHttpServer())
          .post('/api/v1/auth/login')
          .set('X-Forwarded-For', ip)
          .send({ tenantCode: 'RSFA', username: 'tidak.ada.siapa', password: 'salah' });
      expect((await attempt('198.51.100.1')).status).toBe(401);
      expect((await attempt('198.51.100.1')).status).toBe(401);
      expect((await attempt('198.51.100.1')).status).toBe(429);
      // Pengguna lain di RS yang sama (IP lain, lewat server web yang sama) tidak ikut terblokir.
      expect((await attempt('198.51.100.2')).status).toBe(401);
    } finally {
      await limited.close();
    }
  });

  it('nilai TRUST_PROXY divalidasi; produksi wajib menyetelnya', () => {
    expect(parseTrustProxy('loopback')).toEqual(['loopback']);
    expect(parseTrustProxy('10.0.0.0/8, loopback')).toEqual(['10.0.0.0/8', 'loopback']);
    expect(parseTrustProxy('::1')).toEqual(['::1']);
    expect(parseTrustProxy('1')).toBe(1);
    for (const bad of ['true', '*', '0', '9', '10.0.0.0/33', 'proxy.lokal', '10.0.0.1/8/2']) {
      expect(parseTrustProxy(bad), bad).toBeNull();
    }
    const base = { ...process.env, APP_ENV: 'production', TRUST_PROXY: '' };
    expect(() => loadApiEnv(base)).toThrow(/TRUST_PROXY wajib/);
    expect(() => loadApiEnv({ ...base, TRUST_PROXY: 'true' })).toThrow(/TRUST_PROXY/);
    expect(loadApiEnv({ ...base, TRUST_PROXY: 'loopback' }).TRUST_PROXY).toEqual(['loopback']);
  });
});
