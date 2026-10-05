import { describe, expect, it } from 'vitest';
import { pinAccountsSchema, pinLoginSchema, pinRegisterSchema } from '../schemas/auth';
import { SENSITIVE_ROLES, SYSTEM_ROLES } from '../authz';
import { parseTenantSetting, TENANT_SETTINGS } from '../settings';
import {
  PIN_LOGIN_ROLES,
  PIN_MAX_ACCOUNTS_PER_BROWSER,
  pinAllowedForRole,
  pinProblem,
  pinUnavailableReason,
} from './pin-policy';

describe('PIN masuk cepat (P02, ADR-0024)', () => {
  it('menolak PIN mudah ditebak, menerima yang acak', () => {
    expect(pinProblem('000000')).toMatch(/sama semua/);
    expect(pinProblem('123456')).toMatch(/berurutan/);
    expect(pinProblem('987654')).toMatch(/berurutan/);
    expect(pinProblem('121212')).toMatch(/berulang/);
    expect(pinProblem('258258')).toMatch(/berulang/);
    expect(pinProblem('112233')).toMatch(/berulang/);
    expect(pinProblem('123321')).toMatch(/mudah ditebak/);
    expect(pinProblem('147258')).toMatch(/mudah ditebak/);
    expect(pinProblem('12345')).toMatch(/6 digit/);
    expect(pinProblem('1234567')).toMatch(/6 digit/);
    expect(pinProblem('48a913')).toMatch(/6 digit/);
    expect(pinProblem(' 48291')).toMatch(/6 digit/);
    expect(pinProblem('482913')).toBeNull();
    expect(pinProblem('730594')).toBeNull();
  });

  it('PIN tidak boleh potongan NIP', () => {
    expect(pinProblem('482913', { username: '198504829130001' })).toMatch(/NIP/);
    expect(pinProblem('482913', { username: 'perawat.rina' })).toBeNull();
  });

  it('hanya peran layanan; peran sensitif, buatan RS, dan operator platform tidak', () => {
    for (const code of ['perawat', 'dokter', 'bidan', 'petugas_pendaftaran']) {
      expect(pinAllowedForRole(code)).toBe(true);
    }
    for (const code of ['admin_tenant', 'kasir', 'akuntan', 'koder', 'petugas_rm', 'manajemen']) {
      expect(pinAllowedForRole(code)).toBe(false);
    }
    expect(pinAllowedForRole('superadmin_platform')).toBe(false);
    expect(pinAllowedForRole('peran_buatan_rs')).toBe(false);
    expect(pinAllowedForRole(null)).toBe(false);
  });

  it('kontrak: 6 digit, sandi wajib saat daftar, batas token per peramban', () => {
    expect(pinRegisterSchema.safeParse({ name: 'Nurse station', pin: '482913', password: 'x' }).success).toBe(
      true,
    );
    expect(pinRegisterSchema.safeParse({ name: 'NS', pin: '482913', password: 'x' }).success).toBe(false);
    expect(pinRegisterSchema.safeParse({ name: 'Nurse station', pin: '482913' }).success).toBe(false);
    expect(pinLoginSchema.safeParse({ deviceToken: 'x'.repeat(40), pin: '48291' }).success).toBe(false);
    expect(
      pinLoginSchema.safeParse({ deviceToken: 'x'.repeat(40), pin: '482913', username: 'a' }).success,
    ).toBe(false);
    const tokens = Array.from({ length: PIN_MAX_ACCOUNTS_PER_BROWSER + 1 }, () => 'x'.repeat(40));
    expect(pinAccountsSchema.safeParse({ deviceTokens: tokens }).success).toBe(false);
    expect(pinAccountsSchema.safeParse({ deviceTokens: tokens.slice(1) }).success).toBe(true);
  });

  it('peran PIN dan peran sensitif saling lepas dan bersama mencakup semua peran sistem', () => {
    const sensitive = new Set<string>(SENSITIVE_ROLES);
    expect(PIN_LOGIN_ROLES.filter((r) => sensitive.has(r))).toEqual([]);
    expect([...PIN_LOGIN_ROLES, ...SENSITIVE_ROLES].filter((r) => r in SYSTEM_ROLES).sort()).toEqual(
      Object.keys(SYSTEM_ROLES).sort(),
    );
  });

  it('ketersediaan PIN: sesi PIN, platform, dimatikan RS, peran di luar pengaturan, tanpa unit', () => {
    const policy = { enabled: true, allowedRoles: ['perawat', 'dokter'] };
    const s = { quickLogin: false, tenantKind: 'hospital', roleCode: 'perawat', unitId: 'u' };
    expect(pinUnavailableReason(s, policy)).toBeNull();
    expect(pinUnavailableReason({ ...s, quickLogin: true }, policy)).toBe('quick_session');
    expect(pinUnavailableReason({ ...s, tenantKind: 'platform' }, policy)).toBe('platform');
    expect(pinUnavailableReason(s, { ...policy, enabled: false })).toBe('disabled');
    expect(pinUnavailableReason({ ...s, roleCode: null }, policy)).toBe('no_position');
    expect(pinUnavailableReason({ ...s, roleCode: 'bidan' }, policy)).toBe('role');
    // Pengaturan tidak bisa membuka PIN untuk peran sensitif.
    expect(pinUnavailableReason({ ...s, roleCode: 'kasir' }, { ...policy, allowedRoles: ['kasir'] })).toBe(
      'role',
    );
    expect(pinUnavailableReason({ ...s, unitId: null }, policy)).toBe('no_unit');
  });

  it('pengaturan RS: bawaan aman, isi tervalidasi', () => {
    expect(TENANT_SETTINGS['login.totp_only_roles'].default).toEqual([...SENSITIVE_ROLES]);
    expect(TENANT_SETTINGS['login.backup_code_channels'].default).toEqual(['whatsapp', 'email']);
    expect(TENANT_SETTINGS['pin.allowed_roles'].default).toEqual([...PIN_LOGIN_ROLES]);
    expect(parseTenantSetting('login.backup_code_channels', [])).toEqual([]);
    expect(() => parseTenantSetting('login.backup_code_channels', ['email', 'email'])).toThrow();
    expect(() => parseTenantSetting('pin.allowed_roles', ['admin_tenant'])).toThrow();
    expect(() => parseTenantSetting('login.totp_only_roles', ['Bukan Kode'])).toThrow();
  });
});
