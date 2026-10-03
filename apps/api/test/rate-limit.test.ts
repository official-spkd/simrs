import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, TENANT_A } from './helpers';

let app: NestExpressApplication;

beforeAll(async () => {
  app = await createTestApp({ RATE_LIMIT_PER_MIN: '3' });
});

afterAll(async () => {
  await app?.close();
});

describe('rate limit', () => {
  it('permintaan ke-4 dalam semenit → 429 RATE_LIMITED', async () => {
    const call = () =>
      request(app.getHttpServer()).get('/api/v1/tenancy/current').set('X-Tenant-Id', TENANT_A);
    for (let i = 0; i < 3; i++) expect((await call()).status).toBe(200);
    const blocked = await call();
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe('RATE_LIMITED');
  });

  it('health dan ready tidak dibatasi (dipakai load balancer)', async () => {
    for (let i = 0; i < 6; i++) await request(app.getHttpServer()).get('/health').expect(200);
  });
});
