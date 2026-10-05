/**
 * P02 · Daftar kata sandi bocor offline (docs/05 §1): SHA-1 format HIBP, pencarian per rentang awalan 20 bit, impor
 * N teratas dari berkas teks atau `SHA1:hitungan` (gagal tertutup), dan hak read-only role aplikasi. Penggantian isi
 * diuji di transaksi yang dibatalkan, sehingga daftar yang sudah diimpor ke database tes tidak tersentuh.
 */
import { createReadStream } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { newId } from '@simrs/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  breachedListStatus,
  collectBreachedPasswords,
  createPrismaClient,
  isBreachedPassword,
  passwordSha1,
  type PrismaClient,
  replaceBreachedPasswords,
  sha1PrefixRange,
} from '../src/index';
import { testDbUrls } from '../src/testing';

let app: PrismaClient;
let owner: PrismaClient;
const SAMPLE = resolve(__dirname, '../data/breached-passwords-sample.txt');

beforeAll(() => {
  app = createPrismaClient({ connectionString: testDbUrls().app, max: 2 });
  owner = createPrismaClient({ connectionString: testDbUrls().migrator, max: 2 });
});

afterAll(async () => {
  await app.$disconnect();
  await owner.$disconnect();
});

describe('hash dan rentang awalan', () => {
  it('SHA-1 heks besar seperti HIBP; rentang 20 bit, termasuk awalan terakhir', () => {
    expect(passwordSha1('password')).toBe('5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8');
    const pad = '0'.repeat(35);
    expect(sha1PrefixRange('5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8')).toEqual({
      from: `5BAA6${pad}`,
      to: `5BAA7${pad}`,
    });
    expect(sha1PrefixRange(`0000F${'1'.repeat(35)}`).to).toBe(`00010${pad}`);
    expect(sha1PrefixRange(`fffff${'1'.repeat(35)}`)).toEqual({ from: `FFFFF${pad}`, to: null });
  });
});

describe('membaca daftar sumber', () => {
  it('teks: satu kata sandi per baris, urut popularitas, tanpa duplikat, \\r dibuang, N pertama', async () => {
    const sample = await collectBreachedPasswords(
      createInterface({ input: createReadStream(SAMPLE, 'utf8'), crlfDelay: Infinity }),
      { top: 100_000 },
    );
    expect(sample.format).toBe('text');
    expect(sample.errors).toEqual([]);
    expect(sample.entries[0]).toEqual({ sha1: passwordSha1('123456'), occurrences: null });
    expect(sample.entries.map((e) => e.sha1)).toContain(passwordSha1('password1234'));
    const small = await collectBreachedPasswords(['abc\r', 'abc', '', 'def', 'ghi'], { top: 2 });
    expect(small.entries.map((e) => e.sha1)).toEqual([passwordSha1('abc'), passwordSha1('def')]);
    const tooLong = await collectBreachedPasswords(['abc', 'x'.repeat(1001)], { top: 10 });
    expect(tooLong.errors).toEqual([{ line: 2, message: expect.stringMatching(/lebih dari 1000/) }]);
  });

  it('HIBP SHA1:hitungan: N hitungan terbesar, heks dinormalisasi, baris rusak menggagalkan impor', async () => {
    const h = (pw: string) => passwordSha1(pw);
    const lines = [`${h('a')}:5`, `${h('b').toLowerCase()}:900`, `${h('c')}:42`, `${h('d')}:7`];
    const r = await collectBreachedPasswords(lines, { top: 2 });
    expect(r.format).toBe('hibp');
    expect(r.entries).toEqual([
      { sha1: h('b'), occurrences: 900 },
      { sha1: h('c'), occurrences: 42 },
    ]);
    const bad = await collectBreachedPasswords([`${h('a')}:5`, 'bukan-hash', `${h('b')}:0`], { top: 10 });
    expect(bad.errors.map((e) => e.line)).toEqual([2, 3]);
    // Pilihan N teratas sama dengan mengurutkan seluruh berkas.
    const many = Array.from({ length: 500 }, (_, i) => ({
      sha1: h(`pw${i}`),
      occurrences: ((i * 7919) % 997) + 1,
    }));
    const top = await collectBreachedPasswords(
      many.map((e) => `${e.sha1}:${e.occurrences}`),
      { top: 25 },
    );
    const expected = [...many].sort((x, y) => y.occurrences - x.occurrences).slice(0, 25);
    expect(top.entries.map((e) => e.occurrences)).toEqual(expected.map((e) => e.occurrences));
  });
});

describe('ref.breached_passwords', () => {
  it('ganti isi + cari per rentang (dibatalkan di akhir: daftar yang ada tidak tersentuh)', async () => {
    const before = await breachedListStatus(owner);
    const unique = `frasa bocor uji ${newId()}`;
    const entries = (
      await collectBreachedPasswords(['password1234', unique, 'qwertyuiop123', 'password1234'], { top: 10 })
    ).entries;
    await expect(
      owner.$transaction(async (tx) => {
        expect(await replaceBreachedPasswords(tx, entries, { source: 'uji', version: '1' })).toBe(3);
        expect(await isBreachedPassword(tx, unique)).toBe(true);
        expect(await isBreachedPassword(tx, 'qwertyuiop123')).toBe(true);
        expect(await isBreachedPassword(tx, `frasa aman lain ${newId()}`)).toBe(false);
        expect(await breachedListStatus(tx)).toMatchObject({ entries: 3, source: 'uji', version: '1' });
        throw new Error('batalkan');
      }),
    ).rejects.toThrow('batalkan');
    expect(await breachedListStatus(owner)).toEqual(before);
    expect(await isBreachedPassword(app, unique)).toBe(false);
  });

  it('role aplikasi hanya membaca', async () => {
    const hex = passwordSha1(`frasa uji ${newId()}`);
    await expect(
      app.$executeRaw`INSERT INTO ref.breached_passwords (sha1) VALUES (decode(${hex}, 'hex'))`,
    ).rejects.toThrow(/permission denied/);
    await expect(app.$executeRaw`DELETE FROM ref.breached_passwords`).rejects.toThrow(/permission denied/);
    await expect(
      app.$executeRaw`INSERT INTO ref.breached_password_imports (source, version, entry_count) VALUES ('x', '1', 0)`,
    ).rejects.toThrow(/permission denied/);
    expect(typeof (await breachedListStatus(app)).entries).toBe('number');
  });

  it('batasan: hash 20 byte, hitungan positif', async () => {
    await expect(
      owner.$transaction(async (tx) => {
        await tx.$executeRaw`INSERT INTO ref.breached_passwords (sha1) VALUES (decode('abcd', 'hex'))`;
      }),
    ).rejects.toThrow(/breached_passwords_sha1_length/);
    const hex = passwordSha1(`frasa uji ${newId()}`);
    await expect(
      owner.$transaction(async (tx) => {
        await tx.$executeRaw`INSERT INTO ref.breached_passwords (sha1, occurrences) VALUES (decode(${hex}, 'hex'), 0)`;
      }),
    ).rejects.toThrow(/breached_passwords_occurrences_positive/);
  });
});
