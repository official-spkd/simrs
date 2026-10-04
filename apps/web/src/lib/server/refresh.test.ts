import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createRefreshCoordinator,
  type RefreshCoordinator,
  redisRefreshStore,
  type SharedRefreshStore,
} from './refresh';
import { webEnv } from './web-env';

/**
 * Peta refresh sesi bersama antar-instans web (ADR-0073). Setiap "instans" = koordinator dengan peta memori
 * sendiri; mereka berbagi penyimpanan (tiruan di memori, atau Redis sungguhan bila terjangkau).
 */

const SESSION = '0199a000-0000-7000-8000-000000000001';
const token = (kind: 'sa1' | 'sr1', id: string, fill: string) =>
  `${kind}.${SESSION}.${id}.${fill.repeat(43)}`;
const OLD = token('sr1', '0199a000-0000-7000-8000-0000000000aa', 'x');
const FRESH = {
  accessToken: token('sa1', '0199a000-0000-7000-8000-0000000000aa', 'y'),
  accessExpiresAt: '2026-10-04T10:15:00.000Z',
  refreshToken: token('sr1', '0199a000-0000-7000-8000-0000000000aa', 'z'),
  refreshExpiresAt: '2026-10-04T18:00:00.000Z',
};
const FAST = { lockMs: 2_000, waitMs: 1_500, pollMs: 10 };

/** API tiruan: menghitung panggilan, menjawab setelah jeda (agar permintaan paralel sempat tumpang tindih). */
function stubApi(status: number, delayMs = 80) {
  const fetchMock = vi.fn(async () => {
    await new Promise((r) => setTimeout(r, delayMs));
    return status === 200 ? Response.json(FRESH) : new Response('{}', { status });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** Penyimpanan bersama tiruan (semantik SET NX PX / GET / DEL seperti Redis). */
function memoryStore(): SharedRefreshStore & { raw: Map<string, { value: string; until: number }> } {
  const raw = new Map<string, { value: string; until: number }>();
  const live = (key: string) => {
    const e = raw.get(key);
    if (e && e.until <= Date.now()) raw.delete(key);
    return raw.get(key);
  };
  return {
    raw,
    claim: async (key, value, ttlMs) => {
      if (live(key)) return false;
      raw.set(key, { value, until: Date.now() + ttlMs });
      return true;
    },
    get: async (key) => live(key)?.value ?? null,
    put: async (key, value, ttlMs) => {
      raw.set(key, { value, until: Date.now() + ttlMs });
    },
    del: async (key) => {
      raw.delete(key);
    },
  };
}

function instances(shared: SharedRefreshStore | SharedRefreshStore[], n = 2): RefreshCoordinator[] {
  return Array.from({ length: n }, (_, i) => {
    const s = Array.isArray(shared) ? (shared[i] ?? null) : shared;
    return createRefreshCoordinator({ shared: async () => s, timing: FAST });
  });
}

/** Tiga permintaan paralel per instans dengan token lama yang sama. */
const parallel = (nodes: RefreshCoordinator[]) =>
  Promise.all(nodes.flatMap((n) => [1, 2, 3].map(() => n.refresh('http://api.test', OLD, null))));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('peta refresh bersama (tiruan penyimpanan)', () => {
  it('refresh paralel di dua instans: API dipanggil sekali, semua mendapat token baru yang sama', async () => {
    const api = stubApi(200);
    const results = await parallel(instances(memoryStore()));
    expect(api).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(6);
    expect(results.every((r) => r.ok && r.tokens.refreshToken === FRESH.refreshToken)).toBe(true);
  });

  it('isi penyimpanan terenkripsi; kuncinya hash, bukan token', async () => {
    stubApi(200);
    const store = memoryStore();
    await instances(store, 1)[0]?.refresh('http://api.test', OLD, null);
    expect(store.raw.size).toBe(1);
    const [key, entry] = [...store.raw][0] ?? ['', undefined];
    expect(key).not.toContain(OLD);
    expect(entry?.value).toMatch(/^v1\./);
    expect(entry?.value).not.toContain(FRESH.accessToken);
    expect(entry?.value).not.toContain(FRESH.refreshToken);
    expect(Buffer.from(entry?.value ?? '', 'base64url').toString()).not.toContain('sa1.');
  });

  it('401 dibagikan; galat sementara tidak (instans lain mencoba lagi)', async () => {
    const denied = stubApi(401);
    const [a, b] = instances(memoryStore());
    expect(await a?.refresh('http://api.test', OLD, null)).toEqual({ ok: false, status: 401 });
    expect(await b?.refresh('http://api.test', OLD, null)).toEqual({ ok: false, status: 401 });
    expect(denied).toHaveBeenCalledTimes(1);

    const down = stubApi(503);
    const [c, d] = instances(memoryStore());
    expect(await c?.refresh('http://api.test', OLD, null)).toEqual({ ok: false, status: 503 });
    expect(await d?.refresh('http://api.test', OLD, null)).toEqual({ ok: false, status: 503 });
    expect(down).toHaveBeenCalledTimes(2);
  });

  it('pemegang klaim tidak pernah selesai → instans lain berhenti menunggu (503) tanpa memanggil API', async () => {
    const api = stubApi(200);
    const store = memoryStore();
    const [waiter] = instances(store, 1);
    // Klaim "sedang diperbarui" milik instans lain yang mati di tengah jalan.
    vi.spyOn(store, 'claim').mockResolvedValue(false);
    vi.spyOn(store, 'get').mockResolvedValue('pending');
    expect(await waiter?.refresh('http://api.test', OLD, null)).toEqual({ ok: false, status: 503 });
    expect(api).not.toHaveBeenCalled();
  });

  it('Redis gagal sebelum klaim → per instans (API dipanggil); gagal saat menunggu → 503 tanpa pemakaian ulang', async () => {
    const api = stubApi(200);
    const broken: SharedRefreshStore = {
      claim: async () => {
        throw Object.assign(new Error('x'), { code: 'ECONNREFUSED' });
      },
      get: async () => null,
      put: async () => undefined,
      del: async () => undefined,
    };
    const errors: unknown[] = [];
    const node = createRefreshCoordinator({
      shared: async () => broken,
      onSharedError: (e) => errors.push(e),
      timing: FAST,
    });
    expect((await node.refresh('http://api.test', OLD, null)).ok).toBe(true);
    expect(api).toHaveBeenCalledTimes(1);
    expect(errors).toHaveLength(1);

    const waitingBroken: SharedRefreshStore = {
      ...broken,
      claim: async () => false,
      get: async () => {
        throw new Error('putus');
      },
    };
    const other = createRefreshCoordinator({ shared: async () => waitingBroken, timing: FAST });
    expect(await other.refresh('http://api.test', OLD, null)).toEqual({ ok: false, status: 503 });
    expect(api).toHaveBeenCalledTimes(1);
  });

  it('isi rusak/kunci salah dari penyimpanan tidak dipercaya (503)', async () => {
    stubApi(200);
    const store = memoryStore();
    vi.spyOn(store, 'claim').mockResolvedValue(false);
    vi.spyOn(store, 'get').mockResolvedValue('v1.aaaa.bbbb.cccc');
    const [node] = instances(store, 1);
    expect(await node?.refresh('http://api.test', OLD, null)).toEqual({ ok: false, status: 503 });
  });
});

describe('pengaturan peta refresh (env)', () => {
  it('bawaan auto; memory diabaikan di produksi; awalan bisa diganti', () => {
    expect(webEnv({ APP_ENV: 'local' })).toMatchObject({ refreshStore: 'auto', redisUrl: null });
    expect(webEnv({ APP_ENV: 'local', REFRESH_STORE: 'memory' }).refreshStore).toBe('memory');
    expect(webEnv({ APP_ENV: 'production', REFRESH_STORE: 'memory' }).refreshStore).toBe('redis');
    expect(webEnv({ APP_ENV: 'local', REDIS_URL: ' redis://r:6379 ' }).redisUrl).toBe('redis://r:6379');
    expect(webEnv({ APP_ENV: 'local' }).refreshRedisPrefix).toBe('simrs:web:refresh:');
    expect(webEnv({ APP_ENV: 'local', REFRESH_REDIS_PREFIX: 'x:' }).refreshRedisPrefix).toBe('x:');
  });
});

// Redis sungguhan (docker compose): dua koneksi = dua instans web. Dilewati bila Redis tidak terjangkau.
const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const clients: Redis[] = [];
async function connect(): Promise<Redis | null> {
  const client = new Redis(REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 500,
    retryStrategy: () => null,
  });
  client.on('error', () => undefined);
  try {
    await client.connect();
    clients.push(client);
    return client;
  } catch {
    client.disconnect();
    return null;
  }
}
const probe = await connect();

afterAll(() => {
  for (const c of clients) c.disconnect();
});

describe.runIf(probe !== null)('peta refresh bersama (Redis sungguhan)', () => {
  let prefix = '';
  beforeEach(() => {
    prefix = `simrs:test:web-refresh:${randomUUID()}:`;
  });
  afterEach(async () => {
    const keys = await probe?.keys(`${prefix}*`);
    if (keys?.length) await probe?.del(...keys);
  });

  it('dua instans web berbagi satu refresh: API sekali, sesi tidak tercabut', async () => {
    const api = stubApi(200, 150);
    const second = await connect();
    if (!probe || !second) throw new Error('Redis tidak terjangkau');
    const nodes = instances([redisRefreshStore(probe, prefix), redisRefreshStore(second, prefix)]);
    const results = await parallel(nodes);
    expect(api).toHaveBeenCalledTimes(1);
    expect(results.every((r) => r.ok && r.tokens.accessToken === FRESH.accessToken)).toBe(true);

    const keys = await probe.keys(`${prefix}*`);
    expect(keys).toHaveLength(1);
    const ttl = await probe.pttl(keys[0] ?? '');
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(30_000);
    expect(await probe.get(keys[0] ?? '')).not.toContain(FRESH.refreshToken);
  });
});
