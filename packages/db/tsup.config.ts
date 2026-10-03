import { defineConfig } from 'tsup';

export default defineConfig((options) => ({
  entry: { index: 'src/index.ts', testing: 'src/testing.ts' },
  format: ['esm', 'cjs'],
  // tsup menyisipkan `baseUrl` saat membangkitkan d.ts; TS 6 menandainya deprecated.
  dts: { compilerOptions: { ignoreDeprecations: '6.0' } },
  // Watch (pnpm dev) tidak mengosongkan dist: aplikasi yang sedang jalan tidak kehilangan paket di tengah rebuild.
  clean: !options.watch,
  sourcemap: true,
  target: 'es2022',
  // Client Prisma (ESM) memakai import.meta.url; shim agar build CJS (NestJS) tetap jalan.
  shims: true,
  // Driver dan runtime Prisma tetap sebagai dependensi runtime, tidak di-bundle.
  external: ['@prisma/client', '@prisma/adapter-pg', 'pg'],
}));
