/**
 * `withTenant` meneruskan batas tunggu koneksi (`maxWaitMs`) ke Prisma: saat pool penuh, bawaan (2 dtk) gagal cepat
 * untuk API, sedangkan alat uji di mesin sibuk boleh menunggu lebih lama. Koneksi yang datang terlambat setelah
 * batas tunggu habis tidak boleh bocor (pool tetap bisa dipakai).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient, type PrismaClient, withTenant } from '../src/index';
import { testDbUrls } from '../src/testing';

const TENANT = '0199a000-0000-7000-8000-000000000001';
let db: PrismaClient;

beforeAll(() => {
  db = createPrismaClient({ connectionString: testDbUrls().app, max: 1 });
});

afterAll(async () => {
  await db.$disconnect();
});

describe('withTenant · batas tunggu koneksi', () => {
  it('pool penuh: maxWaitMs pendek gagal cepat, maxWaitMs panjang menunggu sampai koneksi bebas', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => (markStarted = resolve));
    const first = withTenant(db, TENANT, async () => {
      markStarted();
      await held;
      return 'pertama';
    });
    await started;

    const t0 = Date.now();
    await expect(
      withTenant(db, TENANT, () => Promise.resolve('cepat'), { maxWaitMs: 200 }),
    ).rejects.toMatchObject({
      code: 'P2028',
    });
    expect(Date.now() - t0).toBeLessThan(1_900);

    const patient = withTenant(db, TENANT, () => Promise.resolve('sabar'), { maxWaitMs: 10_000 });
    setTimeout(release, 300);
    await expect(first).resolves.toBe('pertama');
    await expect(patient).resolves.toBe('sabar');

    // Pool tidak bocor: transaksi berikutnya tetap jalan dengan batas tunggu bawaan.
    await expect(withTenant(db, TENANT, () => Promise.resolve('lagi'))).resolves.toBe('lagi');
  });
});
