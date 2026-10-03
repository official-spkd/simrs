import { createCipheriv, createDecipheriv, createHash, createHmac, timingSafeEqual } from 'node:crypto';
import LZString from 'lz-string';

/**
 * Rangkuman skema keamanan BPJS (VClaim/Antrean v2) untuk mock dan konektor.
 * Cocokkan dengan dokumen resmi BPJS sebelum integrasi nyata (docs/06-integrasi.md).
 */
export interface BpjsCredentials {
  consId: string;
  secretKey: string;
}

/** Detik UTC sejak epoch, sebagai string (header `X-timestamp`). */
export function bpjsTimestamp(now: Date = new Date()): string {
  return Math.floor(now.getTime() / 1000).toString();
}

/** `X-signature` = Base64(HMAC-SHA256(`consId&timestamp`, secretKey)). */
export function bpjsSignature(creds: BpjsCredentials, timestamp: string): string {
  return createHmac('sha256', creds.secretKey).update(`${creds.consId}&${timestamp}`).digest('base64');
}

export function verifyBpjsSignature(creds: BpjsCredentials, timestamp: string, signature: string): boolean {
  const expected = Buffer.from(bpjsSignature(creds, timestamp));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function bpjsHeaders(
  creds: BpjsCredentials & { userKey: string },
  now?: Date,
): Record<string, string> {
  const ts = bpjsTimestamp(now);
  return {
    'X-cons-id': creds.consId,
    'X-timestamp': ts,
    'X-signature': bpjsSignature(creds, ts),
    user_key: creds.userKey,
  };
}

function keyAndIv(creds: BpjsCredentials, timestamp: string): { key: Buffer; iv: Buffer } {
  const key = createHash('sha256').update(`${creds.consId}${creds.secretKey}${timestamp}`).digest();
  return { key, iv: key.subarray(0, 16) };
}

/** Enkripsi respons: LZ-string (encoded URI component) → AES-256-CBC → Base64. Dipakai mock. */
export function bpjsEncryptResponse(data: unknown, creds: BpjsCredentials, timestamp: string): string {
  const compressed = LZString.compressToEncodedURIComponent(JSON.stringify(data));
  const { key, iv } = keyAndIv(creds, timestamp);
  const cipher = createCipheriv('aes-256-cbc', key, iv);
  return Buffer.concat([cipher.update(compressed, 'utf8'), cipher.final()]).toString('base64');
}

/** Kebalikan dari `bpjsEncryptResponse`. Dipakai konektor. */
export function bpjsDecryptResponse<T = unknown>(
  payload: string,
  creds: BpjsCredentials,
  timestamp: string,
): T {
  const { key, iv } = keyAndIv(creds, timestamp);
  const decipher = createDecipheriv('aes-256-cbc', key, iv);
  const compressed = Buffer.concat([decipher.update(payload, 'base64'), decipher.final()]).toString('utf8');
  const json = LZString.decompressFromEncodedURIComponent(compressed);
  if (json === null || json === '') throw new Error('Respons BPJS tidak bisa didekompresi');
  return JSON.parse(json) as T;
}
