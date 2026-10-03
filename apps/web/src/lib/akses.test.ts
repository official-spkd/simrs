import { describe, expect, it } from 'vitest';
import {
  accountStatus,
  aksesHref,
  countChanges,
  formatLastLogin,
  fromGrantMap,
  nextScope,
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
  const base = { status: 'active', locked: false, dormant: false, neverLoggedIn: false };
  it('urutan prioritas: nonaktif > dikunci > dormant > belum login > aktif', () => {
    expect(accountStatus({ ...base, status: 'disabled', locked: true }).label).toBe('Nonaktif');
    expect(accountStatus({ ...base, locked: true, dormant: true })).toEqual({
      label: 'Dikunci',
      tone: 'danger',
    });
    expect(accountStatus({ ...base, dormant: true, neverLoggedIn: true }).label).toBe('Dormant');
    expect(accountStatus({ ...base, neverLoggedIn: true }).label).toBe('Belum login');
    expect(accountStatus(base)).toEqual({ label: 'Aktif', tone: 'success' });
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
