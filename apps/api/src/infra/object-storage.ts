import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

/**
 * P08 · Penyimpanan objek berkas dokumen (ADR-0020). Kunci SELALU dibuat server
 * (`<tenant>/<tahun>/<bulan>/<uuid>`) dan divalidasi lagi di sini, jadi tidak ada path dari klien yang pernah
 * menyentuh sistem berkas. Driver `disk` untuk lokal/edge; driver S3/MinIO menyusul dengan antarmuka yang sama.
 */
export interface ObjectStorage {
  readonly driver: 'disk';
  /** Simpan berkas baru; menolak menimpa kunci yang sudah ada. */
  put(key: string, bytes: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  /** Kesiapan untuk `/ready`. */
  check(): Promise<void>;
}

export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');

const KEY = /^[0-9a-f-]{36}\/[0-9]{4}\/[0-9]{2}\/[0-9a-f-]{36}$/;

export function documentStorageKey(tenantId: string, id: string, at: Date = new Date()): string {
  const month = String(at.getUTCMonth() + 1).padStart(2, '0');
  return `${tenantId}/${at.getUTCFullYear()}/${month}/${id}`;
}

export class DiskObjectStorage implements ObjectStorage {
  readonly driver = 'disk' as const;
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  private path(key: string): string {
    if (!KEY.test(key)) throw new Error('Kunci penyimpanan tidak valid');
    return join(this.root, ...key.split('/'));
  }

  async put(key: string, bytes: Buffer): Promise<void> {
    const target = this.path(key);
    await mkdir(dirname(target), { recursive: true });
    if (
      await access(target).then(
        () => true,
        () => false,
      )
    ) {
      throw new Error('Kunci penyimpanan sudah dipakai');
    }
    // Tulis ke berkas sementara lalu rename: pembaca tidak pernah melihat berkas setengah jadi.
    const tmp = `${target}.${randomUUID()}.tmp`;
    try {
      await writeFile(tmp, bytes, { flag: 'wx', mode: 0o600 });
      await rename(tmp, target);
    } catch (err) {
      await rm(tmp, { force: true });
      throw err;
    }
  }

  get(key: string): Promise<Buffer> {
    return readFile(this.path(key));
  }

  async check(): Promise<void> {
    await mkdir(this.root, { recursive: true });
    await access(this.root, constants.R_OK | constants.W_OK);
  }
}
