import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * S01 · Tanda tangan HMAC perangkat analyzer (rencana fase 4 §4.0a/§4.1a), pola `tpdi-signature`:
 * `X-Device-Signature` = hex(HMAC-SHA256(timestamp + "." + body, kunci perangkat)), timestamp ≤ 5 menit.
 */
export const LIS_SIGNATURE_MAX_AGE_MS = 5 * 60_000;
export const LIS_SIGNATURE_HEADER = 'x-device-signature';
export const LIS_TIMESTAMP_HEADER = 'x-device-timestamp';

export function lisSignature(timestamp: string, rawBody: string, secret: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
}

export type LisVerifyResult = { ok: true } | { ok: false; reason: 'SIGNATURE_INVALID' | 'TIMESTAMP_EXPIRED' };

/** Timestamp boleh ISO 8601 atau detik epoch. Perbandingan waktu-konstan. */
export function verifyLisSignature(
  input: { timestamp: string; signature: string; rawBody: string; secret: string },
  now: Date = new Date(),
): LisVerifyResult {
  const tsMs = /^\d+$/.test(input.timestamp) ? Number(input.timestamp) * 1000 : Date.parse(input.timestamp);
  if (!Number.isFinite(tsMs) || Math.abs(now.getTime() - tsMs) > LIS_SIGNATURE_MAX_AGE_MS) {
    return { ok: false, reason: 'TIMESTAMP_EXPIRED' };
  }
  if (!/^[0-9a-f]{64}$/i.test(input.signature)) return { ok: false, reason: 'SIGNATURE_INVALID' };
  const expected = Buffer.from(lisSignature(input.timestamp, input.rawBody, input.secret), 'hex');
  const given = Buffer.from(input.signature, 'hex');
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return { ok: false, reason: 'SIGNATURE_INVALID' };
  }
  return { ok: true };
}
