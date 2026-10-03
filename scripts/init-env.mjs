#!/usr/bin/env node
/**
 * Buat `.env` dari `.env.example` dengan kunci acak baru (FIELD_ENCRYPTION_KEY, FIELD_HASH_KEY).
 * Tidak pernah menimpa `.env` yang sudah ada (kunci lama dibutuhkan untuk membaca data terenkripsi).
 * Pemakaian: pnpm env:init
 */
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

if (existsSync('.env')) {
  console.warn(
    '.env sudah ada, tidak diubah. Hapus manual bila memang ingin membuat ulang (data terenkripsi lama tidak terbaca).',
  );
  process.exit(0);
}

const key = () => randomBytes(32).toString('base64');
const out = readFileSync('.env.example', 'utf8')
  .replace(/^FIELD_ENCRYPTION_KEY=.*$/m, `FIELD_ENCRYPTION_KEY=${key()}`)
  .replace(/^FIELD_HASH_KEY=.*$/m, `FIELD_HASH_KEY=${key()}`);
writeFileSync('.env', out, { mode: 0o600 });
console.warn(
  '.env dibuat dengan kunci acak. Jangan di-commit; simpan cadangannya bila ada data terenkripsi.',
);
