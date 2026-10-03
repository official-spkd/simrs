import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clientInfo } from './client-info';
import { loginUrl, safeNextPath } from './safe-path';
import { clearCookies, cookieNames, type SessionCookieOptions, writeSessionCookies } from './server/cookies';
import { refreshSession, resetRefreshCache } from './server/refresh';
import { webEnv } from './server/web-env';
import { initials, isSuperadmin, nextLoginStep } from './session-view';

const headers = (h: Record<string, string>) => new Headers(h);

describe('safeNextPath (anti open redirect)', () => {
  it('menerima path internal, menolak tujuan luar dan trik encoding', () => {
    expect(safeNextPath('/sistem/akses?tab=peran#matriks')).toBe('/sistem/akses?tab=peran#matriks');
    for (const bad of [
      'https://jahat.id',
      '//jahat.id',
      '/\\jahat.id',
      '\\\\jahat.id',
      'javascript:alert(1)',
      '/%0d%0aSet-Cookie:x',
      '/a\nb',
      '',
      null,
      '/masuk',
      '/masuk?lanjut=/x',
    ]) {
      expect(safeNextPath(bad), String(bad)).toBe('/');
    }
    expect(safeNextPath('/x'.repeat(300))).toBe('/');
  });

  it('loginUrl membawa tujuan dan alasan', () => {
    expect(loginUrl('/')).toBe('/masuk');
    expect(loginUrl('/sistem/akses')).toBe('/masuk?lanjut=%2Fsistem%2Fakses');
    expect(loginUrl('https://jahat.id', 'sesi-berakhir')).toBe('/masuk?alasan=sesi-berakhir');
  });
});

describe('clientInfo', () => {
  it('IP = entri paling kanan X-Forwarded-For (dari reverse proxy), entri kiri bisa palsu', () => {
    expect(clientInfo(headers({ 'x-forwarded-for': '6.6.6.6, 10.1.2.3' })).ip).toBe('10.1.2.3');
    expect(clientInfo(headers({ 'x-forwarded-for': '::1' })).ip).toBe('::1');
    expect(clientInfo(headers({ 'x-forwarded-for': 'bukan-ip' })).ip).toBeNull();
    expect(clientInfo(headers({})).ip).toBeNull();
  });

  it('host divalidasi; user agent dipotong', () => {
    expect(clientInfo(headers({ host: 'RSFA.SimRS.id:443' })).host).toBe('rsfa.simrs.id:443');
    expect(clientInfo(headers({ 'x-forwarded-host': 'a.id, b.id', host: 'c.id' })).host).toBe('a.id');
    expect(clientInfo(headers({ host: 'jahat.id/<script>' })).host).toBeNull();
    expect(clientInfo(headers({ 'user-agent': 'x'.repeat(500) })).userAgent).toHaveLength(300);
  });
});

describe('cookie sesi', () => {
  const tokens = {
    accessToken: 'a',
    accessExpiresAt: '2026-10-04T10:15:00.000Z',
    refreshToken: 'r',
    refreshExpiresAt: '2026-10-04T18:00:00.000Z',
  };

  it('httpOnly + SameSite=Lax; Secure dan __Host- di luar lokal; cookie akses habis 60 detik lebih awal', () => {
    const set: Array<[string, string, SessionCookieOptions]> = [];
    writeSessionCookies(
      { set: (n, v, o) => set.push([n, v, o]) },
      tokens,
      true,
      Date.parse('2026-10-04T10:00:00Z'),
    );
    expect(set.map(([n]) => n)).toEqual(['__Host-simrs_at', '__Host-simrs_rt']);
    for (const [, , o] of set)
      expect(o).toMatchObject({ httpOnly: true, secure: true, sameSite: 'lax', path: '/' });
    expect(set[0]?.[2].expires.toISOString()).toBe('2026-10-04T10:14:00.000Z');
    expect(set[1]?.[2].expires.toISOString()).toBe(tokens.refreshExpiresAt);
    expect(cookieNames(false).access).toBe('simrs_at');
  });

  it('hapus = timpa dengan kedaluwarsa masa lalu', () => {
    const set: Array<[string, string, SessionCookieOptions]> = [];
    clearCookies({ set: (n, v, o) => set.push([n, v, o]) }, false, ['access', 'refresh']);
    expect(set.every(([, v, o]) => v === '' && o.expires.getTime() === 0)).toBe(true);
  });
});

describe('webEnv (gagal aman)', () => {
  it('APP_ENV tak disetel/tak dikenal = produksi: tanpa kolom kode RS, cookie Secure', () => {
    for (const APP_ENV of [undefined, '', 'Local', 'prod']) {
      expect(webEnv({ APP_ENV })).toMatchObject({
        appEnv: 'production',
        tenantCodeField: false,
        secureCookies: true,
      });
    }
    expect(webEnv({ APP_ENV: 'local' })).toMatchObject({ tenantCodeField: true, secureCookies: false });
    expect(webEnv({ APP_ENV: 'staging' })).toMatchObject({ tenantCodeField: true, secureCookies: true });
  });
});

describe('langkah login dan peran', () => {
  const full = { mfaVerified: true, mustChangePassword: false, role: { code: 'perawat', name: 'Perawat' } };

  it('urutan: akun → verifikasi/daftar MFA → ganti sandi → unit → selesai', () => {
    expect(nextLoginStep(null, false)).toBe('akun');
    expect(nextLoginStep(null, true)).toBe('verifikasi');
    expect(nextLoginStep({ ...full, mfaVerified: false }, false)).toBe('daftar-mfa');
    expect(nextLoginStep({ ...full, mustChangePassword: true }, false)).toBe('ganti-sandi');
    expect(nextLoginStep({ ...full, role: null }, false)).toBe('unit');
    expect(nextLoginStep(full, false)).toBe('selesai');
  });

  it('superadmin = tenant PLATFORM + izin panduan (peran RS dengan izin palsu tetap bukan superadmin)', () => {
    expect(
      isSuperadmin({
        tenant: { code: 'PLATFORM', name: 'P', kind: 'platform' },
        permissions: ['platform.guide.read'],
      }),
    ).toBe(true);
    expect(
      isSuperadmin({
        tenant: { code: 'RSFA', name: 'R', kind: 'hospital' },
        permissions: ['platform.guide.read'],
      }),
    ).toBe(false);
    expect(isSuperadmin({ tenant: { code: 'PLATFORM', name: 'P', kind: 'platform' }, permissions: [] })).toBe(
      false,
    );
  });

  it('inisial tanpa gelar', () => {
    expect(initials('Rina Wulandari, S.Kep')).toBe('RW');
    expect(initials('dr. Nur Fadilah')).toBe('NF');
    expect(initials('Andi')).toBe('A');
    expect(initials('')).toBe('?');
  });
});

describe('refreshSession (sekali per refresh token)', () => {
  const rt = `sr1.${'0199a000-0000-7000-8000-000000000001'}.${'0199a000-0000-7000-8000-0000000000aa'}.${'x'.repeat(43)}`;
  const fresh = {
    accessToken: `sa1.0199a000-0000-7000-8000-000000000001.0199a000-0000-7000-8000-0000000000aa.${'y'.repeat(43)}`,
    accessExpiresAt: '2026-10-04T10:15:00.000Z',
    refreshToken: `sr1.0199a000-0000-7000-8000-000000000001.0199a000-0000-7000-8000-0000000000aa.${'z'.repeat(43)}`,
    refreshExpiresAt: '2026-10-04T18:00:00.000Z',
  };

  beforeEach(() => resetRefreshCache());
  afterEach(() => vi.unstubAllGlobals());

  it('permintaan paralel dengan token yang sama hanya memanggil API sekali', async () => {
    const fetchMock = vi.fn(async () => Response.json(fresh));
    vi.stubGlobal('fetch', fetchMock);
    const results = await Promise.all([1, 2, 3].map(() => refreshSession('http://api.test', rt, null)));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(results.every((r) => r.ok && r.tokens.accessToken === fresh.accessToken)).toBe(true);
  });

  it('401 disimpan (konsisten), galat sementara tidak (boleh dicoba lagi); token salah format tidak dikirim', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await refreshSession('http://api.test', rt, null)).toEqual({ ok: false, status: 503 });
    expect(await refreshSession('http://api.test', rt, null)).toEqual({ ok: false, status: 503 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await refreshSession('http://api.test', 'sr1.palsu', null)).toEqual({ ok: false, status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
