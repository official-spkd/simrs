/**
 * P03 · Cache matriks izin di aplikasi utuh (database + Redis sungguhan, token sungguhan).
 * Perubahan langsung di database (tanpa API) dipakai sebagai bukti: bila cache dipakai, perubahan itu belum
 * terlihat; perubahan lewat API (atau TTL habis) langsung terlihat.
 * Butuh Redis (docker compose up -d) untuk langganan invalidasi; tanpa Redis cache sengaja tidak dipakai.
 */
import type { NestExpressApplication } from '@nestjs/platform-express';
import { withTenant } from '@simrs/db';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PermissionMatrix } from '../src/infra/permission-matrix';
import {
  bearer,
  createTestApp,
  createTestTenant,
  createTestUser,
  login,
  testDb,
  type Tokens,
} from './helpers';

const apps: NestExpressApplication[] = [];
let app1: NestExpressApplication;
let app2: NestExpressApplication;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Tunggu langganan Redis instans ini hidup (cache baru dipakai setelah itu). */
async function liveMatrix(app: NestExpressApplication): Promise<PermissionMatrix> {
  const m = app.get(PermissionMatrix);
  for (let i = 0; i < 150 && !m.isLive(); i++) await sleep(20);
  if (!m.isLive()) throw new Error('Langganan Redis invalidasi matriks tidak hidup (docker compose up -d?)');
  return m;
}

async function newApp(overrides: Record<string, string> = {}) {
  const app = await createTestApp(overrides);
  apps.push(app);
  return app;
}

/** RS fiktif baru + pengguna per peran (login sungguhan). */
async function tenantWith(app: NestExpressApplication, roles: string[]) {
  const T = await createTestTenant();
  const tokens: Record<string, Tokens> = {};
  for (const code of roles) {
    const u = await createTestUser(T.id, { roles: [{ code }], tenantCode: T.code });
    tokens[code] = await login(app, u);
  }
  return { T, tokens };
}

const auditEvents = (app: NestExpressApplication, tok: Tokens) =>
  request(app.getHttpServer()).get('/api/v1/audit/events?limit=1').set(bearer(tok));

/** Cabut izin langsung di database, TANPA API (tidak ada invalidasi cache). */
const revokeInDb = (tenantId: string, role: string, resource: string, action: string) =>
  withTenant(testDb(), tenantId, (tx) =>
    tx.rolePermission.deleteMany({ where: { role: { code: role }, resource, action } }),
  );

/** Matriks peran lewat API admin (sama dengan layar Akses), tanpa satu izin. */
async function revokeViaApi(
  app: NestExpressApplication,
  admin: Tokens,
  role: string,
  resource: string,
  action: string,
) {
  const roles = await request(app.getHttpServer()).get('/api/v1/iam/roles').set(bearer(admin)).expect(200);
  const current = roles.body.roles.find((r: { code: string }) => r.code === role).permissions as Array<{
    resource: string;
    action: string;
    scope: string;
  }>;
  await request(app.getHttpServer())
    .put(`/api/v1/iam/roles/${role}/permissions`)
    .set(bearer(admin))
    .send({ grants: current.filter((g) => !(g.resource === resource && g.action === action)) })
    .expect(200);
}

beforeAll(async () => {
  app1 = await newApp();
  app2 = await newApp();
  await liveMatrix(app1);
  await liveMatrix(app2);
});

afterAll(async () => {
  for (const app of apps) await app.close();
});

describe('cache matriks izin (API)', () => {
  it('cache hit tidak membaca database; perubahan lewat API berlaku seketika di instans yang sama', async () => {
    const { T, tokens } = await tenantWith(app1, ['admin_tenant', 'auditor_mutu']);
    const m = app1.get(PermissionMatrix);
    await auditEvents(app1, tokens.auditor_mutu as Tokens).expect(200);
    const loads = m.cache.stats.loads;
    const hits = m.cache.stats.hits;

    await revokeInDb(T.id, 'auditor_mutu', 'audit', 'read');
    // Dari cache: database (yang sudah dicabut) tidak dibaca.
    await auditEvents(app1, tokens.auditor_mutu as Tokens).expect(200);
    expect(m.cache.stats.loads).toBe(loads);
    expect(m.cache.stats.hits).toBe(hits + 1);

    // Perubahan matriks lewat API → invalidasi setelah commit → permintaan berikutnya membaca matriks baru.
    await revokeViaApi(app1, tokens.admin_tenant as Tokens, 'auditor_mutu', 'facility', 'read');
    await auditEvents(app1, tokens.auditor_mutu as Tokens).expect(403);
  });

  it('penolakan dari cache tetap diaudit seperti sebelumnya (access_denied di-commit, pelaku + peran)', async () => {
    const { T, tokens } = await tenantWith(app1, ['perawat']);
    const m = app1.get(PermissionMatrix);
    const tok = tokens.perawat as Tokens;
    await request(app1.getHttpServer()).get('/api/v1/iam/users').set(bearer(tok)).expect(403);
    const hits = m.cache.stats.hits;
    await request(app1.getHttpServer()).get('/api/v1/iam/users').set(bearer(tok)).expect(403);
    expect(m.cache.stats.hits).toBe(hits + 1);
    const denied = await withTenant(testDb(), T.id, (tx) =>
      tx.auditEvent.findMany({
        where: { action: 'access_denied', resourceType: 'iam.users' },
        orderBy: { seq: 'asc' },
      }),
    );
    expect(denied).toHaveLength(2);
    for (const row of denied) {
      expect(row).toMatchObject({
        outcome: 'denied',
        actorRole: 'perawat',
        details: { action: 'read', role: 'perawat' },
      });
      expect(row.actorUserId).not.toBeNull();
    }
  });

  it('cache tenant A tidak melayani tenant B; invalidasi A tidak membuang cache B', async () => {
    const a = await tenantWith(app1, ['admin_tenant', 'auditor_mutu']);
    const b = await tenantWith(app1, ['auditor_mutu']);
    const m = app1.get(PermissionMatrix);
    // Peran berkode sama di B sudah dicabut di database sebelum pernah dimuat: B harus 403 walau A ter-cache 200.
    await auditEvents(app1, a.tokens.auditor_mutu as Tokens).expect(200);
    await revokeInDb(b.T.id, 'auditor_mutu', 'audit', 'read');
    await auditEvents(app1, b.tokens.auditor_mutu as Tokens).expect(403);

    // Isi cache B (izin lain), lalu ubah matriks A lewat API.
    const facilityB = () =>
      request(app1.getHttpServer())
        .get('/api/v1/facility/units?limit=1')
        .set(bearer(b.tokens.auditor_mutu as Tokens));
    await facilityB().expect(200);
    await revokeViaApi(app1, a.tokens.admin_tenant as Tokens, 'auditor_mutu', 'audit', 'read');
    await auditEvents(app1, a.tokens.auditor_mutu as Tokens).expect(403);
    const loads = m.cache.stats.loads;
    await facilityB().expect(200);
    expect(m.cache.stats.loads).toBe(loads); // B masih dari cache
  });

  it('perubahan di satu instans sampai ke instans lain lewat Redis (tanpa menunggu TTL)', async () => {
    const { tokens } = await tenantWith(app1, ['admin_tenant', 'auditor_mutu']);
    const tok = tokens.auditor_mutu as Tokens;
    await auditEvents(app2, tok).expect(200); // cache instans 2 terisi
    await revokeViaApi(app1, tokens.admin_tenant as Tokens, 'auditor_mutu', 'audit', 'read');
    let status = 0;
    for (let i = 0; i < 50 && status !== 403; i++) {
      status = (await auditEvents(app2, tok)).status;
      if (status !== 403) await sleep(20);
    }
    expect(status).toBe(403);
  });

  it('TTL habis → instans membaca database lagi (jaring pengaman siaran yang terlewat)', async () => {
    const app = await newApp({ AUTHZ_CACHE_TTL_SECONDS: '1' });
    await liveMatrix(app);
    const { T, tokens } = await tenantWith(app, ['auditor_mutu']);
    const tok = tokens.auditor_mutu as Tokens;
    await auditEvents(app, tok).expect(200);
    await revokeInDb(T.id, 'auditor_mutu', 'audit', 'read');
    await auditEvents(app, tok).expect(200); // masih dalam TTL
    await sleep(1_100);
    await auditEvents(app, tok).expect(403);
  });

  it('Redis tidak terjangkau → cache tidak dipakai, setiap pemeriksaan membaca database', async () => {
    const app = await newApp({ REDIS_URL: 'redis://127.0.0.1:1' });
    const m = app.get(PermissionMatrix);
    const { T, tokens } = await tenantWith(app, ['auditor_mutu']);
    const tok = tokens.auditor_mutu as Tokens;
    await auditEvents(app, tok).expect(200);
    await revokeInDb(T.id, 'auditor_mutu', 'audit', 'read');
    await auditEvents(app, tok).expect(403);
    expect(m.isLive()).toBe(false);
    expect(m.cache.stats.hits).toBe(0);
  });
});
