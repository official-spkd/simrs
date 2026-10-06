import { describe, expect, it } from 'vitest';
import { config } from './proxy';

/**
 * Matcher proxy menentukan rute mana yang mendapat CSP ber-nonce dan langkah sesi (ADR-0073). Pengecualian hanya
 * untuk aset build Next; rute halaman apa pun (termasuk yang path-nya kebetulan berakhiran ekstensi gambar, mis.
 * `/verifikasi/kode.png` atau 404 `/apa.png`) wajib lewat proxy agar tidak dirender tanpa CSP.
 */
const matches = (path: string) =>
  config.matcher.some((m) => new RegExp(`^${m.replace('/(', '(?:/)(')}$`).test(path));

describe('matcher proxy (CSP + sesi di semua halaman)', () => {
  it('aset build Next dikecualikan', () => {
    expect(matches('/_next/static/chunks/app.js')).toBe(false);
    expect(matches('/_next/image')).toBe(false);
    expect(matches('/favicon.ico')).toBe(false);
  });

  it('semua halaman lewat proxy, termasuk path berakhiran ekstensi gambar/fon', () => {
    for (const path of [
      '/',
      '/masuk',
      '/kiosk',
      '/display',
      '/verifikasi/sv1.abc',
      '/verifikasi/kode.png',
      '/apa-saja.svg',
      '/pasien/x.woff2',
    ]) {
      expect(matches(path), path).toBe(true);
    }
  });
});
