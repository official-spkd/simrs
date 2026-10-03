import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts', node: 'src/node.ts' },
  format: ['esm', 'cjs'],
  // tsup menyisipkan `baseUrl` saat membangkitkan d.ts; TS 6 menandainya deprecated.
  dts: { compilerOptions: { ignoreDeprecations: '6.0' } },
  clean: true,
  sourcemap: true,
  target: 'es2022',
});
