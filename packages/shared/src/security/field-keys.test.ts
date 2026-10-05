import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { envSchemas, parseEnv } from '../env';
import {
  blindIndex,
  blindIndexes,
  blindIndexKeyId,
  decryptField,
  encryptField,
  fieldKeyId,
  isCurrentBlindIndex,
  isCurrentCipher,
} from './field-crypto';
import { FieldKeyError, fieldKeysFromEnv, legacyFieldKeys, loadFieldKeys, parseKeyRing } from './field-keys';
import { PatientCrypto } from './patient-crypto';

const key = () => randomBytes(32).toString('base64');
const T = '0199a000-0000-7000-8000-000000000001';

/** Kunci lama (format FIELD_*_KEY) + kunci v2 baru, seperti di tengah rotasi. */
const v1Enc = key();
const v1Hash = key();
const v2Enc = key();
const v2Hash = key();
const rotating = fieldKeysFromEnv({
  FIELD_ENCRYPTION_KEYS: `v2:${v2Enc}`,
  FIELD_ENCRYPTION_KEY: v1Enc,
  FIELD_HASH_KEYS: `v2:${v2Hash}`,
  FIELD_HASH_KEY: v1Hash,
});

describe('cincin kunci kolom: konfigurasi', () => {
  it('format lama saja = cincin satu kunci v1', () => {
    const keys = fieldKeysFromEnv({ FIELD_ENCRYPTION_KEY: v1Enc, FIELD_HASH_KEY: v1Hash });
    expect(keys.enc.ids).toEqual(['v1']);
    expect(keys.enc.currentId).toBe('v1');
    expect(keys.hash.currentId).toBe('v1');
  });

  it('kunci pertama aktif; kunci format lama ditambahkan sebagai v1 hanya-baca di akhir', () => {
    expect(rotating.enc.ids).toEqual(['v2', 'v1']);
    expect(rotating.enc.currentId).toBe('v2');
    expect(rotating.hash.ids).toEqual(['v2', 'v1']);
    // Rilis dua tahap: v1 tetap aktif sementara v2 sudah bisa dibaca semua instans.
    const staged = parseKeyRing({ spec: `v1:${v1Enc},v2:${v2Enc}`, specName: 'S', legacyName: 'L' });
    expect(staged.currentId).toBe('v1');
    expect(staged.has('v2')).toBe(true);
  });

  it('v1 di cincin boleh sama dengan kunci format lama, tidak boleh berbeda', () => {
    const same = parseKeyRing({
      spec: `v2:${v2Enc}, v1:${v1Enc}`,
      specName: 'FIELD_ENCRYPTION_KEYS',
      legacy: v1Enc,
      legacyName: 'FIELD_ENCRYPTION_KEY',
    });
    expect(same.ids).toEqual(['v2', 'v1']);
    expect(() =>
      parseKeyRing({
        spec: `v2:${v2Enc},v1:${key()}`,
        specName: 'FIELD_ENCRYPTION_KEYS',
        legacy: v1Enc,
        legacyName: 'FIELD_ENCRYPTION_KEY',
      }),
    ).toThrow(/FIELD_ENCRYPTION_KEY berbeda dengan v1 di FIELD_ENCRYPTION_KEYS/);
  });

  it.each([
    ['kosong', {}, /FIELD_ENCRYPTION_KEYS atau FIELD_ENCRYPTION_KEY wajib/],
    ['tanpa ID', { spec: v2Enc }, /<ID>:<base64>/],
    ['ID salah', { spec: `v0:${v2Enc}` }, /ID kunci "v0"/],
    ['ID nol di depan', { spec: `v02:${v2Enc}` }, /ID kunci "v02"/],
    ['bukan 32 byte', { spec: `v2:${randomBytes(16).toString('base64')}` }, /kunci v2 harus 32 byte/],
    ['ID ganda', { spec: `v2:${v2Enc},v2:${key()}` }, /ID kunci v2 ganda/],
    ['kunci dipakai ulang', { spec: `v3:${v2Enc},v2:${v2Enc}` }, /kunci v2 sama dengan v3/],
  ])('ditolak: %s (tanpa membocorkan kunci)', (_label, input, message) => {
    let err: unknown;
    try {
      parseKeyRing({ specName: 'FIELD_ENCRYPTION_KEYS', legacyName: 'FIELD_ENCRYPTION_KEY', ...input });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(FieldKeyError);
    expect((err as FieldKeyError).code).toBe('FIELD_KEY_CONFIG');
    expect((err as Error).message).toMatch(message);
    expect((err as Error).message).not.toContain(v2Enc);
  });

  it('kunci enkripsi dan kunci hash tidak boleh sama; galat start berawalan "Konfigurasi env tidak valid"', () => {
    expect(() => fieldKeysFromEnv({ FIELD_ENCRYPTION_KEY: v1Enc, FIELD_HASH_KEYS: `v2:${v1Enc}` })).toThrow(
      /tidak boleh sama/,
    );
    expect(() => loadFieldKeys({ FIELD_HASH_KEY: v1Hash })).toThrow(
      /^Konfigurasi env tidak valid → FIELD_ENCRYPTION_KEYS atau FIELD_ENCRYPTION_KEY wajib/,
    );
  });

  it('skema env menerima cincin dan format lama; kosong = tidak disetel; format salah ditolak', () => {
    const schema = envSchemas.fieldCrypto;
    const env = parseEnv(schema, {
      FIELD_ENCRYPTION_KEYS: `v2:${v2Enc},v1:${v1Enc}`,
      FIELD_ENCRYPTION_KEY: '',
      FIELD_HASH_KEY: v1Hash,
    });
    expect(env.FIELD_ENCRYPTION_KEY).toBeUndefined();
    expect(fieldKeysFromEnv(env).enc.ids).toEqual(['v2', 'v1']);
    expect(() => parseEnv(schema, { FIELD_ENCRYPTION_KEYS: 'v2=abc' })).toThrow(/FIELD_ENCRYPTION_KEYS/);
    expect(() => parseEnv(schema, { FIELD_HASH_KEY: 'pendek' })).toThrow(/FIELD_HASH_KEY/);
  });
});

describe('cincin kunci kolom: enkripsi dan blind index', () => {
  const ctx = { tenantId: T, purpose: 'patient_identifier' as const };

  it('data v1 lama tetap terbaca setelah v2 ditambahkan; tulisan baru memakai v2', () => {
    const old = encryptField('9999010101900001', { ...ctx, keyB64: v1Enc });
    expect(fieldKeyId(old)).toBe('v1');
    expect(decryptField(old, { ...ctx, ring: rotating.enc })).toBe('9999010101900001');
    const fresh = encryptField('9999010101900001', { ...ctx, ring: rotating.enc });
    expect(fresh.startsWith('v2.')).toBe(true);
    expect(isCurrentCipher(fresh, rotating.enc)).toBe(true);
    expect(isCurrentCipher(old, rotating.enc)).toBe(false);
    expect(decryptField(fresh, { ...ctx, ring: rotating.enc })).toBe('9999010101900001');
  });

  it('gagal tertutup: kunci dipensiunkan, kunci salah, atau format asing → FieldKeyError tanpa nilai', () => {
    const old = encryptField('9999010101900001', { ...ctx, keyB64: v1Enc });
    const v2Only = parseKeyRing({ spec: `v2:${v2Enc}`, specName: 'FIELD_ENCRYPTION_KEYS', legacyName: 'X' });
    expect(() => decryptField(old, { ...ctx, ring: v2Only })).toThrow(
      expect.objectContaining({ code: 'FIELD_KEY_UNKNOWN', keyId: 'v1' }) as Error,
    );
    expect(() => decryptField(old, { ...ctx, ring: v2Only })).toThrow(
      /Kunci "v1" tidak ada di FIELD_ENCRYPTION_KEYS/,
    );
    const wrong = parseKeyRing({ spec: `v1:${key()}`, specName: 'FIELD_ENCRYPTION_KEYS', legacyName: 'X' });
    let err: unknown;
    try {
      decryptField(old, { ...ctx, ring: wrong });
    } catch (e) {
      err = e;
    }
    expect(err).toMatchObject({ code: 'FIELD_DECRYPT_FAILED', keyId: 'v1' });
    expect((err as Error).message).not.toContain('9999010101900001');
    for (const bad of ['v1.abc', 'v9.a.b.c', 'x1.a.b.c', 'v1.a.b.c.d']) {
      expect(() => decryptField(bad, { ...ctx, ring: rotating.enc })).toThrow(FieldKeyError);
    }
  });

  it('blind index berversi: v1 = 64 hex (sama dengan format lama), v2 = "v2:<hex>"; pencarian memakai semua kunci', () => {
    const legacy = blindIndex('nik:9999010101900001', { ...ctx, hashKeyB64: v1Hash });
    expect(legacy).toMatch(/^[0-9a-f]{64}$/);
    expect(blindIndex('nik:9999010101900001', { ...ctx, ring: rotating.hash, keyId: 'v1' })).toBe(legacy);
    const current = blindIndex('nik:9999010101900001', { ...ctx, ring: rotating.hash });
    expect(current).toMatch(/^v2:[0-9a-f]{64}$/);
    expect(blindIndexes('nik:9999010101900001', { ...ctx, ring: rotating.hash })).toEqual([current, legacy]);
    expect(blindIndexKeyId(legacy)).toBe('v1');
    expect(blindIndexKeyId(current)).toBe('v2');
    expect(blindIndexKeyId(`v1:${legacy}`)).toBeNull();
    expect(blindIndexKeyId('bukan-hash')).toBeNull();
    expect(isCurrentBlindIndex(current, rotating.hash)).toBe(true);
    expect(isCurrentBlindIndex(legacy, rotating.hash)).toBe(false);
    expect(() => blindIndex('x', { ...ctx, ring: rotating.hash, keyId: 'v7' })).toThrow(/Kunci "v7"/);
  });

  it('PatientCrypto: cari dengan semua kunci, tulis dengan kunci aktif; kunci lama format pasangan tetap didukung', () => {
    const before = new PatientCrypto({ encKeyB64: v1Enc, hashKeyB64: v1Hash }, T);
    const during = new PatientCrypto(rotating, T);
    const stored = before.encryptIdentifier('nik', '9999010101900001');
    expect(during.decryptIdentifier(stored.valueEnc)).toBe('9999010101900001');
    expect(during.identifierHashes('nik', '9999010101900001')).toContain(stored.valueHash);
    expect(during.identifierHash('nik', '9999010101900001')).not.toBe(stored.valueHash);
    expect(during.isCurrentHash(stored.valueHash)).toBe(false);
    expect(during.phoneHashes('6281234567890')).toContain(before.phoneHash('6281234567890'));
    const written = during.encryptIdentifier('nik', '9999010101900001');
    expect(during.isCurrentCipher(written.valueEnc) && during.isCurrentHash(written.valueHash)).toBe(true);
    // Setelah kunci lama dipensiunkan, data yang belum dienkripsi ulang tidak terbaca (gagal tertutup).
    const after = new PatientCrypto(
      fieldKeysFromEnv({ FIELD_ENCRYPTION_KEYS: `v2:${v2Enc}`, FIELD_HASH_KEYS: `v2:${v2Hash}` }),
      T,
    );
    expect(() => after.decryptIdentifier(stored.valueEnc)).toThrow(/Kunci "v1"/);
    expect(after.decryptIdentifier(written.valueEnc)).toBe('9999010101900001');
    expect(legacyFieldKeys(v1Enc, v1Hash).enc.currentId).toBe('v1');
  });
});
