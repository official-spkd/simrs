import { randomBytes } from 'node:crypto';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { describe, expect, it } from 'vitest';
import {
  BackupCryptoError,
  CHUNK_SIZE,
  createDecryptStream,
  createEncryptStream,
  generateBackupKeyPair,
  HEADER_BYTES,
  headerKeyId,
  loadPrivateKey,
  parsePublicKey,
} from '../src/crypto';

function sink(parts: Buffer[]): Writable {
  return new Writable({
    write(chunk: Buffer, _enc, done) {
      parts.push(chunk);
      done();
    },
  });
}

async function collect(source: NodeJS.ReadableStream, ...stages: NodeJS.ReadWriteStream[]): Promise<Buffer> {
  const parts: Buffer[] = [];
  await pipeline([source, ...stages, sink(parts)]);
  return Buffer.concat(parts);
}

/** Pecah buffer jadi potongan acak agar batas potongan enkripsi tidak sejajar dengan batas tulis. */
function chunked(buf: Buffer): Readable {
  const parts: Buffer[] = [];
  for (let i = 0; i < buf.length;) {
    const n = Math.min(buf.length - i, 1 + Math.floor(Math.random() * 40_000));
    parts.push(buf.subarray(i, i + n));
    i += n;
  }
  return Readable.from(parts);
}

const pair = generateBackupKeyPair();
const recipient = parsePublicKey(pair.publicKey);
const identity = loadPrivateKey(pair.privateKeyPem);

const encrypt = (plain: Buffer) => collect(chunked(plain), createEncryptStream(recipient));
const decrypt = (sealed: Buffer, id = identity) => collect(chunked(sealed), createDecryptStream(id));

describe('enkripsi backup X25519 + AES-256-GCM berpotongan', () => {
  it.each([0, 1, CHUNK_SIZE - 1, CHUNK_SIZE, CHUNK_SIZE + 1, 3 * CHUNK_SIZE + 17])(
    'bolak-balik %i byte',
    async (size) => {
      const plain = randomBytes(size);
      const sealed = await encrypt(plain);
      const potongan = Math.max(1, Math.ceil(size / CHUNK_SIZE));
      expect(sealed.length).toBe(HEADER_BYTES + size + 16 * potongan);
      expect(await decrypt(sealed)).toEqual(plain);
    },
  );

  it('dua enkripsi isi yang sama berbeda (kunci efemeral + garam per berkas)', async () => {
    const plain = Buffer.from('sama');
    const [a, b] = [await encrypt(plain), await encrypt(plain)];
    expect(a.equals(b)).toBe(false);
  });

  it('id kunci penerima tercatat di header dan cocok dengan kunci privat', async () => {
    const sealed = await encrypt(Buffer.from('x'));
    expect(headerKeyId(sealed.subarray(0, HEADER_BYTES))).toBe(recipient.id);
    expect(identity.id).toBe(recipient.id);
  });

  it('kunci privat lain → KEY_MISMATCH tanpa mengeluarkan satu byte pun', async () => {
    const other = loadPrivateKey(generateBackupKeyPair().privateKeyPem);
    const sealed = await encrypt(randomBytes(CHUNK_SIZE * 2));
    const out: Buffer[] = [];
    const err = await pipeline(chunked(sealed), createDecryptStream(other), sink(out)).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(BackupCryptoError);
    expect((err as BackupCryptoError).code).toBe('KEY_MISMATCH');
    expect(out).toHaveLength(0);
  });

  it('header dipalsukan agar id cocok tetap gagal autentikasi', async () => {
    const other = generateBackupKeyPair();
    const sealedForOther = await collect(
      chunked(randomBytes(100)),
      createEncryptStream(parsePublicKey(other.publicKey)),
    );
    // Tulis id kunci kita ke header berkas milik kunci lain.
    Buffer.from(identity.id, 'hex').copy(sealedForOther, 9);
    await expect(decrypt(sealedForOther)).rejects.toMatchObject({ code: 'DECRYPT_FAILED' });
  });

  it('satu bit berubah di tengah → DECRYPT_FAILED', async () => {
    const sealed = await encrypt(randomBytes(CHUNK_SIZE + 500));
    sealed[HEADER_BYTES + 1000] = (sealed[HEADER_BYTES + 1000] ?? 0) ^ 1;
    await expect(decrypt(sealed)).rejects.toMatchObject({ code: 'DECRYPT_FAILED' });
  });

  it('potongan terakhir dibuang atau berkas terpotong → gagal', async () => {
    const sealed = await encrypt(randomBytes(CHUNK_SIZE * 2 + 10));
    const withoutLast = sealed.subarray(0, HEADER_BYTES + 2 * (CHUNK_SIZE + 16));
    await expect(decrypt(withoutLast)).rejects.toBeInstanceOf(BackupCryptoError);
    await expect(decrypt(sealed.subarray(0, sealed.length - 5))).rejects.toBeInstanceOf(BackupCryptoError);
    await expect(decrypt(sealed.subarray(0, 20))).rejects.toMatchObject({ code: 'TRUNCATED' });
  });

  it('urutan potongan ditukar → DECRYPT_FAILED', async () => {
    const sealed = await encrypt(randomBytes(CHUNK_SIZE * 3));
    const box = CHUNK_SIZE + 16;
    const a = sealed.subarray(HEADER_BYTES, HEADER_BYTES + box);
    const b = sealed.subarray(HEADER_BYTES + box, HEADER_BYTES + 2 * box);
    const swapped = Buffer.concat([
      sealed.subarray(0, HEADER_BYTES),
      b,
      a,
      sealed.subarray(HEADER_BYTES + 2 * box),
    ]);
    await expect(decrypt(swapped)).rejects.toMatchObject({ code: 'DECRYPT_FAILED' });
  });

  it('bukan berkas backup → BAD_HEADER', async () => {
    await expect(decrypt(randomBytes(200))).rejects.toMatchObject({ code: 'BAD_HEADER' });
  });

  it('kunci privat berfrasa sandi: tanpa/salah frasa ditolak, frasa benar bisa mendekripsi', async () => {
    const locked = generateBackupKeyPair('frasa-sandi-uji-panjang');
    expect(locked.privateKeyPem).toContain('ENCRYPTED PRIVATE KEY');
    expect(() => loadPrivateKey(locked.privateKeyPem)).toThrow(/BAD_PRIVATE_KEY/);
    expect(() => loadPrivateKey(locked.privateKeyPem, 'salah')).toThrow(/BAD_PRIVATE_KEY/);
    const id = loadPrivateKey(locked.privateKeyPem, 'frasa-sandi-uji-panjang');
    const sealed = await collect(
      chunked(Buffer.from('rahasia')),
      createEncryptStream(parsePublicKey(locked.publicKey)),
    );
    expect((await decrypt(sealed, id)).toString()).toBe('rahasia');
  });

  it('format kunci publik divalidasi', () => {
    expect(() => parsePublicKey('age1abc')).toThrow(/BAD_PUBLIC_KEY/);
    expect(() => parsePublicKey('simrsbk1:pendek')).toThrow(/BAD_PUBLIC_KEY/);
    expect(parsePublicKey(` ${pair.publicKey}\n`).id).toBe(recipient.id);
  });
});
