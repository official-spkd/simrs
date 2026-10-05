import { defineConfig } from 'tsup';

export default defineConfig((options) => ({
  entry: { index: 'src/index.ts' },
  format: ['esm', 'cjs'],
  // tsup menyisipkan `baseUrl` saat membangkitkan d.ts; TS 6 menandainya deprecated.
  dts: { compilerOptions: { ignoreDeprecations: '6.0' } },
  clean: !options.watch,
  sourcemap: true,
  target: 'es2022',
  // `import.meta.url` (lokasi berkas fon) juga di keluaran CJS yang dipakai API dan worker NestJS.
  shims: true,
}));
