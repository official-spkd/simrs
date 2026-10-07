import { describe, expect, it } from 'vitest';
import { normalizeBasePath, withBasePath } from './base-path';

describe('normalizeBasePath', () => {
  it('kosong berarti akar domain', () => {
    expect(normalizeBasePath(undefined)).toBe('');
    expect(normalizeBasePath('  ')).toBe('');
    expect(normalizeBasePath('/')).toBe('');
  });

  it('menerima satu atau beberapa segmen dan membuang garis miring akhir', () => {
    expect(normalizeBasePath('/demo-simrs')).toBe('/demo-simrs');
    expect(normalizeBasePath('/demo/simrs/')).toBe('/demo/simrs');
  });

  it('menolak bentuk yang tidak sah', () => {
    for (const bad of ['demo-simrs', '/Demo', '/demo simrs', '/../x', '/demo?x=1']) {
      expect(() => normalizeBasePath(bad)).toThrow(/WEB_BASE_PATH/);
    }
  });
});

describe('withBasePath', () => {
  it('menambahkan prefiks ke path internal absolut', () => {
    expect(withBasePath('/masuk?next=%2F', '/demo-simrs')).toBe('/demo-simrs/masuk?next=%2F');
  });

  it('tanpa prefiks, path tidak berubah', () => {
    expect(withBasePath('/masuk', '')).toBe('/masuk');
  });

  it('tidak menyentuh jangkar, URL absolut, protocol-relative, dan path relatif', () => {
    for (const url of ['#riwayat', 'https://contoh.id/a', '//cdn.contoh.id/a', 'gambar/a.png']) {
      expect(withBasePath(url, '/demo-simrs')).toBe(url);
    }
  });
});
