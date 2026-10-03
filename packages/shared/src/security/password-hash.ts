import { argon2, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Hash kata sandi argon2id memakai implementasi bawaan Node (≥ 24.7), tanpa dependensi native tambahan.
 * Parameter bawaan mengikuti rekomendasi OWASP (m = 19 MiB, t = 2, p = 1). Format tersimpan standar PHC:
 * `$argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>` sehingga parameter bisa dinaikkan tanpa merusak hash lama.
 */
export interface Argon2Params {
  memoryKiB: number;
  passes: number;
  parallelism: number;
}

export const DEFAULT_ARGON2: Argon2Params = { memoryKiB: 19_456, passes: 2, parallelism: 1 };
const TAG_LENGTH = 32;
const SALT_LENGTH = 16;

const b64 = (buf: Buffer) => buf.toString('base64').replace(/=+$/, '');
const fromB64 = (s: string) => Buffer.from(s, 'base64');

function derive(password: string, salt: Buffer, p: Argon2Params): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    argon2(
      'argon2id',
      {
        message: password,
        nonce: salt,
        parallelism: p.parallelism,
        tagLength: TAG_LENGTH,
        memory: p.memoryKiB,
        passes: p.passes,
      },
      (err, key) => (err ? reject(err) : resolve(key)),
    );
  });
}

export async function hashPassword(password: string, params: Argon2Params = DEFAULT_ARGON2): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const tag = await derive(password, salt, params);
  return `$argon2id$v=19$m=${params.memoryKiB},t=${params.passes},p=${params.parallelism}$${b64(salt)}$${b64(tag)}`;
}

const PHC =
  /^\$argon2id\$v=19\$m=(\d{4,7}),t=(\d{1,2}),p=(\d{1,2})\$([A-Za-z0-9+/]{16,})\$([A-Za-z0-9+/]{32,})$/;

/** Verifikasi waktu-konstan. Hash yang rusak/format asing → false (bukan melempar). */
export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const m = PHC.exec(encoded);
  if (!m) return false;
  const params = { memoryKiB: Number(m[1]), passes: Number(m[2]), parallelism: Number(m[3]) };
  const expected = fromB64(m[5] ?? '');
  const actual = await derive(password, fromB64(m[4] ?? ''), params);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** True bila hash memakai parameter lebih lemah dari bawaan saat ini (perlu di-hash ulang saat login berhasil). */
export function needsRehash(encoded: string, params: Argon2Params = DEFAULT_ARGON2): boolean {
  const m = PHC.exec(encoded);
  if (!m) return true;
  return Number(m[1]) < params.memoryKiB || Number(m[2]) < params.passes;
}

/**
 * Hash tiruan untuk menyamakan waktu respons saat pengguna tidak ditemukan
 * (mencegah enumerasi akun lewat perbedaan waktu).
 */
let dummyHash: Promise<string> | undefined;
export function dummyPasswordHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(24).toString('base64'));
  return dummyHash;
}
