import { browser } from '@simrs/config/eslint';

export default [
  ...browser,
  { ignores: ['postcss.config.mjs', 'playwright-report/**', 'test-results/**'] },
  {
    // Web adalah BFF (ADR-0013): kode runtime tidak boleh menyentuh database. `@simrs/db` (Prisma) hanya untuk tes
    // dan E2E (menyiapkan data uji, silang-cek kode rujukan pada data dummy).
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [{ name: '@simrs/db', message: 'Web tidak mengakses database; pakai API (lib/server).' }],
          patterns: [
            { group: ['@simrs/db/*'], message: 'Web tidak mengakses database; pakai API (lib/server).' },
          ],
        },
      ],
    },
  },
];
