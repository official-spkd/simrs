import { type ExecutionContext, SetMetadata } from '@nestjs/common';

export const AUTH_RATE_LIMITED_KEY = 'simrs:auth-rate-limited';

/**
 * Endpoint kredensial (login, verifikasi MFA, ganti sandi, refresh) dikenai batas ketat per IP
 * (throttler bernama `auth`, AUTH_RATE_LIMIT_PER_MIN), di samping batas umum dan kunci akun per pengguna.
 */
export const AuthRateLimited = () => SetMetadata(AUTH_RATE_LIMITED_KEY, true);

/** Dipakai `skipIf` throttler `auth`: lewati semua endpoint yang tidak bertanda. */
export function isAuthRateLimited(ctx: ExecutionContext): boolean {
  return (
    Reflect.getMetadata(AUTH_RATE_LIMITED_KEY, ctx.getHandler()) === true ||
    Reflect.getMetadata(AUTH_RATE_LIMITED_KEY, ctx.getClass()) === true
  );
}
