/**
 * Dokumen driver s3 (ADR-0020/0071): objek bucket dokumen untuk setiap baris `documents` di snapshot dump, di-stream
 * langsung ke arsip terenkripsi (plaintext tidak menyentuh disk host backup) dan dicocokkan dengan sha256/ukuran
 * barisnya. Objek yang hilang atau berbeda dicatat di manifest sebagai temuan sumber, bukan menggagalkan backup.
 */
import { type S3Client, S3Error, type S3Response } from '@simrs/shared/node';
import type { DocumentRow } from './db';
import type { Manifest } from './manifest';
import type { TarEntry, TarEntryResult } from './tar';

export type IntegrityError = Manifest['documents']['integrityErrors'][number];

export class S3DocumentSource {
  readonly errors: IntegrityError[] = [];
  private readonly expected = new Map<string, DocumentRow>();

  constructor(
    private readonly s3: S3Client,
    private readonly bucket: string,
    private readonly rows: readonly DocumentRow[],
  ) {
    for (const r of rows) this.expected.set(r.key, r);
  }

  async *entries(): AsyncGenerator<TarEntry> {
    for (const row of this.rows) {
      let res: S3Response;
      try {
        res = await this.s3.request({ method: 'GET', bucket: this.bucket, key: row.key });
      } catch (err) {
        if (err instanceof S3Error && err.status === 404) {
          this.errors.push({ key: row.key, reason: 'missing' });
          continue;
        }
        throw err;
      }
      const size = Number(res.headers['content-length'] ?? -1);
      if (!Number.isInteger(size) || size < 0) {
        res.body.destroy();
        throw new Error('respons S3 tanpa content-length');
      }
      if (size !== row.size) this.errors.push({ key: row.key, reason: 'size' });
      yield { key: row.key, size, body: res.body };
    }
  }

  /** Dipanggil penulis tar setelah isi satu objek lewat: hash dibandingkan dengan baris `documents`. */
  readonly onEntry = (r: TarEntryResult): void => {
    const row = this.expected.get(r.key);
    if (row && r.bytes === row.size && r.sha256 !== row.sha256) {
      this.errors.push({ key: r.key, reason: 'sha256' });
    }
  };
}
