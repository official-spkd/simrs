import { Injectable } from '@nestjs/common';
import { ThrottlerGuard, type ThrottlerOptions } from '@nestjs/throttler';
import { isAuthRateLimited } from '../common/auth-rate-limited.decorator';
import { isPublicRateLimited } from '../common/public-rate-limited.decorator';
import type { ApiEnv } from '../config/env';
import type { AuthenticatedRequest } from './auth/auth.guard';

/** Nama throttler. `default` tanpa akhiran di header (`X-RateLimit-Limit`), lainnya `-auth`/`-user`. */
export const IP_THROTTLER = 'default';
export const AUTH_THROTTLER = 'auth';
export const USER_THROTTLER = 'user';
export const PUBLIC_THROTTLER = 'public';

const MINUTE_MS = 60_000;

/**
 * Pelacak batas per pengguna: tenant + ID pengguna dari sesi yang sudah divalidasi AuthGuard (atau tenant + ID
 * perangkat untuk prinsipal perangkat, ADR-0027). `null` untuk
 * permintaan tanpa pengguna (anonim, mode header pengembang) sehingga throttler `user` dilewati.
 */
export function userTracker(req: Pick<AuthenticatedRequest, 'tenantId' | 'actor'>): string | null {
  const userId = req.actor?.userId;
  if (req.tenantId && userId) return `${req.tenantId}:${userId}`;
  // Prinsipal perangkat (ADR-0027): batas yang sama per perangkat (anjungan/TV), apa pun IP-nya.
  const deviceId = req.actor?.devicePrincipal?.id;
  return req.tenantId && deviceId ? `${req.tenantId}:device:${deviceId}` : null;
}

/**
 * Tiga batas per menit, masing-masing per endpoint. Kunci = hash SHA-256 dari endpoint + pelacak (bawaan
 * `ThrottlerGuard.generateKey`), jadi IP dan ID pengguna tidak tersimpan apa adanya di Redis.
 * - `default`: per IP klien (`req.ip`, mengikuti `TRUST_PROXY`). Tanpa tenant: berganti kode RS tidak membuka kuota baru.
 * - `auth`: endpoint `@AuthRateLimited()` per IP (penebakan kata sandi/kode).
 * - `public`: gateway informasi publik F08 (`@PublicRateLimited()`) per IP, lebih ketat dari batas umum.
 * - `user`: per pengguna login, apa pun IP-nya (staf satu RS sering berbagi IP lewat NAT, jadi batas IP longgar).
 */
export function rateLimitThrottlers(env: ApiEnv): ThrottlerOptions[] {
  return [
    { name: IP_THROTTLER, ttl: MINUTE_MS, limit: env.RATE_LIMIT_PER_MIN },
    {
      name: AUTH_THROTTLER,
      ttl: MINUTE_MS,
      limit: env.AUTH_RATE_LIMIT_PER_MIN,
      skipIf: (ctx) => !isAuthRateLimited(ctx),
    },
    {
      name: PUBLIC_THROTTLER,
      ttl: MINUTE_MS,
      limit: env.PUBLIC_RATE_LIMIT_PER_MIN,
      skipIf: (ctx) => !isPublicRateLimited(ctx),
    },
    {
      name: USER_THROTTLER,
      ttl: MINUTE_MS,
      limit: env.USER_RATE_LIMIT_PER_MIN,
      skipIf: (ctx) => userTracker(ctx.switchToHttp().getRequest<AuthenticatedRequest>()) === null,
      getTracker: (req) => userTracker(req as AuthenticatedRequest) ?? '',
    },
  ];
}

/**
 * Guard global (APP_GUARD): batas per IP dan batas endpoint kredensial. Berjalan sebelum AuthGuard, jadi
 * pengguna belum diketahui; throttler `user` ditangani `UserThrottlerGuard`.
 */
@Injectable()
export class IpThrottlerGuard extends ThrottlerGuard {
  override async onModuleInit(): Promise<void> {
    await super.onModuleInit();
    this.throttlers = this.throttlers.filter((t) => t.name !== USER_THROTTLER);
  }
}

/**
 * Batas per pengguna. Dipasang `@TenantScoped()` tepat setelah AuthGuard (yang mengisi tenant + pengguna dari
 * sesi), sebelum transaksi database dibuka. Header dan galat 429 sama dengan throttler lain (akhiran `-user`).
 */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  override async onModuleInit(): Promise<void> {
    await super.onModuleInit();
    this.throttlers = this.throttlers.filter((t) => t.name === USER_THROTTLER);
  }
}
