import type { NestExpressApplication } from '@nestjs/platform-express';
import { newId } from '@simrs/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, TENANT_A, TENANT_B } from './helpers';

let app: NestExpressApplication;
const http = () => request(app.getHttpServer());

beforeAll(async () => {
  app = await createTestApp();
});

afterAll(async () => {
  await app?.close();
});

describe('sistem', () => {
  it('GET /health hidup dan mengembalikan X-Request-Id', async () => {
    const res = await http().get('/health').expect(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('meneruskan X-Request-Id dari klien yang wajar, menolak yang aneh', async () => {
    expect((await http().get('/health').set('X-Request-Id', 'uji-req-12345')).headers['x-request-id']).toBe(
      'uji-req-12345',
    );
    const injected = await http().get('/health').set('X-Request-Id', '<script>alert(1)</script>');
    expect(injected.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('GET /ready memeriksa DB, Redis, MinIO', async () => {
    const res = await http().get('/ready');
    expect(Object.keys(res.body.checks).sort()).toEqual(['database', 'redis', 'storage']);
    expect(res.body.checks.database.ok).toBe(true);
    expect(res.status).toBe(res.body.status === 'ok' ? 200 : 503);
  });

  it('Swagger tersedia di /docs (non-produksi)', async () => {
    const res = await http().get('/docs/openapi.json').expect(200);
    expect(res.body.paths).toHaveProperty('/api/v1/tenancy/current');
    expect(res.body.paths).toHaveProperty('/api/v1/dev/outbox-ping');
  });

  it('rute tidak dikenal memakai format galat standar', async () => {
    const res = await http().get('/api/v1/tidak-ada').expect(404);
    expect(res.body).toMatchObject({ code: 'NOT_FOUND' });
    expect(res.body.requestId).toBeTruthy();
  });
});

describe('header keamanan', () => {
  it('respons API: CSP ketat, nosniff, anti-framing, no-store, tanpa X-Powered-By', async () => {
    const res = await http().get('/api/v1/tidak-ada');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['strict-transport-security']).toBeUndefined();
  });

  it('Swagger memakai CSP khusus dokumentasi', async () => {
    const res = await http().get('/docs/openapi.json');
    expect(res.headers['content-security-policy']).toContain("script-src 'self'");
  });

  it('CORS hanya untuk origin web', async () => {
    const ok = await http().options('/api/v1/tenancy/current').set('Origin', 'http://localhost:3000');
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    const evil = await http().options('/api/v1/tenancy/current').set('Origin', 'https://jahat.example');
    expect(evil.headers['access-control-allow-origin']).not.toBe('https://jahat.example');
  });
});

describe('validasi body', () => {
  it('JSON rusak → 400 VALIDATION_FAILED', async () => {
    const res = await http()
      .post('/api/v1/dev/outbox-ping')
      .set('X-Tenant-Id', TENANT_A)
      .set('Content-Type', 'application/json')
      .send('{"target":');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });

  it('body > 1 MB → 413 PAYLOAD_TOO_LARGE', async () => {
    const res = await http()
      .post('/api/v1/dev/outbox-ping')
      .set('X-Tenant-Id', TENANT_A)
      .send({ target: 'satusehat', pad: 'x'.repeat(1_100_000) });
    expect(res.status).toBe(413);
    expect(res.body.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('field tak dikenal ditolak (strict)', async () => {
    const res = await http()
      .post('/api/v1/dev/outbox-ping')
      .set('X-Tenant-Id', TENANT_A)
      .send({ target: 'satusehat', tenantId: TENANT_B });
    expect(res.status).toBe(400);
  });
});

describe('tenancy', () => {
  it('tanpa X-Tenant-Id → 400 TENANT_REQUIRED', async () => {
    const res = await http().get('/api/v1/tenancy/current').expect(400);
    expect(res.body.code).toBe('TENANT_REQUIRED');
  });

  it('X-Tenant-Id bukan UUID → 400 TENANT_REQUIRED', async () => {
    await http().get('/api/v1/tenancy/current').set('X-Tenant-Id', 'RSFA').expect(400);
  });

  it('mengembalikan tenant sesuai konteks', async () => {
    const a = await http().get('/api/v1/tenancy/current').set('X-Tenant-Id', TENANT_A).expect(200);
    expect(a.body).toMatchObject({ id: TENANT_A, code: 'RSFA' });
    const b = await http().get('/api/v1/tenancy/current').set('X-Tenant-Id', TENANT_B).expect(200);
    expect(b.body.code).toBe('RSFB');
  });

  it('tenant tidak dikenal → 404', async () => {
    await http()
      .get('/api/v1/tenancy/current')
      // UUID acak: dijamin bukan tenant yang ada (ID tetap bisa bentrok dengan seed baru).
      .set('X-Tenant-Id', newId())
      .expect(404);
  });
});

describe('dev tools (non-produksi)', () => {
  it('pesan outbox tenant A tidak terbaca oleh tenant B', async () => {
    const created = await http()
      .post('/api/v1/dev/outbox-ping')
      .set('X-Tenant-Id', TENANT_A)
      .send({ target: 'satusehat' })
      .expect(201);
    expect(created.body.status).toBe('pending');
    await http().get(`/api/v1/dev/outbox/${created.body.id}`).set('X-Tenant-Id', TENANT_A).expect(200);
    await http().get(`/api/v1/dev/outbox/${created.body.id}`).set('X-Tenant-Id', TENANT_B).expect(404);
  });

  it('target tidak valid → 400 VALIDATION_FAILED', async () => {
    const res = await http()
      .post('/api/v1/dev/outbox-ping')
      .set('X-Tenant-Id', TENANT_A)
      .send({ target: 'bank-lain' })
      .expect(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });
});
