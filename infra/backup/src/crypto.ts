/**
 * Enkripsi backup dengan kunci publik (ADR-0071), hanya modul `node:crypto` bawaan:
 * X25519 (kunci efemeral per berkas) → HKDF-SHA256 → AES-256-GCM per potongan 64 KiB (konstruksi STREAM ala `age`:
 * nonce = penghitung 11 byte + bendera potongan terakhir). Host backup hanya memegang kunci PUBLIK, jadi tidak bisa
 * membaca backup yang ia buat; kunci privat disimpan offline (dua pemegang) dan hanya dipakai saat restore.
 *
 * Format berkas: header 65 byte `SIMRSBK1 | versi(1) | id kunci penerima(8) | kunci publik efemeral(32) | garam(16)`,
 * lalu potongan `ciphertext ≤ 64 KiB + tag 16 byte`. Header ikut diikat ke kunci turunan (info HKDF), sehingga header
 * yang diubah = kunci salah = gagal autentikasi. Potongan yang dibuang/ditukar/dipotong juga gagal (penghitung dan
 * bendera terakhir masuk nonce).
 */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  type KeyObject,
  randomBytes,
} from 'node:crypto';
import { Transform, type TransformCallback } from 'node:stream';

export const ENCRYPTION_SCHEME = 'x25519-hkdf-sha256-aes256gcm-stream64k/v1';
export const CHUNK_SIZE = 64 * 1024;
const MAGIC = Buffer.from('SIMRSBK1', 'ascii');
const VERSION = 1;
const TAG_BYTES = 16;
const KEY_ID_BYTES = 8;
const SALT_BYTES = 16;
export const HEADER_BYTES = MAGIC.length + 1 + KEY_ID_BYTES + 32 + SALT_BYTES;
const PUBLIC_KEY_PREFIX = 'simrsbk1:';
const HKDF_INFO = Buffer.from('simrs-backup/v1', 'ascii');

export type BackupCryptoErrorCode =
  'BAD_PUBLIC_KEY' | 'BAD_PRIVATE_KEY' | 'BAD_HEADER' | 'KEY_MISMATCH' | 'DECRYPT_FAILED' | 'TRUNCATED';

export class BackupCryptoError extends Error {
  constructor(
    readonly code: BackupCryptoErrorCode,
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = 'BackupCryptoError';
  }
}

/** Kunci publik penerima (yang dipasang di host backup). */
export interface RecipientKey {
  raw: Buffer;
  key: KeyObject;
  /** 16 karakter hex: 8 byte pertama SHA-256 kunci publik mentah. Tercatat di header dan manifest. */
  id: string;
}

/** Kunci privat (hanya di mesin restore). */
export interface IdentityKey {
  key: KeyObject;
  publicRaw: Buffer;
  id: string;
}

export function keyIdOf(publicRaw: Buffer): string {
  return createHash('sha256').update(publicRaw).digest().subarray(0, KEY_ID_BYTES).toString('hex');
}

function rawPublicKey(key: KeyObject): Buffer {
  const jwk = key.export({ format: 'jwk' });
  if (jwk.kty !== 'OKP' || jwk.crv !== 'X25519' || typeof jwk.x !== 'string') {
    throw new BackupCryptoError('BAD_PUBLIC_KEY', 'bukan kunci X25519');
  }
  return Buffer.from(jwk.x, 'base64url');
}

function publicKeyFromRaw(raw: Buffer): KeyObject {
  return createPublicKey({ key: { kty: 'OKP', crv: 'X25519', x: raw.toString('base64url') }, format: 'jwk' });
}

export function formatPublicKey(raw: Buffer): string {
  return `${PUBLIC_KEY_PREFIX}${raw.toString('base64url')}`;
}

/** `simrsbk1:<43 karakter base64url>` → kunci penerima. */
export function parsePublicKey(text: string): RecipientKey {
  const value = text.trim();
  if (!value.startsWith(PUBLIC_KEY_PREFIX)) {
    throw new BackupCryptoError('BAD_PUBLIC_KEY', `kunci publik harus berawalan ${PUBLIC_KEY_PREFIX}`);
  }
  const body = value.slice(PUBLIC_KEY_PREFIX.length);
  if (!/^[A-Za-z0-9_-]{43}$/.test(body)) {
    throw new BackupCryptoError('BAD_PUBLIC_KEY', 'panjang kunci publik tidak valid (32 byte base64url)');
  }
  const raw = Buffer.from(body, 'base64url');
  try {
    return { raw, key: publicKeyFromRaw(raw), id: keyIdOf(raw) };
  } catch (err) {
    throw new BackupCryptoError('BAD_PUBLIC_KEY', (err as Error).message);
  }
}

/** Kunci privat PEM (PKCS#8), boleh terenkripsi frasa sandi (dua pemegang: berkas + frasa). */
export function loadPrivateKey(pem: string, passphrase?: string): IdentityKey {
  let key: KeyObject;
  try {
    key = createPrivateKey(
      passphrase ? { key: pem, format: 'pem', passphrase } : { key: pem, format: 'pem' },
    );
  } catch (err) {
    const msg = (err as Error).message;
    throw new BackupCryptoError(
      'BAD_PRIVATE_KEY',
      /passphrase|decrypt/i.test(msg)
        ? 'frasa sandi kunci privat salah atau tidak diberikan'
        : 'berkas kunci privat tidak valid',
    );
  }
  if (key.asymmetricKeyType !== 'x25519') {
    throw new BackupCryptoError('BAD_PRIVATE_KEY', 'kunci privat bukan X25519');
  }
  const publicRaw = rawPublicKey(createPublicKey(key));
  return { key, publicRaw, id: keyIdOf(publicRaw) };
}

export interface GeneratedKeyPair {
  publicKey: string;
  privateKeyPem: string;
  keyId: string;
}

export function generateBackupKeyPair(passphrase?: string): GeneratedKeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('x25519');
  const raw = rawPublicKey(publicKey);
  const privateKeyPem = passphrase
    ? privateKey.export({ format: 'pem', type: 'pkcs8', cipher: 'aes-256-cbc', passphrase })
    : privateKey.export({ format: 'pem', type: 'pkcs8' });
  return { publicKey: formatPublicKey(raw), privateKeyPem: privateKeyPem.toString(), keyId: keyIdOf(raw) };
}

function deriveKey(shared: Buffer, salt: Buffer, header: Buffer, recipientRaw: Buffer): Buffer {
  if (shared.every((b) => b === 0)) {
    // Titik berorde kecil pada kurva: hasil ECDH nol tidak boleh dipakai sebagai kunci.
    throw new BackupCryptoError('BAD_HEADER', 'kunci efemeral tidak valid');
  }
  return Buffer.from(hkdfSync('sha256', shared, salt, Buffer.concat([HKDF_INFO, header, recipientRaw]), 32));
}

function nonce(counter: bigint, final: boolean): Buffer {
  const n = Buffer.alloc(12);
  n.writeBigUInt64BE(counter, 3);
  n[11] = final ? 1 : 0;
  return n;
}

/** Id kunci penerima dari header berkas terenkripsi (tanpa mendekripsi). */
export function headerKeyId(header: Buffer): string {
  if (header.length < HEADER_BYTES || !header.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new BackupCryptoError('BAD_HEADER', 'bukan berkas backup SIM RS');
  }
  if (header[MAGIC.length] !== VERSION) {
    throw new BackupCryptoError('BAD_HEADER', `versi format ${header[MAGIC.length]} tidak dikenal`);
  }
  return header.subarray(MAGIC.length + 1, MAGIC.length + 1 + KEY_ID_BYTES).toString('hex');
}

/** Transform: plaintext → header + potongan terenkripsi. */
export function createEncryptStream(recipient: RecipientKey): Transform {
  const eph = generateKeyPairSync('x25519');
  const ephRaw = rawPublicKey(eph.publicKey);
  const salt = randomBytes(SALT_BYTES);
  const header = Buffer.concat([
    MAGIC,
    Buffer.from([VERSION]),
    Buffer.from(recipient.id, 'hex'),
    ephRaw,
    salt,
  ]);
  const key = deriveKey(
    diffieHellman({ privateKey: eph.privateKey, publicKey: recipient.key }),
    salt,
    header,
    recipient.raw,
  );
  let counter = 0n;
  let pending: Buffer = Buffer.alloc(0);
  const seal = (plain: Buffer, final: boolean): Buffer => {
    const cipher = createCipheriv('aes-256-gcm', key, nonce(counter, final));
    counter += 1n;
    return Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
  };
  let headerSent = false;
  const sendHeader = (t: Transform) => {
    if (!headerSent) {
      t.push(header);
      headerSent = true;
    }
  };
  return new Transform({
    transform(chunk: Buffer, _enc, done: TransformCallback) {
      sendHeader(this);
      pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
      // Potongan hanya dilepas bila SESUDAHNYA masih ada data: potongan terakhir selalu ditandai final di flush.
      while (pending.length > CHUNK_SIZE) {
        this.push(seal(pending.subarray(0, CHUNK_SIZE), false));
        pending = pending.subarray(CHUNK_SIZE);
      }
      done();
    },
    flush(done: TransformCallback) {
      sendHeader(this);
      this.push(seal(pending, true));
      pending = Buffer.alloc(0);
      done();
    },
  });
}

/**
 * Transform: berkas terenkripsi → plaintext. Kunci salah ditolak dari header (KEY_MISMATCH) sebelum satu byte pun
 * dikeluarkan; setiap potongan diautentikasi sebelum dilepas.
 */
export function createDecryptStream(identity: IdentityKey): Transform {
  let header: Buffer | null = null;
  let key: Buffer | null = null;
  let counter = 0n;
  let pending: Buffer = Buffer.alloc(0);
  const sealed = CHUNK_SIZE + TAG_BYTES;
  const open = (box: Buffer, final: boolean): Buffer => {
    if (!key) throw new BackupCryptoError('BAD_HEADER', 'header belum terbaca');
    const decipher = createDecipheriv('aes-256-gcm', key, nonce(counter, final));
    decipher.setAuthTag(box.subarray(box.length - TAG_BYTES));
    counter += 1n;
    try {
      return Buffer.concat([decipher.update(box.subarray(0, box.length - TAG_BYTES)), decipher.final()]);
    } catch {
      throw new BackupCryptoError(
        'DECRYPT_FAILED',
        'autentikasi potongan gagal (berkas rusak/diubah atau kunci salah)',
      );
    }
  };
  const readHeader = () => {
    if (header || pending.length < HEADER_BYTES) return;
    const h = pending.subarray(0, HEADER_BYTES);
    const id = headerKeyId(h);
    if (id !== identity.id) {
      throw new BackupCryptoError(
        'KEY_MISMATCH',
        `berkas dienkripsi untuk kunci ${id}, kunci privat yang diberikan ${identity.id}`,
      );
    }
    const ephRaw = h.subarray(MAGIC.length + 1 + KEY_ID_BYTES, MAGIC.length + 1 + KEY_ID_BYTES + 32);
    const salt = h.subarray(HEADER_BYTES - SALT_BYTES, HEADER_BYTES);
    let shared: Buffer;
    try {
      shared = diffieHellman({ privateKey: identity.key, publicKey: publicKeyFromRaw(Buffer.from(ephRaw)) });
    } catch {
      throw new BackupCryptoError('BAD_HEADER', 'kunci efemeral tidak valid');
    }
    header = Buffer.from(h);
    key = deriveKey(shared, Buffer.from(salt), header, identity.publicRaw);
    pending = pending.subarray(HEADER_BYTES);
  };
  return new Transform({
    transform(chunk: Buffer, _enc, done: TransformCallback) {
      try {
        pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
        readHeader();
        if (header) {
          while (pending.length > sealed) {
            this.push(open(pending.subarray(0, sealed), false));
            pending = pending.subarray(sealed);
          }
        }
        done();
      } catch (err) {
        done(err as Error);
      }
    },
    flush(done: TransformCallback) {
      try {
        readHeader();
        if (!header) throw new BackupCryptoError('TRUNCATED', 'berkas lebih pendek dari header');
        if (pending.length < TAG_BYTES) throw new BackupCryptoError('TRUNCATED', 'potongan terakhir hilang');
        this.push(open(pending, true));
        pending = Buffer.alloc(0);
        done();
      } catch (err) {
        done(err as Error);
      }
    },
  });
}
