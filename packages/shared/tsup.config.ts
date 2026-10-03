import { defineConfig } from 'tsup';

export default defineConfig((options) => ({
  entry: { index: 'src/index.ts', node: 'src/node.ts' },
  format: ['esm', 'cjs'],
  // tsup menyisipkan `baseUrl` saat membangkitkan d.ts; TS 6 menandainya deprecated.
  dts: { compilerOptions: { ignoreDeprecations: '6.0' } },
  // Watch (pnpm dev) tidak mengosongkan dist: aplikasi yang sedang jalan tidak kehilangan paket di tengah rebuild.
  clean: !options.watch,
  sourcemap: true,
  target: 'es2022',
}));
