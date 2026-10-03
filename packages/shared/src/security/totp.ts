import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** TOTP RFC 6238 (HMAC-SHA1, 6 digit, langkah 30 detik) — kompatibel Google Authenticator, Microsoft Authenticator, dll. */
export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[\s=-]/g, '');
  if (!/^[A-Z2-7]+$/.test(clean)) throw new RangeError('Base32 tidak valid');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | BASE32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Rahasia baru 160 bit (panjang yang direkomendasikan RFC 4226). */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function totpStep(at: Date = new Date()): number {
  return Math.floor(at.getTime() / 1000 / TOTP_STEP_SECONDS);
}

/** Kode HOTP untuk satu langkah waktu (RFC 4226 §5.3). */
export function totpCode(secret: Buffer, step: number, digits = TOTP_DIGITS): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', secret).update(counter).digest();
  const offset = (mac[mac.length - 1] ?? 0) & 0x0f;
  const binary = (mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return binary.toString().padStart(digits, '0');
}

export interface TotpVerifyResult {
  ok: boolean;
  /** Langkah yang cocok; disimpan agar kode yang sama tidak bisa dipakai ulang. */
  step?: number;
}

/**
 * Verifikasi kode dengan toleransi ±1 langkah (selisih jam perangkat). Kode untuk langkah ≤ `lastUsedStep`
 * ditolak (anti-replay): satu kode hanya sekali pakai.
 */
export function verifyTotp(
  secretBase32: string,
  code: string,
  opts: { at?: Date; lastUsedStep?: number | null; window?: number } = {},
): TotpVerifyResult {
  if (!/^\d{6}$/.test(code)) return { ok: false };
  const secret = base32Decode(secretBase32);
  const now = totpStep(opts.at);
  const window = opts.window ?? 1;
  const given = Buffer.from(code);
  let match: number | undefined;
  // Periksa semua kandidat (tanpa berhenti di awal) agar waktu tidak membocorkan langkah yang cocok.
  for (let d = -window; d <= window; d++) {
    const step = now + d;
    const expected = Buffer.from(totpCode(secret, step));
    if (timingSafeEqual(expected, given) && match === undefined) match = step;
  }
  if (match === undefined) return { ok: false };
  if (opts.lastUsedStep !== undefined && opts.lastUsedStep !== null && match <= opts.lastUsedStep) {
    return { ok: false };
  }
  return { ok: true, step: match };
}

/** URI untuk aplikasi autentikator (bisa dijadikan QR). Label tanpa data sensitif selain nama akun. */
export function totpUri(secretBase32: string, account: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
