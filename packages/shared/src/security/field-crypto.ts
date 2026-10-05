import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes } from 'node:crypto';
import { FIELD_KEY_ID, FieldKeyError, type KeyRing, LEGACY_KEY_ID, legacyKeyRing } from './field-keys';

/**
 * Enkripsi kolom sensitif (rahasia MFA, NIK, no. BPJS, no. HP) — docs/04 §1.
 * AES-256-GCM dengan kunci turunan per tenant × tujuan (HKDF dari kunci kolom), sehingga bocornya data
 * satu tenant tidak memudahkan dekripsi tenant lain, dan konteks (tenant + tujuan) diikat sebagai AAD.
 * Format tersimpan: `<ID kunci>.<iv>.<ciphertext>.<tag>` (base64url), mis. `v1.…` atau `v2.…`. Dekripsi memilih
 * kunci dari awalan; enkripsi selalu memakai kunci aktif cincin (ADR-0015, pembaruan 5 Okt 2026).
 */
export type FieldPurpose =
  | 'mfa_secret'
  | 'patient_identifier'
  | 'contact'
  | 'patient_snapshot'
  /** No. HP staf (WhatsApp notifikasi, kode cadangan login). */
  | 'staff_phone'
  /** Kode cadangan login sekali pakai (WhatsApp/email), berlaku selama tantangan MFA. */
  | 'login_otp'
  /** Lada (HMAC) PIN masuk cepat sebelum argon2id: hash PIN yang bocor tidak bisa ditebak tanpa kunci. */
  | 'login_pin'
  /** Kode pendaftaran perangkat anjungan/TV sekali pakai (ADR-0027): dicari lewat HMAC, tidak disimpan. */
  | 'device_enrolment';

/**
 * Sumber kunci enkripsi: cincin (`ring`, dari env lewat `fieldKeysFromEnv`) atau satu kunci format lama
 * (`keyB64` = kunci `v1`; tes dan alat lama).
 */
export type EncKeySource = { ring: KeyRing; keyB64?: never } | { keyB64: string; ring?: never };
/** Sumber kunci blind index; `keyId` memilih kunci tertentu (bawaan: kunci aktif). */
export type HashKeySource =
  { ring: KeyRing; keyId?: string; hashKeyB64?: never } | { hashKeyB64: string; ring?: never; keyId?: never };

export interface FieldContext {
  tenantId: string;
  purpose: FieldPurpose;
}

const encRing = (src: EncKeySource): KeyRing => src.ring ?? legacyKeyRing(src.keyB64, 'FIELD_ENCRYPTION_KEY');
const hashRing = (src: HashKeySource): KeyRing => src.ring ?? legacyKeyRing(src.hashKeyB64, 'FIELD_HASH_KEY');

/** Kunci turunan HKDF per kunci × tenant × tujuan (di-cache; jumlahnya kecil dan tetap). */
const derived = new WeakMap<Buffer, Map<string, Buffer>>();
function deriveKey(master: Buffer, tenantId: string, purpose: FieldPurpose): Buffer {
  let perKey = derived.get(master);
  if (!perKey) {
    perKey = new Map();
    derived.set(master, perKey);
  }
  const id = `${tenantId}|${purpose}`;
  let key = perKey.get(id);
  if (!key) {
    key = Buffer.from(hkdfSync('sha256', master, Buffer.from(tenantId), `simrs:${purpose}:v1`, 32));
    perKey.set(id, key);
  }
  return key;
}

const aad = (tenantId: string, purpose: FieldPurpose) => Buffer.from(`${tenantId}|${purpose}`);

/** ID kunci dari ciphertext tersimpan (`v2.…` → `v2`), atau null bila formatnya tidak dikenal. */
export function fieldKeyId(stored: string): string | null {
  const id = stored.slice(0, stored.indexOf('.'));
  return FIELD_KEY_ID.test(id) ? id : null;
}

/** Enkripsi dengan kunci aktif cincin (atau kunci `v1` bila memakai `keyB64`). */
export function encryptField(plain: string, ctx: FieldContext & EncKeySource): string {
  const ring = encRing(ctx);
  const keyId = ring.currentId;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(ring.key(keyId), ctx.tenantId, ctx.purpose), iv);
  cipher.setAAD(aad(ctx.tenantId, ctx.purpose));
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [
    keyId,
    iv.toString('base64url'),
    enc.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
  ].join('.');
}

/**
 * Dekripsi dengan kunci sesuai awalan. Melempar `FieldKeyError` bila format tidak dikenal, ID kunci tidak ada di
 * cincin, atau data diubah / kunci salah / dipindahkan ke tenant atau tujuan lain (tag GCM gagal).
 */
export function decryptField(stored: string, ctx: FieldContext & EncKeySource): string {
  const ring = encRing(ctx);
  const [keyId, iv, enc, tag, extra] = stored.split('.');
  if (!keyId || !FIELD_KEY_ID.test(keyId) || !iv || enc === undefined || !tag || extra !== undefined) {
    throw new FieldKeyError('FIELD_FORMAT', 'Format data terenkripsi tidak dikenal');
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    deriveKey(ring.key(keyId), ctx.tenantId, ctx.purpose),
    Buffer.from(iv, 'base64url'),
  );
  decipher.setAAD(aad(ctx.tenantId, ctx.purpose));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  try {
    return Buffer.concat([decipher.update(Buffer.from(enc, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    throw new FieldKeyError(
      'FIELD_DECRYPT_FAILED',
      `Dekripsi gagal dengan kunci ${keyId} (kunci salah, data rusak, atau konteks tenant/tujuan berbeda)`,
      keyId,
    );
  }
}

/** Ciphertext ini sudah memakai kunci aktif cincin. */
export const isCurrentCipher = (stored: string, ring: KeyRing): boolean =>
  fieldKeyId(stored) === ring.currentId;

const HASH_PATTERN = /^(?:(v[1-9][0-9]{0,2}):)?([0-9a-f]{64})$/;

/** ID kunci dari blind index tersimpan: tanpa awalan = `v1` (format lama), `v2:…` = `v2`; null bila tidak dikenal. */
export function blindIndexKeyId(stored: string): string | null {
  const m = HASH_PATTERN.exec(stored);
  if (!m) return null;
  const id = m[1] ?? LEGACY_KEY_ID;
  // `v1:` tidak pernah ditulis (hash v1 selalu tanpa awalan); tolak agar satu nilai punya satu bentuk.
  return m[1] === LEGACY_KEY_ID ? null : id;
}

/** Blind index ini sudah memakai kunci hash aktif. */
export const isCurrentBlindIndex = (stored: string, ring: KeyRing): boolean =>
  blindIndexKeyId(stored) === ring.currentId;

/**
 * Hash untuk pencarian sama-persis (mis. NIK) tanpa menyimpan nilai: HMAC-SHA256 per tenant × tujuan.
 * Nilai dinormalisasi lebih dulu oleh pemanggil (mis. hanya digit). Bentuk tersimpan berversi: kunci `v1` →
 * 64 hex (sama dengan format lama), kunci lain → `<ID>:<64 hex>`.
 */
export function blindIndex(value: string, ctx: FieldContext & HashKeySource): string {
  const ring = hashRing(ctx);
  const keyId = ctx.keyId ?? ring.currentId;
  const hex = createHmac('sha256', ring.key(keyId))
    .update(`${ctx.tenantId}|${ctx.purpose}|${value}`)
    .digest('hex');
  return keyId === LEGACY_KEY_ID ? hex : `${keyId}:${hex}`;
}

/**
 * Blind index nilai ini untuk SEMUA kunci di cincin (kunci aktif lebih dulu). Pencarian dan pengecekan duplikat
 * memakai ini agar baris yang belum dienkripsi ulang tetap ditemukan selama rotasi.
 */
export function blindIndexes(value: string, ctx: FieldContext & { ring: KeyRing }): string[] {
  return ctx.ring.ids.map((keyId) => blindIndex(value, { ...ctx, keyId }));
}

/** Token acak 256 bit (base64url) untuk sesi/tantangan; simpan hanya `hashToken(token)`. */
export function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
