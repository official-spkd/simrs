/**
 * Batas laju (P02): per IP, endpoint kredensial per IP, dan per pengguna; penghitung di Redis dibagi antar-instans
 * API; cadangan memori di luar produksi; endpoint kredensial gagal tertutup bila Redis wajib tetapi gagal.
 * Tes Redis memakai awalan kunci unik per tes dan hanya menghapus kunci berawalan itu.
 */
import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { newId } from '@simrs/shared';
import { Redis } from 'ioredis';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadApiEnv } from '../src/config/env';
import { RateLimitStorage } from '../src/infra/rate-limit.storage';
import type { RedisService } from '../src/infra/redis.service';
import { bearer, createTestApp, createTestUser, login, TENANT_A, TEST_RATE_LIMIT_PREFIX } from './helpers';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
/** Port yang pasti tertutup: Redis "tidak terjangkau". */
const DEAD_REDIS = 'redis://127.0.0.1:1';

let app: NestExpressApplication;
let redis: Redis;
const prefixes: string[] = [];
/** Aplikasi milik satu tes; ditutup setelah tes itu (sinyal shutdown hook per aplikasi). */
const opened: NestExpressApplication[] = [];

function uniquePrefix(): string {
  const prefix = `${TEST_RATE_LIMIT_PREFIX}${newId()}:`;
  prefixes.push(prefix);
  return prefix;
}

async function keysWith(prefix: string): Promise<string[]> {
  const found: string[] = [];
  let cursor = '0';
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 500);
    found.push(...keys);
    cursor = next;
  } while (cursor !== '0');
  return found;
}

/** Dua instans API yang berbagi Redis + awalan kunci (seperti dua replika di belakang load balancer). */
async function twoInstances(overrides: Record<string, string>) {
  const shared = { RATE_LIMIT_STORE: 'redis', RATE_LIMIT_REDIS_PREFIX: uniquePrefix(), ...overrides };
  const pair = await Promise.all([createTestApp(shared), createTestApp(shared)]);
  opened.push(...pair);
  for (const a of pair) expect(a.get(RateLimitStorage).store).toBe('redis');
  return pair;
}

async function openApp(overrides: Record<string, string>) {
  const a = await createTestApp(overrides);
  opened.push(a);
  return a;
}

const tenancy = (target: NestExpressApplication, ip: string) =>
  request(target.getHttpServer())
    .get('/api/v1/tenancy/current')
    .set('X-Tenant-Id', TENANT_A)
    .set('X-Forwarded-For', ip);

const failedLogin = (target: NestExpressApplication, ip: string) =>
  request(target.getHttpServer())
    .post('/api/v1/auth/login')
    .set('X-Forwarded-For', ip)
    .send({ tenantCode: 'RSFA', username: 'tidak.ada.siapa', password: 'salah' });

beforeAll(async () => {
  redis = new Redis(REDIS_URL, {
    lazyConnect: true,
    connectTimeout: 1000,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
  });
  try {
    await redis.connect();
    await redis.ping();
  } catch {
    throw new Error(
      `Redis tidak terjangkau di ${REDIS_URL}. Jalankan \`docker compose up -d\` (tes ini sengaja tidak dilewati).`,
    );
  }
  app = await createTestApp({ RATE_LIMIT_PER_MIN: '3' });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(opened.splice(0).map((a) => a.close()));
});

afterAll(async () => {
  await app?.close();
  for (const prefix of prefixes) {
    const keys = await keysWith(prefix);
    if (keys.length > 0) await redis.unlink(...keys);
  }
  redis.disconnect();
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

describe('penghitung di Redis, dibagi antar-instans API', () => {
  it('batas per IP berlaku gabungan dua instans; header dan format 429 tetap', async () => {
    const [a, b] = await twoInstances({ RATE_LIMIT_PER_MIN: '3' });
    const ip = '198.51.100.21';
    const r1 = await tenancy(a, ip);
    const r2 = await tenancy(b, ip);
    const r3 = await tenancy(a, ip);
    expect([r1.status, r2.status, r3.status]).toEqual([200, 200, 200]);
    expect([r1, r2, r3].map((r) => r.headers['x-ratelimit-remaining'])).toEqual(['2', '1', '0']);
    expect(r1.headers['x-ratelimit-limit']).toBe('3');
    expect(Number(r1.headers['x-ratelimit-reset'])).toBeGreaterThan(0);

    const blocked = await tenancy(b, ip);
    expect(blocked.status).toBe(429);
    expect(blocked.body).toMatchObject({ code: 'RATE_LIMITED' });
    expect(typeof blocked.body.requestId).toBe('string');
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    // Selama blokir instans mana pun menolak; IP lain tidak terpengaruh.
    expect((await tenancy(a, ip)).status).toBe(429);
    expect((await tenancy(a, '198.51.100.22')).status).toBe(200);
  });

  it('kunci Redis berawalan per deployment dan tidak memuat IP mentah', async () => {
    const [a] = await twoInstances({});
    const prefix = a.get(RateLimitStorage).keyPrefix;
    await tenancy(a, '198.51.100.23').expect(200);
    const keys = await keysWith(prefix);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(key.startsWith(prefix)).toBe(true);
      expect(key).not.toContain('198.51.100.23');
      expect(key).toMatch(/\{default:[0-9a-f]{64}\}/);
    }
  });

  it('batas per pengguna lintas IP dan lintas instans; pengguna lain di IP yang sama tidak ikut terblokir', async () => {
    const [a, b] = await twoInstances({ USER_RATE_LIMIT_PER_MIN: '3', RATE_LIMIT_PER_MIN: '1000' });
    const [userA, userB] = await Promise.all([createTestUser(TENANT_A), createTestUser(TENANT_A)]);
    const tokensA = await login(a, userA);
    const tokensB = await login(b, userB);
    const me = (target: NestExpressApplication, t: typeof tokensA, ip: string) =>
      request(target.getHttpServer()).get('/api/v1/auth/me').set(bearer(t)).set('X-Forwarded-For', ip);

    const first = await me(a, tokensA, '203.0.113.31');
    expect(first.status).toBe(200);
    expect(first.headers['x-ratelimit-limit-user']).toBe('3');
    expect(first.headers['x-ratelimit-remaining-user']).toBe('2');
    expect((await me(b, tokensA, '203.0.113.32')).status).toBe(200);
    expect((await me(a, tokensA, '203.0.113.33')).status).toBe(200);
    const blocked = await me(b, tokensA, '203.0.113.34');
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe('RATE_LIMITED');
    expect(Number(blocked.headers['retry-after-user'])).toBeGreaterThan(0);

    // Pengguna B dari IP yang sama dengan percobaan pertama A tetap dilayani.
    expect((await me(a, tokensB, '203.0.113.31')).status).toBe(200);
    // ID pengguna tidak tersimpan apa adanya di kunci.
    const keys = await keysWith(a.get(RateLimitStorage).keyPrefix);
    expect(keys.some((k) => k.includes('{user:'))).toBe(true);
    for (const key of keys) expect(key).not.toContain(userA.id);
  });

  it('mode header pengembang (tanpa pengguna) hanya dibatasi per IP', async () => {
    const [a] = await twoInstances({ USER_RATE_LIMIT_PER_MIN: '1', RATE_LIMIT_PER_MIN: '1000' });
    for (let i = 0; i < 3; i++) {
      const res = await tenancy(a, '198.51.100.24');
      expect(res.status).toBe(200);
      expect(res.headers['x-ratelimit-limit-user']).toBeUndefined();
    }
  });

  it('throttler auth tetap berlaku per IP, gabungan dua instans', async () => {
    const [a, b] = await twoInstances({ AUTH_RATE_LIMIT_PER_MIN: '2' });
    const ip = '198.51.100.25';
    expect((await failedLogin(a, ip)).status).toBe(401);
    const second = await failedLogin(b, ip);
    expect(second.status).toBe(401);
    expect(second.headers['x-ratelimit-remaining-auth']).toBe('0');
    const blocked = await failedLogin(a, ip);
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe('RATE_LIMITED');
    expect(Number(blocked.headers['retry-after-auth'])).toBeGreaterThan(0);
    expect((await failedLogin(b, '198.51.100.26')).status).toBe(401);
  });
});

describe('Redis tidak terjangkau', () => {
  it('lokal + auto → memori dengan peringatan, batas tetap berlaku', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn');
    const local = await openApp({ REDIS_URL: DEAD_REDIS, RATE_LIMIT_PER_MIN: '2' });
    expect(local.get(RateLimitStorage).store).toBe('memory');
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/Redis tidak terjangkau.*memori/));
    expect((await tenancy(local, '198.51.100.27')).status).toBe(200);
    expect((await tenancy(local, '198.51.100.27')).status).toBe(200);
    expect((await tenancy(local, '198.51.100.27')).status).toBe(429);
  });

  it('RATE_LIMIT_STORE=memory tidak menulis ke Redis', async () => {
    const prefix = uniquePrefix();
    const mem = await openApp({ RATE_LIMIT_STORE: 'memory', RATE_LIMIT_REDIS_PREFIX: prefix });
    expect(mem.get(RateLimitStorage).store).toBe('memory');
    await tenancy(mem, '198.51.100.28').expect(200);
    expect(await keysWith(prefix)).toEqual([]);
  });

  it.each([
    ['produksi', { APP_ENV: 'production' }],
    ['RATE_LIMIT_STORE=redis', { RATE_LIMIT_STORE: 'redis' }],
  ])(
    'Redis wajib (%s) → endpoint kredensial gagal tertutup 503 dan dicatat; endpoint lain tetap dibatasi',
    async (_label, overrides: Record<string, string>) => {
      const error = vi.spyOn(Logger.prototype, 'error');
      const strict = await openApp({ ...overrides, REDIS_URL: DEAD_REDIS, RATE_LIMIT_PER_MIN: '2' });
      expect(strict.get(RateLimitStorage).store).toBe('redis');
      expect(error).toHaveBeenCalledWith(expect.stringMatching(/Redis batas laju tidak terjangkau/));

      const denied = await failedLogin(strict, '198.51.100.29');
      expect(denied.status).toBe(503);
      expect(denied.body.code).toBe('INTERNAL_ERROR');
      expect(denied.body.message).toMatch(/sementara tidak tersedia/);

      // Endpoint biasa: throttler jalan di memori instans (respons 401 dari AuthGuard/200, bukan 503).
      const plain = () =>
        request(strict.getHttpServer())
          .get('/api/v1/tenancy/current')
          .set('X-Forwarded-For', '198.51.100.30')
          .set(overrides.APP_ENV === 'production' ? {} : { 'X-Tenant-Id': TENANT_A });
      const ok = overrides.APP_ENV === 'production' ? 401 : 200;
      expect((await plain()).status).toBe(ok);
      expect((await plain()).status).toBe(ok);
      expect((await plain()).status).toBe(429);
    },
  );
});

describe('Redis gagal setelah start (penyimpanan dengan Redis tiruan)', () => {
  const MIN = 60_000;

  /** RedisService tiruan: perintah Lua yang didaftarkan penyimpanan diarahkan ke `hit`. */
  function fakeRedis() {
    const hit = vi.fn();
    const client: Record<string, unknown> = {
      defineCommand: (name: string) => {
        client[name] = hit;
      },
      disconnect: vi.fn(),
    };
    return { service: { client, ping: async () => 'PONG' } as unknown as RedisService, hit };
  }

  const envFor = (overrides: Record<string, string>) =>
    loadApiEnv({
      ...process.env,
      NODE_ENV: 'test',
      APP_ENV: 'local',
      TRUST_PROXY: 'loopback',
      STORAGE_DRIVER: 'disk',
      ...overrides,
    });

  it('lokal: memori sementara + satu peringatan, Redis dicoba lagi setelah jeda dan pemulihan dicatat', async () => {
    const { service, hit } = fakeRedis();
    const storage = new RateLimitStorage(envFor({}), service);
    await storage.onModuleInit();
    expect(storage.store).toBe('redis');
    hit.mockResolvedValue([1, MIN, 0, 0]);
    expect(await storage.increment('k', MIN, 2, MIN, 'default')).toEqual({
      totalHits: 1,
      timeToExpire: 60,
      isBlocked: false,
      timeToBlockExpire: 0,
    });

    const warn = vi.spyOn(Logger.prototype, 'warn');
    hit.mockRejectedValue(Object.assign(new Error('putus'), { code: 'ECONNRESET' }));
    const results = [];
    for (let i = 0; i < 3; i++) results.push(await storage.increment('k2', MIN, 2, MIN, 'auth'));
    expect(results.map((r) => r.isBlocked)).toEqual([false, false, true]);
    // Satu percobaan gagal, sisanya langsung ke memori selama jeda; peringatan sekali, tanpa pesan galat mentah.
    expect(hit).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('ECONNRESET'));
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('putus'));

    const log = vi.spyOn(Logger.prototype, 'log');
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 6000);
    hit.mockResolvedValue([2, MIN, 0, 0]);
    expect((await storage.increment('k', MIN, 2, MIN, 'default')).totalHits).toBe(2);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/pulih/));
    storage.onApplicationShutdown();
  });

  it('Redis macet tidak menahan permintaan (batas waktu → cadangan)', async () => {
    const { service, hit } = fakeRedis();
    const storage = new RateLimitStorage(envFor({}), service);
    await storage.onModuleInit();
    hit.mockReturnValue(new Promise(() => {}));
    const started = Date.now();
    expect((await storage.increment('k', MIN, 5, MIN, 'default')).isBlocked).toBe(false);
    expect(Date.now() - started).toBeLessThan(2000);
    storage.onApplicationShutdown();
  });

  it('produksi: endpoint kredensial 503 (gagal tertutup), throttler lain memakai memori instans', async () => {
    const { service, hit } = fakeRedis();
    const error = vi.spyOn(Logger.prototype, 'error');
    const storage = new RateLimitStorage(envFor({ APP_ENV: 'production' }), service);
    await storage.onModuleInit();
    hit.mockRejectedValue(new Error('putus'));
    await expect(storage.increment('k', MIN, 10, MIN, 'auth')).rejects.toMatchObject({
      status: 503,
      code: 'INTERNAL_ERROR',
    });
    expect((await storage.increment('k', MIN, 10, MIN, 'default')).isBlocked).toBe(false);
    expect((await storage.increment('k', MIN, 10, MIN, 'user')).isBlocked).toBe(false);
    await expect(storage.increment('k', MIN, 10, MIN, 'auth')).rejects.toMatchObject({ status: 503 });
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/endpoint kredensial ditolak/));
    storage.onApplicationShutdown();
  });

  it('memory ditolak di produksi; awalan bawaan mengikuti nama database', () => {
    expect(() => envFor({ APP_ENV: 'production', RATE_LIMIT_STORE: 'memory' })).toThrow(
      /RATE_LIMIT_STORE=memory/,
    );
    const env = envFor({
      DATABASE_URL: 'postgresql://u:p@db.internal:5432/simrs_rs1?schema=public',
      RATE_LIMIT_REDIS_PREFIX: '',
    });
    expect(new RateLimitStorage(env, fakeRedis().service).keyPrefix).toBe('simrs:rl:simrs_rs1:');
  });
});
