import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const A = '0199a000-0000-7000-8000-000000000001';
const B = '0199a000-0000-7000-8000-000000000002';

let app: INestApplication;

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL =
    process.env.TEST_APP_DATABASE_URL ??
    'postgresql://simrs_app:app_local@localhost:5432/simrs_test?schema=public';
  const { AppModule } = await import('../src/app.module');
  const { configureApp } = await import('../src/bootstrap');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication({ bufferLogs: true, rawBody: true });
  configureApp(app, { webOrigin: 'http://localhost:3000', docs: true });
  await app.init();
});

afterAll(async () => {
  await app?.close();
});

describe('sistem', () => {
  it('GET /health hidup dan mengembalikan X-Request-Id', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('meneruskan X-Request-Id dari klien', async () => {
    const res = await request(app.getHttpServer()).get('/health').set('X-Request-Id', 'uji-req-12345');
    expect(res.headers['x-request-id']).toBe('uji-req-12345');
  });

  it('GET /ready memeriksa DB, Redis, MinIO', async () => {
    const res = await request(app.getHttpServer()).get('/ready');
    expect(Object.keys(res.body.checks).sort()).toEqual(['database', 'redis', 'storage']);
    expect(res.body.checks.database.ok).toBe(true);
    expect(res.status).toBe(res.body.status === 'ok' ? 200 : 503);
  });

  it('Swagger tersedia di /docs', async () => {
    const res = await request(app.getHttpServer()).get('/docs/openapi.json').expect(200);
    expect(res.body.paths).toHaveProperty('/api/v1/tenancy/current');
  });

  it('rute tidak dikenal memakai format galat standar', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/tidak-ada').expect(404);
    expect(res.body).toMatchObject({ code: 'NOT_FOUND' });
    expect(res.body.requestId).toBeTruthy();
  });
});

describe('tenancy', () => {
  it('tanpa X-Tenant-Id → 400 TENANT_REQUIRED', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/tenancy/current').expect(400);
    expect(res.body.code).toBe('TENANT_REQUIRED');
  });

  it('X-Tenant-Id bukan UUID → 400 TENANT_REQUIRED', async () => {
    await request(app.getHttpServer()).get('/api/v1/tenancy/current').set('X-Tenant-Id', 'RSFA').expect(400);
  });

  it('mengembalikan tenant sesuai konteks', async () => {
    const a = await request(app.getHttpServer())
      .get('/api/v1/tenancy/current')
      .set('X-Tenant-Id', A)
      .expect(200);
    expect(a.body).toMatchObject({ id: A, code: 'RSFA' });
    const b = await request(app.getHttpServer())
      .get('/api/v1/tenancy/current')
      .set('X-Tenant-Id', B)
      .expect(200);
    expect(b.body.code).toBe('RSFB');
  });

  it('tenant tidak dikenal → 404', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/tenancy/current')
      .set('X-Tenant-Id', '0199a000-0000-7000-8000-0000000000ff')
      .expect(404);
  });

  it('pesan outbox tenant A tidak terbaca oleh tenant B', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/tenancy/dev/outbox-ping')
      .set('X-Tenant-Id', A)
      .send({ target: 'satusehat' })
      .expect(201);
    expect(created.body.status).toBe('pending');
    await request(app.getHttpServer())
      .get(`/api/v1/tenancy/dev/outbox/${created.body.id}`)
      .set('X-Tenant-Id', A)
      .expect(200);
    await request(app.getHttpServer())
      .get(`/api/v1/tenancy/dev/outbox/${created.body.id}`)
      .set('X-Tenant-Id', B)
      .expect(404);
  });

  it('target tidak valid → 400 VALIDATION_FAILED', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/tenancy/dev/outbox-ping')
      .set('X-Tenant-Id', A)
      .send({ target: 'bank-lain' })
      .expect(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });
});
