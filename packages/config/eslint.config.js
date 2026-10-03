// Konfigurasi ESLint bersama (flat config). Dipakai lewat `import { base } from '@simrs/config/eslint'`.
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export const base = tseslint.config(
  { ignores: ['dist/**', '.next/**', 'coverage/**', 'node_modules/**', 'src/generated/**', 'next-env.d.ts'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  prettier,
);

// Untuk aplikasi NestJS: decorator butuh impor nilai (bukan type-only) agar metadata DI terbentuk.
export const nest = tseslint.config(...base, {
  rules: { '@typescript-eslint/consistent-type-imports': 'off' },
});

export const browser = tseslint.config(...base, {
  languageOptions: { globals: { ...globals.browser } },
});

export default base;
