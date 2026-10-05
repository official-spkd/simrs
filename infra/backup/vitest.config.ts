import { defineConfig } from 'vitest/config';

/** Tes unit logika backup (tanpa Docker/Postgres). Uji pemulihan end-to-end: `vitest.e2e.config.ts`. */
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['test/e2e/**'],
    testTimeout: 20_000,
  },
});
