import { createHmac, timingSafeEqual } from 'node:crypto';

/** Toleransi umur webhook TPDI (docs/07 §2). */
export const TPDI_WEBHOOK_MAX_AGE_MS = 5 * 60_000;

/** `X-TPDI-Signature` = hex(HMAC-SHA256(timestamp + "." + body, secret)). */
export function tpdiSignature(timestamp: string, rawBody: string, secret: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
}

export type TpdiVerifyResult =
  { ok: true } | { ok: false; reason: 'SIGNATURE_INVALID' | 'TIMESTAMP_EXPIRED' };

/** Timestamp boleh ISO 8601 atau detik epoch. */
export function verifyTpdiWebhook(
  input: { timestamp: string; signature: string; rawBody: string; secret: string },
  now: Date = new Date(),
): TpdiVerifyResult {
  const tsMs = /^\d+$/.test(input.timestamp) ? Number(input.timestamp) * 1000 : Date.parse(input.timestamp);
  if (!Number.isFinite(tsMs) || Math.abs(now.getTime() - tsMs) > TPDI_WEBHOOK_MAX_AGE_MS) {
    return { ok: false, reason: 'TIMESTAMP_EXPIRED' };
  }
  const expected = Buffer.from(tpdiSignature(input.timestamp, input.rawBody, input.secret), 'hex');
  const given = Buffer.from(input.signature, 'hex');
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return { ok: false, reason: 'SIGNATURE_INVALID' };
  }
  return { ok: true };
}
