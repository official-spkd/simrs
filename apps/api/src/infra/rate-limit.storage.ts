import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { type ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import { AppError } from '@simrs/shared';
import { API_ENV, type ApiEnv } from '../config/env';
import { AUTH_THROTTLER } from './rate-limit';
import { RedisService } from './redis.service';

type StorageRecord = Awaited<ReturnType<ThrottlerStorage['increment']>>;

/**
 * Satu hit, atomik di Redis. Jendela geser (sorted set, skor = waktu ms) + penanda blokir, meniru
 * `ThrottlerStorageService` bawaan agar perilaku Redis dan cadangan memori sama:
 * hit di atas batas → blokir selama `blockDuration` (hit selama blokir tidak dihitung), sesudahnya mulai dari nol.
 * Waktu dari jam Redis (bukan jam instans API) agar semua instans memakai acuan yang sama.
 * KEYS: [1] log hit, [2] penanda blokir · ARGV: ttl ms, batas, durasi blokir ms, ID hit unik.
 * Hasil: [total hit, sisa jendela ms, terblokir 0/1, sisa blokir ms].
 */
const HIT_LUA = `
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local ttl = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local block = tonumber(ARGV[3])
local function windowLeft()
  local first = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
  if first[2] then return tonumber(first[2]) + ttl - now end
  return ttl
end
local blockLeft = redis.call('PTTL', KEYS[2])
if blockLeft > 0 then
  return {limit + 1, blockLeft, 1, blockLeft}
end
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - ttl)
local hits = redis.call('ZCARD', KEYS[1])
if block <= 0 and hits >= limit then
  local left = windowLeft()
  return {hits + 1, left, 1, left}
end
redis.call('ZADD', KEYS[1], now, ARGV[4])
redis.call('PEXPIRE', KEYS[1], ttl)
hits = hits + 1
local left = windowLeft()
if block > 0 and hits > limit then
  redis.call('DEL', KEYS[1])
  redis.call('SET', KEYS[2], '1', 'PX', block)
  return {hits, left, 1, block}
end
return {hits, left, 0, 0}
`;

const HIT_COMMAND = 'simrsRateLimitHit';
type HitCommand = (
  hitsKey: string,
  blockKey: string,
  ttlMs: number,
  limit: number,
  blockMs: number,
  member: string,
) => Promise<[number, number, number, number]>;

/** Batas waktu cek Redis saat start dan per hit; Redis yang macet tidak boleh menahan permintaan. */
const PROBE_TIMEOUT_MS = 1000;
const HIT_TIMEOUT_MS = 500;
/** Setelah Redis gagal, hit berikutnya langsung memakai cadangan selama jeda ini sebelum mencoba Redis lagi. */
const RETRY_AFTER_FAILURE_MS = 5000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Nama/kode galat saja (tanpa pesan, yang bisa memuat alamat koneksi). */
function errorLabel(err: unknown): string {
  if (!(err instanceof Error)) return typeof err;
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' ? code : err.name;
}

/**
 * Awalan kunci bawaan per database: semua instans API satu deployment (database sama) berbagi penghitung,
 * sedangkan pengembangan (`simrs`), E2E (`simrs_test`), dan worktree lain (`simrs_test_<nama>`) yang memakai
 * Redis yang sama tidak saling memengaruhi.
 */
export function defaultRateLimitPrefix(databaseUrl: string): string {
  let name = '';
  try {
    name = decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, ''));
  } catch {
    // URL sudah divalidasi skema env; cadangan saja
  }
  return `simrs:rl:${name.replace(/[^A-Za-z0-9_-]/g, '_') || 'simrs'}:`;
}

/**
 * Penyimpanan penghitung batas laju (`@nestjs/throttler`) di Redis lewat `RedisService`, dibagi semua instans API.
 *
 * Pilihan penyimpanan (`RATE_LIMIT_STORE`) dan perilaku saat Redis tidak terjangkau:
 * - `memory`: per proses (ditolak di produksi oleh `loadApiEnv`).
 * - `auto` di luar produksi: Redis bila terjangkau saat start, selain itu memori dengan peringatan (diputuskan
 *   sekali saat start, seperti `OUTBOX_SCHEDULER=auto` di worker).
 * - Redis wajib (`APP_ENV=production` atau `RATE_LIMIT_STORE=redis`): bila Redis gagal, endpoint kredensial
 *   (throttler `auth`) **gagal tertutup** (503) agar penebakan kata sandi tidak lolos dengan memecah percobaan ke
 *   banyak instans; batas lain sementara dihitung di memori instans ini agar layanan klinis tetap berjalan.
 *   Galat dicatat sekali per gangguan, pemulihan juga dicatat.
 */
@Injectable()
export class RateLimitStorage implements ThrottlerStorage, OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger('RateLimit');
  private readonly memory = new ThrottlerStorageService();
  readonly keyPrefix: string;
  /** Produksi atau `RATE_LIMIT_STORE=redis`: tanpa cadangan memori untuk endpoint kredensial. */
  readonly redisRequired: boolean;
  private mode: 'redis' | 'memory' = 'memory';
  private failing = false;
  private retryAt = 0;

  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    private readonly redis: RedisService,
  ) {
    this.keyPrefix = env.RATE_LIMIT_REDIS_PREFIX ?? defaultRateLimitPrefix(env.DATABASE_URL);
    this.redisRequired = env.APP_ENV === 'production' || env.RATE_LIMIT_STORE === 'redis';
  }

  /** Penyimpanan yang dipakai proses ini (diagnostik dan tes). */
  get store(): 'redis' | 'memory' {
    return this.mode;
  }

  async onModuleInit(): Promise<void> {
    if (this.env.RATE_LIMIT_STORE === 'memory') {
      this.logger.warn(
        'Batas laju disimpan di memori proses ini (RATE_LIMIT_STORE=memory): tidak dibagi antar-instans API. Hanya untuk pengembangan.',
      );
      return;
    }
    this.redis.client.defineCommand(HIT_COMMAND, { numberOfKeys: 2, lua: HIT_LUA });
    let reachable = true;
    try {
      await withTimeout(this.redis.ping(), PROBE_TIMEOUT_MS);
    } catch {
      reachable = false;
    }
    if (reachable || this.redisRequired) {
      this.mode = 'redis';
      if (!reachable) {
        this.failing = true;
        this.logger.error(
          'Redis batas laju tidak terjangkau saat start: endpoint kredensial ditolak (503) sampai Redis pulih; batas lain sementara per instans.',
        );
      }
      return;
    }
    // Lokal tanpa Redis: hentikan percobaan sambung ulang klien bersama (/ready akan menyambung sendiri bila dipanggil).
    this.redis.client.disconnect();
    this.logger.warn(
      'Redis tidak terjangkau: batas laju disimpan di memori proses ini (RATE_LIMIT_STORE=auto, di luar produksi). Produksi wajib Redis.',
    );
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<StorageRecord> {
    if (this.mode === 'memory') {
      return this.memory.increment(key, ttl, limit, blockDuration, throttlerName);
    }
    if (Date.now() >= this.retryAt) {
      try {
        const record = await this.redisIncrement(key, ttl, limit, blockDuration, throttlerName);
        if (this.failing) {
          this.failing = false;
          this.logger.log('Redis batas laju pulih: penghitung kembali dibagi antar-instans.');
        }
        return record;
      } catch (err) {
        this.onRedisFailure(err);
      }
    }
    if (this.redisRequired && throttlerName === AUTH_THROTTLER) {
      throw new AppError(
        'INTERNAL_ERROR',
        'Layanan masuk sementara tidak tersedia. Coba lagi beberapa saat lagi.',
        503,
      );
    }
    return this.memory.increment(key, ttl, limit, blockDuration, throttlerName);
  }

  onApplicationShutdown(): void {
    this.memory.onApplicationShutdown();
  }

  private async redisIncrement(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<StorageRecord> {
    // `key` sudah hash SHA-256 (endpoint + IP/pengguna). Hash tag {…} menjaga kedua kunci di slot yang sama
    // bila kelak memakai Redis Cluster (skrip Lua multi-kunci).
    const base = `${this.keyPrefix}{${throttlerName}:${key}}`;
    const hit = (this.redis.client as unknown as Record<typeof HIT_COMMAND, HitCommand>)[HIT_COMMAND];
    const [totalHits, windowMs, blocked, blockMs] = await withTimeout(
      hit.call(this.redis.client, base, `${base}:block`, ttl, limit, blockDuration, randomUUID()),
      HIT_TIMEOUT_MS,
    );
    return {
      totalHits,
      timeToExpire: Math.ceil(windowMs / 1000),
      isBlocked: blocked === 1,
      timeToBlockExpire: Math.ceil(blockMs / 1000),
    };
  }

  private onRedisFailure(err: unknown): void {
    this.retryAt = Date.now() + RETRY_AFTER_FAILURE_MS;
    if (this.failing) return;
    this.failing = true;
    const label = errorLabel(err);
    if (this.redisRequired) {
      this.logger.error(
        `Redis batas laju gagal (${label}): endpoint kredensial ditolak (503), batas lain sementara per instans.`,
      );
    } else {
      this.logger.warn(`Redis batas laju gagal (${label}): sementara memakai memori proses ini.`);
    }
  }
}
