/**
 * Arsip berkas dokumen (P08) dalam format ustar minimal, ditulis/dibaca sendiri agar sama di Windows/macOS/Linux
 * dan tanpa path dari luar: hanya kunci penyimpanan buatan server `<tenant>/<tahun>/<bulan>/<uuid>` (ADR-0020) yang
 * diarsipkan maupun diekstrak, jadi path traversal tidak mungkin. Hasilnya tetap bisa dibaca `tar -tf`.
 */
import { createReadStream } from 'node:fs';
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { Readable } from 'node:stream';

/** Sama dengan `KEY` di apps/api/src/infra/object-storage.ts. */
export const STORAGE_KEY = /^[0-9a-f-]{36}\/[0-9]{4}\/[0-9]{2}\/[0-9a-f-]{36}$/;
const BLOCK = 512;
/** Batas ukuran per berkas (dokumen ≤ 10 MiB di DB; beri ruang). */
const MAX_ENTRY_BYTES = 64 * 1024 * 1024;

export class TarError extends Error {
  constructor(message: string) {
    super(`TAR_INVALID: ${message}`);
    this.name = 'TarError';
  }
}

export interface DocumentEntry {
  key: string;
  path: string;
  size: number;
}

export interface DocumentInventory {
  entries: DocumentEntry[];
  totalBytes: number;
  /** Berkas yang bukan kunci penyimpanan (mis. `.tmp` setengah jadi) dan tidak diarsipkan. */
  skipped: number;
}

/** Daftar berkas dokumen di root penyimpanan disk (urut kunci). Root belum ada = kosong. */
export async function inventoryDocuments(root: string): Promise<DocumentInventory> {
  const entries: DocumentEntry[] = [];
  let skipped = 0;
  let totalBytes = 0;
  const walk = async (dir: string): Promise<void> => {
    let items;
    try {
      items = await readdir(dir, { withFileTypes: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT' && dir === root) return;
      throw err;
    }
    for (const item of items) {
      const full = join(dir, item.name);
      if (item.isDirectory()) {
        await walk(full);
      } else if (item.isFile()) {
        const key = relative(root, full).split(sep).join('/');
        if (!STORAGE_KEY.test(key)) {
          skipped += 1;
          continue;
        }
        const { size } = await stat(full);
        entries.push({ key, path: full, size });
        totalBytes += size;
      } else {
        skipped += 1;
      }
    }
  };
  await walk(root);
  entries.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return { entries, totalBytes, skipped };
}

function octal(value: number, width: number): string {
  return value.toString(8).padStart(width - 1, '0') + '\0';
}

function header(key: string, size: number, mtime: number): Buffer {
  const h = Buffer.alloc(BLOCK, 0);
  // ustar: nama ≤ 100 byte, sisanya di prefix (≤ 155). Kunci penyimpanan selalu 81 karakter.
  let name = key;
  let prefix = '';
  if (Buffer.byteLength(key) > 100) {
    const cut = key.lastIndexOf('/', key.length - 1);
    prefix = key.slice(0, cut);
    name = key.slice(cut + 1);
  }
  h.write(name, 0, 100, 'utf8');
  h.write(octal(0o600, 8), 100, 8, 'ascii');
  h.write(octal(0, 8), 108, 8, 'ascii');
  h.write(octal(0, 8), 116, 8, 'ascii');
  h.write(octal(size, 12), 124, 12, 'ascii');
  h.write(octal(mtime, 12), 136, 12, 'ascii');
  h.write('        ', 148, 8, 'ascii');
  h.write('0', 156, 1, 'ascii');
  h.write('ustar\0', 257, 6, 'ascii');
  h.write('00', 263, 2, 'ascii');
  h.write(prefix, 345, 155, 'utf8');
  let sum = 0;
  for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
  return h;
}

/** Aliran ustar berisi tepat berkas di inventaris (ukuran berubah saat dibaca = galat, berkas dokumen immutable). */
export function tarStream(inventory: DocumentInventory, mtime = 0): Readable {
  async function* generate() {
    for (const entry of inventory.entries) {
      yield header(entry.key, entry.size, mtime);
      let read = 0;
      for await (const chunk of createReadStream(entry.path)) {
        const buf = chunk as Buffer;
        read += buf.length;
        if (read > entry.size) throw new TarError(`berkas ${entry.key} berubah saat diarsipkan`);
        yield buf;
      }
      if (read !== entry.size) throw new TarError(`berkas ${entry.key} berubah saat diarsipkan`);
      const pad = (BLOCK - (entry.size % BLOCK)) % BLOCK;
      if (pad) yield Buffer.alloc(pad, 0);
    }
    yield Buffer.alloc(BLOCK * 2, 0);
  }
  return Readable.from(generate());
}

function parseOctal(buf: Buffer): number {
  const text = buf.toString('ascii').replace(/\0.*$/s, '').trim();
  if (!/^[0-7]*$/.test(text)) throw new TarError('angka oktal tidak valid');
  return text ? parseInt(text, 8) : 0;
}

function verifyChecksum(h: Buffer): void {
  const stored = parseOctal(h.subarray(148, 156));
  let sum = 0;
  for (let i = 0; i < BLOCK; i += 1) sum += i >= 148 && i < 156 ? 32 : (h[i] ?? 0);
  if (sum !== stored) throw new TarError('checksum header tidak cocok');
}

export interface ExtractResult {
  files: number;
  totalBytes: number;
  keys: string[];
}

/**
 * Baca ustar hasil `tarStream`; tulis berkas ke `dest` (null = hanya hitung). Entri selain berkas biasa berkunci
 * penyimpanan valid ditolak, begitu pula arsip tanpa penutup (terpotong).
 */
export async function extractTar(source: AsyncIterable<Buffer>, dest: string | null): Promise<ExtractResult> {
  let buf: Buffer = Buffer.alloc(0);
  const keys: string[] = [];
  let totalBytes = 0;
  let current: { key: string; size: number; parts: Buffer[]; got: number } | null = null;
  let padding = 0;
  let ended = false;

  const finishFile = async () => {
    if (!current) return;
    if (dest) {
      const target = join(dest, ...current.key.split('/'));
      await mkdir(join(target, '..'), { recursive: true });
      await writeFile(target, Buffer.concat(current.parts), { flag: 'wx', mode: 0o600 });
    }
    keys.push(current.key);
    totalBytes += current.size;
    current = null;
  };

  const consume = async () => {
    for (;;) {
      if (ended) {
        if (buf.some((b) => b !== 0)) throw new TarError('data setelah penutup arsip');
        buf = Buffer.alloc(0);
        return;
      }
      if (current) {
        const need = current.size - current.got;
        if (need > 0) {
          if (buf.length === 0) return;
          const take = buf.subarray(0, Math.min(need, buf.length));
          current.parts.push(Buffer.from(take));
          current.got += take.length;
          buf = buf.subarray(take.length);
          continue;
        }
        padding = (BLOCK - (current.size % BLOCK)) % BLOCK;
        await finishFile();
      }
      if (padding > 0) {
        if (buf.length === 0) return;
        const take = Math.min(padding, buf.length);
        buf = buf.subarray(take);
        padding -= take;
        continue;
      }
      if (buf.length < BLOCK) return;
      const h = buf.subarray(0, BLOCK);
      if (h.every((b) => b === 0)) {
        if (buf.length < BLOCK * 2) return;
        if (!buf.subarray(BLOCK, BLOCK * 2).every((b) => b === 0))
          throw new TarError('penutup arsip tidak lengkap');
        buf = buf.subarray(BLOCK * 2);
        ended = true;
        continue;
      }
      verifyChecksum(h);
      if (h.subarray(257, 262).toString('ascii') !== 'ustar') throw new TarError('bukan arsip ustar');
      const type = String.fromCharCode(h[156] ?? 0);
      if (type !== '0' && type !== '\0') throw new TarError('hanya berkas biasa yang diizinkan');
      const name = h.subarray(0, 100).toString('utf8').replace(/\0.*$/s, '');
      const prefix = h.subarray(345, 500).toString('utf8').replace(/\0.*$/s, '');
      const key = prefix ? `${prefix}/${name}` : name;
      if (!STORAGE_KEY.test(key)) throw new TarError('nama entri bukan kunci penyimpanan dokumen');
      const size = parseOctal(h.subarray(124, 136));
      if (size > MAX_ENTRY_BYTES) throw new TarError(`entri ${key} terlalu besar`);
      buf = buf.subarray(BLOCK);
      current = { key, size, parts: [], got: 0 };
    }
  };

  for await (const chunk of source) {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    await consume();
  }
  await consume();
  if (!ended || current || padding > 0) throw new TarError('arsip terpotong');
  return { files: keys.length, totalBytes, keys };
}
