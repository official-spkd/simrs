import { describe, expect, it } from 'vitest';
import {
  accountStatus,
  aksesHref,
  countChanges,
  deviceLabel,
  formatLastLogin,
  fromGrantMap,
  nextScope,
  NOT_ACTIVATED_HINT,
  STATUS_FILTERS,
  statusFilterParam,
  toGrantMap,
} from './akses';

describe('formatLastLogin (zona Asia/Jakarta)', () => {
  const now = new Date('2026-10-04T05:00:00Z'); // 12.00 WIB, Minggu 4 Okt 2026
  it('hari ini, kemarin, n hari lalu, tanggal', () => {
    expect(formatLastLogin('2026-10-04T00:02:00Z', now)).toBe('hari ini 07.02');
    // 23.30 WIB tanggal 3 = kemarin walau selisihnya < 24 jam
    expect(formatLastLogin('2026-10-03T16:30:00Z', now)).toBe('kemarin 23.30');
    expect(formatLastLogin('2026-09-24T03:00:00Z', now)).toBe('10 hari lalu');
    expect(formatLastLogin('2026-07-01T03:00:00Z', now)).toBe('Rab, 1 Jul 2026');
    expect(formatLastLogin(null, now)).toBe('belum pernah');
  });
});

describe('accountStatus', () => {
  const base = { status: 'active', activated: true, locked: false, dormant: false, neverLoggedIn: false };
  it('urutan prioritas: nonaktif > belum diaktifkan > dikunci > dormant > belum login > aktif', () => {
    expect(accountStatus({ ...base, status: 'disabled', activated: false }).label).toBe('Nonaktif');
    expect(accountStatus({ ...base, activated: false, dormant: true, neverLoggedIn: true })).toEqual({
      label: 'Belum diaktifkan',
      tone: 'warning',
      icon: 'clock',
    });
    expect(accountStatus({ ...base, locked: true, dormant: true })).toEqual({
      label: 'Dikunci',
      tone: 'danger',
      icon: 'alert',
    });
    expect(accountStatus({ ...base, dormant: true, neverLoggedIn: true }).label).toBe('Dormant');
    expect(accountStatus({ ...base, neverLoggedIn: true }).label).toBe('Belum login');
    expect(accountStatus(base)).toEqual({ label: 'Aktif', tone: 'success', icon: 'check' });
  });

  it('setiap status punya ikon berbeda (tidak hanya warna)', () => {
    const all = [
      { ...base, status: 'disabled' },
      { ...base, activated: false },
      { ...base, locked: true },
      { ...base, dormant: true },
      { ...base, neverLoggedIn: true },
      base,
    ].map(accountStatus);
    expect(new Set(all.map((s) => s.label)).size).toBe(6);
    expect(new Set(all.map((s) => s.icon)).size).toBe(6);
  });

  it('petunjuk akun belum diaktifkan menyebut tombol Reset kata sandi', () => {
    expect(NOT_ACTIVATED_HINT).toContain('"Reset kata sandi"');
    expect(NOT_ACTIVATED_HINT).toContain('belum bisa masuk');
  });
});

describe('filter status', () => {
  it('nilai URL dipetakan ke status API, termasuk belum diaktifkan; nilai lain diabaikan', () => {
    expect(STATUS_FILTERS.map((f) => f.label)).toEqual(['Aktif', 'Belum diaktifkan', 'Nonaktif']);
    expect(statusFilterParam('aktif')).toBe('active');
    expect(statusFilterParam('belum-diaktifkan')).toBe('not_activated');
    expect(statusFilterParam('nonaktif')).toBe('disabled');
    expect(statusFilterParam('active')).toBeUndefined();
    expect(statusFilterParam(undefined)).toBeUndefined();
  });
});

describe('matriks izin', () => {
  it('siklus sel dari tersempit: — → Relasi → Unit → Semua → —', () => {
    expect(nextScope(null)).toBe('relationship');
    expect(nextScope('relationship')).toBe('unit');
    expect(nextScope('unit')).toBe('all');
    expect(nextScope('all')).toBeNull();
  });

  it('peta izin bolak-balik dan hitung perubahan', () => {
    const grants = [
      { resource: 'patient', action: 'read', scope: 'relationship' as const },
      { resource: 'audit', action: 'read', scope: 'all' as const },
    ];
    const base = toGrantMap(grants);
    expect(fromGrantMap(base)).toEqual([grants[1], grants[0]]);
    const edited = { ...base, 'patient|read': 'unit' as const, 'ref|read': 'all' as const };
    delete (edited as Record<string, string>)['audit|read'];
    expect(countChanges(base, edited)).toBe(3);
    expect(countChanges(base, { ...base })).toBe(0);
  });
});

describe('aksesHref', () => {
  it('mempertahankan filter, menghapus parameter kosong', () => {
    expect(aksesHref({ q: 'rina', peran: 'perawat' }, { pengguna: 'u1' })).toBe(
      '/sistem/akses?q=rina&peran=perawat&pengguna=u1',
    );
    expect(aksesHref({ q: 'rina', kursor: 'c' }, { kursor: undefined })).toBe('/sistem/akses?q=rina');
    expect(aksesHref({}, {})).toBe('/sistem/akses');
  });
});

describe('deviceLabel (perangkat tepercaya)', () => {
  it('peramban + sistem operasi tanpa versi', () => {
    expect(
      deviceLabel(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
      ),
    ).toBe('Chrome di Windows');
    expect(
      deviceLabel(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
      ),
    ).toBe('Safari di macOS');
    expect(
      deviceLabel('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/141 Safari/537.36 Edg/141.0'),
    ).toBe('Edge di Windows');
    expect(deviceLabel('Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0')).toBe(
      'Firefox di Linux',
    );
    expect(deviceLabel(null)).toBe('Peramban tidak dikenal');
  });
});
