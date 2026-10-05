import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { extractTar, inventoryDocuments, tarStream } from '../src/tar';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'simrs-tar-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function bytes(r: Readable): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const c of r) parts.push(c as Buffer);
  return Buffer.concat(parts);
}

async function put(root: string, key: string, data: Buffer) {
  const target = join(root, ...key.split('/'));
  await mkdir(join(target, '..'), { recursive: true });
  await writeFile(target, data);
}

const key = () => `${randomUUID()}/2026/10/${randomUUID()}`;

describe('arsip dokumen ustar', () => {
  it('hanya kunci penyimpanan valid yang diarsipkan; bolak-balik isi sama', async () => {
    const src = join(dir, 'src');
    const files = new Map<string, Buffer>([
      [key(), randomBytes(0)],
      [key(), randomBytes(511)],
      [key(), randomBytes(512)],
      [key(), randomBytes(70_000)],
    ]);
    for (const [k, v] of files) await put(src, k, v);
    await put(src, `${key()}.0199a000-0000-7000-8000-000000000001.tmp`, Buffer.from('setengah'));
    await writeFile(join(src, 'catatan.txt'), 'bukan dokumen');

    const inv = await inventoryDocuments(src);
    expect(inv.entries).toHaveLength(4);
    expect(inv.skipped).toBe(2);
    expect(inv.totalBytes).toBe(511 + 512 + 70_000);

    const archive = await bytes(tarStream(inv));
    expect(archive.length % 512).toBe(0);
    const dest = join(dir, 'dest');
    await mkdir(dest);
    const result = await extractTar(Readable.from([archive]), dest);
    expect(result.files).toBe(4);
    expect(result.totalBytes).toBe(inv.totalBytes);
    for (const [k, v] of files) expect(await readFile(join(dest, ...k.split('/')))).toEqual(v);
  });

  it('root belum ada = arsip kosong yang valid', async () => {
    const inv = await inventoryDocuments(join(dir, 'tidak-ada'));
    const archive = await bytes(tarStream(inv));
    expect(await extractTar(Readable.from([archive]), null)).toEqual({ files: 0, totalBytes: 0, keys: [] });
  });

  it('arsip terpotong atau entri path traversal ditolak', async () => {
    const src = join(dir, 'src');
    await put(src, key(), randomBytes(1000));
    const archive = await bytes(tarStream(await inventoryDocuments(src)));
    await expect(extractTar(Readable.from([archive.subarray(0, 1200)]), null)).rejects.toThrow(/TAR_INVALID/);

    const evil = Buffer.from(archive);
    evil.write('../../etc/passwd\0', 0, 'utf8');
    // checksum dihitung ulang agar yang menolak adalah validasi nama, bukan checksum
    evil.write('        ', 148, 8, 'ascii');
    let sum = 0;
    for (let i = 0; i < 512; i += 1) sum += evil[i] ?? 0;
    evil.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
    await expect(extractTar(Readable.from([evil]), join(dir, 'x'))).rejects.toThrow(/kunci penyimpanan/);
  });

  it('header rusak → checksum ditolak', async () => {
    const src = join(dir, 'src');
    await put(src, key(), randomBytes(10));
    const archive = await bytes(tarStream(await inventoryDocuments(src)));
    archive[130] = 0x37;
    await expect(extractTar(Readable.from([archive]), null)).rejects.toThrow(/checksum/);
  });
});
