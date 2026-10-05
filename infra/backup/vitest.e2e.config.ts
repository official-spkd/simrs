import { defineConfig } from 'vitest/config';

/**
 * Uji pemulihan sungguhan (ADR-0071): pg_dump database tes → enkripsi → tiga lokasi → kontainer Postgres bersih →
 * pg_restore → API `/ready` + `/audit/verify`. Butuh Docker, Postgres + MinIO dari `docker compose`, dan
 * `pnpm build` (API). Hanya lewat `pnpm --filter @simrs/backup test:pemulihan`, tidak ikut `pnpm test`.
 */
export default defineConfig({
  test: {
    include: ['test/e2e/**/*.test.ts'],
    testTimeout: 600_000,
    hookTimeout: 300_000,
    fileParallelism: false,
  },
});
