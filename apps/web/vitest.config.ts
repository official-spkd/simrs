import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // Modul server (data dummy, gerbang demo) memakai `import 'server-only'`; di tes unit cukup modul kosong.
      'server-only': fileURLToPath(new URL('./src/test/server-only.ts', import.meta.url)),
    },
  },
  test: { include: ['src/**/*.test.{ts,tsx}'] },
});
