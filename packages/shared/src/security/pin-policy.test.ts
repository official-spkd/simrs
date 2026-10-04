import { describe, expect, it } from 'vitest';
import { pinAccountsSchema, pinLoginSchema, pinRegisterSchema } from '../schemas/auth';
import { PIN_MAX_ACCOUNTS_PER_BROWSER, pinAllowedForRole, pinProblem } from './pin-policy';

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
});
