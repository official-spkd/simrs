import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes } from 'node:crypto';

/**
 * Enkripsi kolom sensitif (rahasia MFA, NIK, no. BPJS, no. HP) — docs/04 §1.
 * AES-256-GCM dengan kunci turunan per tenant × tujuan (HKDF dari FIELD_ENCRYPTION_KEY), sehingga bocornya data
 * satu tenant tidak memudahkan dekripsi tenant lain, dan konteks (tenant + tujuan) diikat sebagai AAD.
 * Format tersimpan: `v1.<iv>.<ciphertext>.<tag>` (base64url).
 */
export type FieldPurpose = 'mfa_secret' | 'patient_identifier' | 'contact' | 'patient_snapshot';

function masterKey(keyB64: string): Buffer {
  const key = Buffer.from(keyB64, 'base64');
  if (key.length !== 32) throw new Error('FIELD_ENCRYPTION_KEY harus 32 byte (base64)');
  return key;
}

function deriveKey(keyB64: string, tenantId: string, purpose: FieldPurpose): Buffer {
  return Buffer.from(hkdfSync('sha256', masterKey(keyB64), Buffer.from(tenantId), `simrs:${purpose}:v1`, 32));
}

const aad = (tenantId: string, purpose: FieldPurpose) => Buffer.from(`${tenantId}|${purpose}`);

export function encryptField(
  plain: string,
  ctx: { keyB64: string; tenantId: string; purpose: FieldPurpose },
): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(ctx.keyB64, ctx.tenantId, ctx.purpose), iv);
  cipher.setAAD(aad(ctx.tenantId, ctx.purpose));
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv, enc, cipher.getAuthTag()]
    .map((p) => (typeof p === 'string' ? p : p.toString('base64url')))
    .join('.');
}

/** Melempar bila data diubah, kunci salah, atau dipindahkan ke tenant/tujuan lain (tag GCM gagal). */
export function decryptField(
  stored: string,
  ctx: { keyB64: string; tenantId: string; purpose: FieldPurpose },
): string {
  const [version, iv, enc, tag] = stored.split('.');
  if (version !== 'v1' || !iv || enc === undefined || !tag)
    throw new Error('Format data terenkripsi tidak dikenal');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    deriveKey(ctx.keyB64, ctx.tenantId, ctx.purpose),
    Buffer.from(iv, 'base64url'),
  );
  decipher.setAAD(aad(ctx.tenantId, ctx.purpose));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(enc, 'base64url')), decipher.final()]).toString('utf8');
}

/**
 * Hash untuk pencarian sama-persis (mis. NIK) tanpa menyimpan nilai: HMAC-SHA256 dengan FIELD_HASH_KEY per tenant.
 * Nilai dinormalisasi lebih dulu oleh pemanggil (mis. hanya digit).
 */
export function blindIndex(
  value: string,
  ctx: { hashKeyB64: string; tenantId: string; purpose: FieldPurpose },
): string {
  const key = Buffer.from(ctx.hashKeyB64, 'base64');
  if (key.length < 32) throw new Error('FIELD_HASH_KEY minimal 32 byte (base64)');
  return createHmac('sha256', key).update(`${ctx.tenantId}|${ctx.purpose}|${value}`).digest('hex');
}

/** Token acak 256 bit (base64url) untuk sesi/tantangan; simpan hanya `hashToken(token)`. */
export function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
