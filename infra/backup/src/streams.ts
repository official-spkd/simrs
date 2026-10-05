import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { link, rm, unlink } from 'node:fs/promises';
import { Transform, type TransformCallback, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/** Transform yang meneruskan data apa adanya sambil menghitung SHA-256 dan jumlah byte. */
export class DigestTap extends Transform {
  private readonly hash = createHash('sha256');
  bytes = 0;

  override _transform(chunk: Buffer, _enc: BufferEncoding, done: TransformCallback): void {
    this.hash.update(chunk);
    this.bytes += chunk.length;
    done(null, chunk);
  }

  /** Hanya dipanggil sekali, setelah aliran selesai. */
  digest(): string {
    return this.hash.digest('hex');
  }
}

/** Penampung yang membuang data (untuk menghitung hash tanpa menyimpan). */
export function discard(): Writable {
  return new Writable({
    write(_chunk, _enc, done) {
      done();
    },
  });
}

export async function sha256File(path: string): Promise<{ sha256: string; bytes: number }> {
  const tap = new DigestTap();
  await pipeline(createReadStream(path), tap, discard());
  return { sha256: tap.digest(), bytes: tap.bytes };
}

type Stage = NodeJS.ReadableStream | NodeJS.ReadWriteStream;

/**
 * Tulis aliran ke `<target>.part` (berkas baru, 0600), lalu tautkan ke `target` hanya bila seluruh aliran sukses.
 * Gagal di tengah = `.part` dihapus. `target` yang sudah ada tidak pernah ditimpa: `link` gagal EEXIST.
 */
export async function writeAtomically(target: string, stages: readonly Stage[]): Promise<void> {
  const part = `${target}.part`;
  try {
    await pipeline([...stages, createWriteStream(part, { flags: 'wx', mode: 0o600 })]);
    await link(part, target);
  } finally {
    await unlink(part).catch(() => rm(part, { force: true }));
  }
}
