import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { blindIndex, decryptField, encryptField, hashToken, randomToken } from './field-crypto';
import { DEFAULT_ARGON2, hashPassword, needsRehash, verifyPassword } from './password-hash';
import { checkPasswordPolicy } from './password-policy';
import { base32Decode, base32Encode, totpCode, totpUri, verifyTotp } from './totp';

describe('argon2id', () => {
  it('hash berformat PHC, verifikasi benar/salah, salt berbeda tiap hash', async () => {
    const h1 = await hashPassword('kata sandi panjang yang aman');
    const h2 = await hashPassword('kata sandi panjang yang aman');
    expect(h1).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(h1).not.toBe(h2);
    expect(await verifyPassword('kata sandi panjang yang aman', h1)).toBe(true);
    expect(await verifyPassword('kata sandi panjang yang salah', h1)).toBe(false);
  });

  it('hash rusak/asing → false; parameter lemah perlu di-hash ulang', async () => {
    expect(await verifyPassword('x', 'bukan-hash')).toBe(false);
    expect(await verifyPassword('x', '$2b$10$abcdefghijklmnopqrstuv')).toBe(false);
    const weak = await hashPassword('kata sandi panjang', { ...DEFAULT_ARGON2, memoryKiB: 4096 });
    expect(needsRehash(weak)).toBe(true);
    expect(needsRehash(await hashPassword('kata sandi panjang'))).toBe(false);
  });
});

describe('TOTP (RFC 6238)', () => {
  // Vektor uji RFC 6238 Lampiran B (SHA1, rahasia ASCII "12345678901234567890"), dipotong ke 6 digit.
  const secret = Buffer.from('12345678901234567890');
  it.each([
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
  ])('t=%i → %s', (t, code) => {
    expect(totpCode(secret, Math.floor(t / 30))).toBe(code);
  });

  it('base32 bolak-balik', () => {
    const raw = randomBytes(20);
    expect(base32Decode(base32Encode(raw)).equals(raw)).toBe(true);
    expect(() => base32Decode('salah!')).toThrow();
  });

  it('toleransi ±1 langkah, tolak kode lama dan kode yang sudah dipakai', () => {
    const b32 = base32Encode(secret);
    const at = new Date(1111111111 * 1000);
    const step = Math.floor(1111111111 / 30);
    expect(verifyTotp(b32, '050471', { at })).toEqual({ ok: true, step });
    const prevCode = totpCode(secret, step - 1);
    expect(verifyTotp(b32, prevCode, { at }).ok).toBe(true);
    expect(verifyTotp(b32, totpCode(secret, step - 3), { at }).ok).toBe(false);
    expect(verifyTotp(b32, '050471', { at, lastUsedStep: step }).ok).toBe(false);
    expect(verifyTotp(b32, '12345', { at }).ok).toBe(false);
    expect(verifyTotp(b32, 'abcdef', { at }).ok).toBe(false);
  });

  it('URI otpauth memuat issuer dan rahasia', () => {
    const uri = totpUri('JBSWY3DPEHPK3PXP', 'nip001@RSFA', 'SIM RS');
    expect(uri).toMatch(
      /^otpauth:\/\/totp\/SIM%20RS%3Anip001%40RSFA\?secret=JBSWY3DPEHPK3PXP&issuer=SIM\+RS/,
    );
  });
});

describe('enkripsi kolom', () => {
  const keyB64 = randomBytes(32).toString('base64');
  const ctx = { keyB64, tenantId: '0199a000-0000-7000-8000-000000000001', purpose: 'mfa_secret' as const };

  it('bolak-balik, IV acak', () => {
    const a = encryptField('JBSWY3DPEHPK3PXP', ctx);
    expect(a).not.toBe(encryptField('JBSWY3DPEHPK3PXP', ctx));
    expect(decryptField(a, ctx)).toBe('JBSWY3DPEHPK3PXP');
  });

  it('gagal bila diubah, dipindah ke tenant/tujuan lain, atau kunci salah', () => {
    const enc = encryptField('9999010101900001', { ...ctx, purpose: 'patient_identifier' });
    const parts = enc.split('.');
    // Ganti karakter pertama ciphertext dengan karakter yang PASTI berbeda (bukan selalu 'A': bisa sama → tes rapuh).
    const body = parts[2] ?? '';
    const tampered = [
      parts[0],
      parts[1],
      `${body.startsWith('A') ? 'B' : 'A'}${body.slice(1)}`,
      parts[3],
    ].join('.');
    expect(() => decryptField(tampered, { ...ctx, purpose: 'patient_identifier' })).toThrow();
    expect(() =>
      decryptField(enc, {
        ...ctx,
        purpose: 'patient_identifier',
        tenantId: '0199a000-0000-7000-8000-000000000002',
      }),
    ).toThrow();
    expect(() => decryptField(enc, ctx)).toThrow();
    expect(() =>
      decryptField(enc, {
        ...ctx,
        purpose: 'patient_identifier',
        keyB64: randomBytes(32).toString('base64'),
      }),
    ).toThrow();
  });

  it('blind index deterministik per tenant, berbeda antar tenant', () => {
    const hashKeyB64 = randomBytes(32).toString('base64');
    const a = blindIndex('9999010101900001', { hashKeyB64, tenantId: 'A', purpose: 'patient_identifier' });
    expect(a).toBe(
      blindIndex('9999010101900001', { hashKeyB64, tenantId: 'A', purpose: 'patient_identifier' }),
    );
    expect(a).not.toBe(
      blindIndex('9999010101900001', { hashKeyB64, tenantId: 'B', purpose: 'patient_identifier' }),
    );
  });

  it('token acak 256 bit; yang disimpan hanya hash', () => {
    const t = randomToken();
    expect(Buffer.from(t, 'base64url')).toHaveLength(32);
    expect(hashToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(t)).not.toContain(t);
  });
});

describe('kebijakan kata sandi', () => {
  const ctx = { minLength: 12, username: 'perawat.rina', tenantCode: 'RSFA' };
  it.each([
    ['pendek', ['too_short']],
    ['password1234', ['common']],
    ['RSFA-bangsal-melati', ['contains_identity']],
    ['aaaaaaaaaaaaaaa', ['repetitive']],
    ['abcabcabcabcabc', ['repetitive']],
    ['abcdefghijklmnop', ['sequential']],
  ])('%s → %j', (pw, expected) => {
    expect(checkPasswordPolicy(pw, ctx)).toEqual(expect.arrayContaining(expected));
  });

  it('frasa sandi panjang yang wajar lolos', () => {
    expect(checkPasswordPolicy('kopi pagi di bangsal tenang', ctx)).toEqual([]);
  });
});

describe('kata sandi sementara', () => {
  it('panjang, acak, tanpa karakter mirip, dan lolos kebijakan', async () => {
    const { generateTemporaryPassword } = await import('./password-hash');
    const a = generateTemporaryPassword();
    expect(a).toHaveLength(16);
    expect(a).not.toMatch(/[0O1lI]/);
    expect(a).not.toBe(generateTemporaryPassword());
    expect(checkPasswordPolicy(a, { minLength: 12, username: 'admin.rs' })).toEqual([]);
    expect(() => generateTemporaryPassword(8)).toThrow(RangeError);
  });
});
