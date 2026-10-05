import { type ExecutionContext, SetMetadata } from '@nestjs/common';

export const PUBLIC_RATE_LIMITED_KEY = 'simrs:public-rate-limited';

/**
 * F08 · Endpoint gateway informasi publik (tanpa login): selain batas umum per IP, dikenai throttler `public`
 * (PUBLIC_RATE_LIMIT_PER_MIN per IP per endpoint) yang lebih ketat. Cek status booking memakai `@AuthRateLimited()`.
 */
export const PublicRateLimited = () => SetMetadata(PUBLIC_RATE_LIMITED_KEY, true);

/** Dipakai `skipIf` throttler `public`: lewati semua endpoint yang tidak bertanda. */
export function isPublicRateLimited(ctx: ExecutionContext): boolean {
  return (
    Reflect.getMetadata(PUBLIC_RATE_LIMITED_KEY, ctx.getHandler()) === true ||
    Reflect.getMetadata(PUBLIC_RATE_LIMITED_KEY, ctx.getClass()) === true
  );
}
