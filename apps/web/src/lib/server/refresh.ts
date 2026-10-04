import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { SessionTokens } from '@simrs/shared';
import { Redis } from 'ioredis';
import type { ClientInfo } from '../client-info';
import { ApiError, callApi } from './api-core';
import { sessionTokensSchema, TOKEN_PATTERN } from './schemas';
import { webEnv } from './web-env';

export type RefreshResult = { ok: true; tokens: SessionTokens } | { ok: false; status: number };

/**
 * Perpanjang sesi SEKALI per refresh token, walau banyak permintaan paralel (prefetch, beberapa tab, beberapa
 * instans web di belakang load balancer) membawa token lama yang sama. Tanpa ini, rotasi + deteksi pemakaian ulang
 * di API (ADR-0011) mencabut sesi pengguna secara acak.
 *
 * Dua lapis (ADR-0013, ADR-0073):
 * 1. Peta janji di memori proses (30 detik): permintaan paralel di instans ini menunggu satu panggilan.
 * 2. Peta bersama di Redis: instans yang pertama mengklaim token (`SET NX`) memanggil API dan menyimpan hasilnya
 *    30 detik; instans lain menunggu hasil itu. Kunci Redis = hash token; isinya terenkripsi AES-256-GCM dengan
 *    kunci turunan token LAMA, jadi pembaca Redis tanpa token itu tidak mendapat token baru.
 * Redis tidak terjangkau → lapis 1 saja (per instans) dengan peringatan; di produksi dicatat sebagai galat.
 */

const KEEP_MS = 30_000;
const MAX_ENTRIES = 5_000;
const REFRESH_TOKEN = TOKEN_PATTERN('sr1');
const PENDING = 'pending';
/** Batas waktu satu operasi Redis; Redis yang macet tidak boleh menahan halaman. */
const OP_TIMEOUT_MS = 500;
/** Setelah Redis gagal, permintaan berikutnya langsung per instans selama jeda ini sebelum mencoba Redis lagi. */
const RETRY_AFTER_FAILURE_MS = 5_000;

/** Waktu klaim/tunggu peta bersama. Kunci klaim > batas waktu panggilan API (10 dtk); tunggu < kunci. */
export interface SharedTiming {
  lockMs: number;
  waitMs: number;
  pollMs: number;
}
const DEFAULT_TIMING: SharedTiming = { lockMs: 15_000, waitMs: 12_000, pollMs: 50 };

/** Penyimpanan bersama minimal (adaptor Redis; tes memakai tiruan di memori). */
export interface SharedRefreshStore {
  /** SET NX dengan TTL: true bila instans ini pemegang klaim. */
  claim(key: string, value: string, ttlMs: number): Promise<boolean>;
  get(key: string): Promise<string | null>;
  put(key: string, value: string, ttlMs: number): Promise<void>;
  del(key: string): Promise<void>;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Adaptor ioredis; `prefix` memisahkan deployment/tes yang berbagi satu Redis. */
export function redisRefreshStore(client: Redis, prefix: string): SharedRefreshStore {
  return {
    claim: async (key, value, ttlMs) =>
      (await withTimeout(client.set(prefix + key, value, 'PX', ttlMs, 'NX'), OP_TIMEOUT_MS)) === 'OK',
    get: (key) => withTimeout(client.get(prefix + key), OP_TIMEOUT_MS),
    put: async (key, value, ttlMs) => {
      await withTimeout(client.set(prefix + key, value, 'PX', ttlMs), OP_TIMEOUT_MS);
    },
    del: async (key) => {
      await withTimeout(client.del(prefix + key), OP_TIMEOUT_MS);
    },
  };
}

/** Turunan token lama: id kunci peta dan kunci enkripsi hasil (dua turunan berbeda dari token yang sama). */
function derive(refreshToken: string): { id: string; key: Buffer } {
  return {
    id: createHash('sha256').update(`simrs/web-refresh/id\0${refreshToken}`).digest('base64url'),
    key: createHash('sha256').update(`simrs/web-refresh/enc\0${refreshToken}`).digest(),
  };
}

function seal(result: RefreshResult, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(result), 'utf8'), cipher.final()]);
  return ['v1', iv, cipher.getAuthTag(), data]
    .map((p) => (typeof p === 'string' ? p : p.toString('base64url')))
    .join('.');
}

/** Buka hasil dari instans lain; rusak/tak terbaca = null. */
function open(sealed: string, key: Buffer): RefreshResult | null {
  const [v, iv, tag, data] = sealed.split('.');
  if (v !== 'v1' || !iv || !tag || !data) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    const json = Buffer.concat([
      decipher.update(Buffer.from(data, 'base64url')),
      decipher.final(),
    ]).toString();
    const parsed = JSON.parse(json) as { ok?: unknown; tokens?: unknown; status?: unknown };
    if (parsed.ok === true) {
      const tokens = sessionTokensSchema.safeParse(parsed.tokens);
      return tokens.success ? { ok: true, tokens: tokens.data } : null;
    }
    return parsed.ok === false && parsed.status === 401 ? { ok: false, status: 401 } : null;
  } catch {
    return null;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface RefreshCoordinator {
  refresh(
    baseUrl: string,
    refreshToken: string,
    client: ClientInfo | null,
    now?: number,
  ): Promise<RefreshResult>;
  /** Kosongkan peta memori (tes). */
  reset(): void;
}

/**
 * Satu "instans web": peta memori sendiri + penyimpanan bersama dari `shared()` (null = per instans saja).
 * `onSharedError` dipanggil saat Redis gagal (pencatatan + jeda coba lagi).
 */
export function createRefreshCoordinator(opts: {
  shared: () => Promise<SharedRefreshStore | null>;
  onSharedError?: (err: unknown) => void;
  timing?: Partial<SharedTiming>;
}): RefreshCoordinator {
  const timing = { ...DEFAULT_TIMING, ...opts.timing };
  const entries = new Map<string, { at: number; promise: Promise<RefreshResult> }>();

  const callRefresh = (baseUrl: string, refreshToken: string, client: ClientInfo | null) =>
    callApi(baseUrl, '/api/v1/auth/refresh', {
      method: 'POST',
      body: { refreshToken },
      client,
      schema: sessionTokensSchema,
    }).then(
      (tokens): RefreshResult => ({ ok: true, tokens }),
      (err: unknown): RefreshResult => ({ ok: false, status: err instanceof ApiError ? err.status : 503 }),
    );

  /** Tunggu hasil pemegang klaim. null = klaim hilang (pemegang gagal sementara/kedaluwarsa): boleh klaim ulang. */
  async function awaitOwner(
    store: SharedRefreshStore,
    id: string,
    key: Buffer,
  ): Promise<RefreshResult | null> {
    const deadline = Date.now() + timing.waitMs;
    for (;;) {
      const value = await store.get(id);
      if (value === null) return null;
      if (value !== PENDING) return open(value, key) ?? { ok: false, status: 503 };
      if (Date.now() >= deadline) return { ok: false, status: 503 };
      await sleep(timing.pollMs);
    }
  }

  async function viaShared(
    store: SharedRefreshStore,
    call: () => Promise<RefreshResult>,
    { id, key }: { id: string; key: Buffer },
  ): Promise<RefreshResult> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let claimed: boolean;
      try {
        claimed = await store.claim(id, PENDING, timing.lockMs);
      } catch (err) {
        // Redis tidak terjangkau sebelum siapa pun mengklaim: perilaku per instans.
        opts.onSharedError?.(err);
        return call();
      }
      if (claimed) {
        const result = await call();
        try {
          // 401 juga dibagikan (konsisten); galat sementara tidak: instans lain boleh mencoba lagi.
          if (result.ok || result.status === 401) await store.put(id, seal(result, key), KEEP_MS);
          else await store.del(id);
        } catch (err) {
          // Hasil tetap dipakai; jangan memanggil API lagi dengan token yang sudah dirotasi.
          opts.onSharedError?.(err);
        }
        return result;
      }
      let seen: RefreshResult | null;
      try {
        seen = await awaitOwner(store, id, key);
      } catch (err) {
        // Instans lain sedang memperbarui: memanggil API sendiri = pemakaian ulang token → sesi dicabut. Tahan.
        opts.onSharedError?.(err);
        return { ok: false, status: 503 };
      }
      if (seen) return seen;
    }
    return { ok: false, status: 503 };
  }

  return {
    refresh(baseUrl, refreshToken, client, now = Date.now()) {
      for (const [k, entry] of entries) if (now - entry.at > KEEP_MS) entries.delete(k);
      if (!REFRESH_TOKEN.test(refreshToken)) return Promise.resolve({ ok: false, status: 401 });

      const derived = derive(refreshToken);
      const hit = entries.get(derived.id);
      if (hit) return hit.promise;
      if (entries.size >= MAX_ENTRIES) {
        const oldest = entries.keys().next().value;
        if (oldest !== undefined) entries.delete(oldest);
      }

      const call = () => callRefresh(baseUrl, refreshToken, client);
      const promise = (async (): Promise<RefreshResult> => {
        const store = await opts.shared();
        const result = store ? await viaShared(store, call, derived) : await call();
        // Galat sementara (API mati, batas laju, Redis) tidak disimpan: permintaan berikutnya boleh mencoba lagi.
        if (!result.ok && result.status !== 401) entries.delete(derived.id);
        return result;
      })();
      entries.set(derived.id, { at: now, promise });
      return promise;
    },
    reset() {
      entries.clear();
    },
  };
}

// ---------------------------------------------------------------------------------------------------------
// Instans proses ini: Redis dari `REDIS_URL` (lazy, satu koneksi), cadangan memori dengan pencatatan.
// ---------------------------------------------------------------------------------------------------------

let redis: Redis | null = null;
let store: SharedRefreshStore | null = null;
/** Sambungan yang sedang dibuka: permintaan paralel menunggu yang sama, tidak saling memutus. */
let connecting: Promise<SharedRefreshStore | null> | null = null;
let downUntil = 0;
let outage = false;
let memoryNoticeShown = false;

/** Nama/kode galat saja (tanpa pesan, yang bisa memuat alamat koneksi). */
function errorLabel(err: unknown): string {
  if (!(err instanceof Error)) return typeof err;
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' ? code : err.name;
}

function reportSharedError(err: unknown): void {
  downUntil = Date.now() + RETRY_AFTER_FAILURE_MS;
  redis?.disconnect();
  redis = null;
  store = null;
  if (outage) return;
  outage = true;
  const env = webEnv();
  const message = `Peta refresh sesi: Redis tidak terjangkau (${errorLabel(err)}); sementara per instans web. Banyak instans tanpa Redis bisa mencabut sesi pengguna (ADR-0073).`;
  // Produksi / REFRESH_STORE=redis: galat (perlu tindakan operator); lokal (auto): peringatan saja.
  if (env.appEnv === 'production' || env.refreshStore === 'redis') console.error(message);
  else console.warn(message);
}

async function sharedFromEnv(): Promise<SharedRefreshStore | null> {
  const env = webEnv();
  if (env.refreshStore === 'memory' || !env.redisUrl) {
    if (!memoryNoticeShown) {
      memoryNoticeShown = true;
      const message = `Peta refresh sesi di memori proses (${env.redisUrl ? 'REFRESH_STORE=memory' : 'REDIS_URL tidak disetel'}): hanya aman untuk satu instans web.`;
      if (env.appEnv === 'production') console.error(message);
      else if (env.appEnv !== 'local') console.warn(message);
    }
    return null;
  }
  if (store && redis?.status === 'ready') return store;
  if (connecting) return connecting;
  if (Date.now() < downUntil) return null;
  connecting = connectShared(env.redisUrl, env.refreshRedisPrefix).finally(() => {
    connecting = null;
  });
  return connecting;
}

async function connectShared(url: string, prefix: string): Promise<SharedRefreshStore | null> {
  try {
    redis?.disconnect();
    const client = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: 1_000,
      // Sambung ulang dikendalikan di sini (jeda `RETRY_AFTER_FAILURE_MS`), bukan oleh ioredis di latar.
      retryStrategy: () => null,
    });
    client.on('error', () => {
      // Dicatat sekali per gangguan lewat reportSharedError.
    });
    redis = client;
    await withTimeout(client.connect(), 1_500);
    store = redisRefreshStore(client, prefix);
    if (outage) {
      outage = false;
      console.warn('Peta refresh sesi: Redis pulih, peta kembali dibagi antar-instans web.');
    }
    return store;
  } catch (err) {
    reportSharedError(err);
    return null;
  }
}

const processCoordinator = createRefreshCoordinator({
  shared: sharedFromEnv,
  onSharedError: reportSharedError,
});

/** Perpanjang sesi sekali per refresh token, dibagi antar-instans bila Redis tersedia (lihat atas). */
export function refreshSession(
  baseUrl: string,
  refreshToken: string,
  client: ClientInfo | null,
  now: number = Date.now(),
): Promise<RefreshResult> {
  return processCoordinator.refresh(baseUrl, refreshToken, client, now);
}

/** Untuk tes: kosongkan peta memori dan tutup koneksi Redis proses ini. */
export function resetRefreshCache(): void {
  processCoordinator.reset();
  redis?.disconnect();
  redis = null;
  store = null;
  connecting = null;
  downUntil = 0;
  outage = false;
}
