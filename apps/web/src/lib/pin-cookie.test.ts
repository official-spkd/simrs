import { PIN_MAX_ACCOUNTS_PER_BROWSER } from '@simrs/shared';
import { describe, expect, it } from 'vitest';
import {
  addPinToken,
  ALL_SESSION_COOKIES,
  parsePinTokens,
  pinTokenId,
  removePinTokens,
  type SessionCookieOptions,
  writePinTokens,
} from './server/cookies';
import { canRegisterPin } from './session-view';

const TENANT = '0199a000-0000-7000-8000-000000000001';
const id = (n: number) => `0199b000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const token = (n: number) => `sd1.${TENANT}.${id(n)}.${'A'.repeat(42)}${n % 10}`;

describe('cookie PIN perangkat (ADR-0024)', () => {
  it('hanya token sd1 sah, tanpa duplikat, maks. batas peramban', () => {
    expect(pinTokenId(token(1))).toBe(id(1));
    expect(pinTokenId(`st1.${TENANT}.${id(1)}.${'A'.repeat(43)}`)).toBeNull();
    const many = Array.from({ length: PIN_MAX_ACCOUNTS_PER_BROWSER + 2 }, (_, i) => token(i + 1));
    const parsed = parsePinTokens(['sampah', token(1), token(1), ...many].join('~'));
    expect(parsed).toHaveLength(PIN_MAX_ACCOUNTS_PER_BROWSER);
    expect(new Set(parsed.map(pinTokenId)).size).toBe(parsed.length);
    expect(parsePinTokens(undefined)).toEqual([]);
  });

  it('token baru di depan; terlama dilupakan; hapus per ID', () => {
    const full = Array.from({ length: PIN_MAX_ACCOUNTS_PER_BROWSER }, (_, i) => token(i + 1));
    const added = addPinToken(full, token(99));
    expect(added[0]).toBe(token(99));
    expect(added).toHaveLength(PIN_MAX_ACCOUNTS_PER_BROWSER);
    expect(added).not.toContain(token(PIN_MAX_ACCOUNTS_PER_BROWSER));
    expect(addPinToken([token(1), token(2)], token(1))).toEqual([token(1), token(2)]);
    expect(removePinTokens([token(1), token(2)], [id(1)])).toEqual([token(2)]);
  });

  it('httpOnly milik perangkat (tidak ikut dihapus saat keluar); daftar kosong = cookie dihapus', () => {
    const set: Array<[string, string, SessionCookieOptions]> = [];
    const w = { set: (n: string, v: string, o: SessionCookieOptions) => set.push([n, v, o]) };
    const now = Date.parse('2026-10-05T03:00:00Z');
    writePinTokens(w, [token(1), token(2)], true, now);
    writePinTokens(w, [], false, now);
    expect(set[0]?.[0]).toBe('__Host-simrs_pin');
    expect(set[0]?.[1]).toBe(`${token(1)}~${token(2)}`);
    expect(set[0]?.[2]).toMatchObject({ httpOnly: true, secure: true, sameSite: 'lax', path: '/' });
    expect(set[0]?.[2]?.expires.getTime()).toBe(now + 30 * 86_400_000);
    expect(set[1]).toEqual(['simrs_pin', '', expect.objectContaining({ expires: new Date(0) })]);
    expect(ALL_SESSION_COOKIES).not.toContain('pinDevices');
  });
});

describe('boleh mendaftarkan PIN (sama dengan aturan API)', () => {
  const base = {
    tenant: { code: 'RSFA', name: 'RS uji', kind: 'hospital' as const },
    role: { code: 'perawat', name: 'Perawat' },
    unit: { id: id(7), name: 'Melati' },
    quickLogin: false,
  };
  it('posisi layanan berunit di sesi penuh saja', () => {
    expect(canRegisterPin(base)).toBe(true);
    expect(canRegisterPin({ ...base, quickLogin: true })).toBe(false);
    expect(canRegisterPin({ ...base, unit: null })).toBe(false);
    expect(canRegisterPin({ ...base, role: { code: 'kasir', name: 'Kasir' } })).toBe(false);
    expect(canRegisterPin({ ...base, role: null })).toBe(false);
    expect(
      canRegisterPin({
        ...base,
        tenant: { ...base.tenant, kind: 'platform' },
        role: { code: 'superadmin_platform', name: 'Superadmin' },
      }),
    ).toBe(false);
  });
});
