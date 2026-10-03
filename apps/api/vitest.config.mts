import { defineConfig } from 'vitest/config';

// NestJS butuh decorator legacy + metadata tipe (DI). Transformer Oxc bawaan Vite mendukung keduanya.
export default defineConfig({
  oxc: { decorator: { legacy: true, emitDecoratorMetadata: true } },
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    testTimeout: 20_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
