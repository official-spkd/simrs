/**
 * Perilaku produksi (APP_ENV=production): permukaan serangan minimal.
 * Swagger dan endpoint /dev tidak ada, tenant dari header ditolak sampai login (P02) tersedia.
 */
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, TENANT_A } from './helpers';

let app: NestExpressApplication;

beforeAll(async () => {
  app = await createTestApp({ APP_ENV: 'production' });
});

afterAll(async () => {
  await app?.close();
});

describe('mode produksi', () => {
  it('Swagger tidak tersedia', async () => {
    await request(app.getHttpServer()).get('/docs').expect(404);
    await request(app.getHttpServer()).get('/docs/openapi.json').expect(404);
  });

  it('endpoint /dev tidak terdaftar', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/dev/outbox-ping')
      .set('X-Tenant-Id', TENANT_A)
      .send({ target: 'satusehat' })
      .expect(404);
  });

  it('tenant dari header ditolak (401) sampai login tersedia', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/tenancy/current')
      .set('X-Tenant-Id', TENANT_A)
      .expect(401);
    expect(res.body.code).toBe('UNAUTHENTICATED');
  });

  it('HSTS aktif', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.headers['strict-transport-security']).toContain('max-age=31536000');
  });

  it('header keamanan lengkap di respons API produksi (ADR-0073)', async () => {
    for (const path of ['/health', '/api/v1/tenancy/current', '/api/v1/tidak-ada']) {
      const res = await request(app.getHttpServer()).get(path);
      const h = res.headers;
      expect(h['content-security-policy'], path).toBe(
        "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
      );
      expect(h['x-content-type-options'], path).toBe('nosniff');
      expect(h['x-frame-options'], path).toBe('DENY');
      expect(h['referrer-policy'], path).toBe('no-referrer');
      expect(h['cross-origin-opener-policy'], path).toBe('same-origin');
      expect(h['cross-origin-resource-policy'], path).toBe('same-site');
      expect(h['permissions-policy'], path).toContain('camera=()');
      expect(h['cache-control'], path).toBe('no-store');
      expect(h['strict-transport-security'], path).toBe('max-age=31536000; includeSubDomains');
      expect(h['x-powered-by'], path).toBeUndefined();
    }
  });

  it('APP_ENV tidak disetel diperlakukan sebagai produksi (gagal aman)', async () => {
    const unset = await createTestApp({ APP_ENV: '' });
    try {
      await request(unset.getHttpServer()).get('/docs/openapi.json').expect(404);
    } finally {
      await unset.close();
    }
  });
});
