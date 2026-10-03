/**
 * Regresi zona waktu: adapter `pg` Prisma mengabaikan offset `timestamptz` saat membaca dan menulis `Date` sebagai
 * waktu UTC tanpa zona. Bila zona sesi bukan UTC, tanggal bergeser (bug nyata yang membuat kedaluwarsa sesi dan
 * waktu jejak audit salah 7 jam di server ber-timezone Asia/Jakarta). `createPrismaClient` memaksa TimeZone=UTC.
 * Postgres portabel tes sengaja ber-timezone Asia/Jakarta, jadi tes ini benar-benar menguji pemaksaan itu.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient, type PrismaClient, withTenant } from '../src/index';
import { testDbUrls } from '../src/testing';

let db: PrismaClient;

beforeAll(() => {
  db = createPrismaClient({ connectionString: testDbUrls().app, max: 1 });
});

afterAll(async () => {
  await db.$disconnect();
});

const HOUR = 3_600_000;

describe('zona waktu koneksi Prisma', () => {
  it('Date yang ditulis tersimpan sebagai instan yang sama; now() database terbaca benar', async () => {
    const written = new Date();
    const [r] = await db.$queryRaw<Array<{ tz: string; stored: number; dbNow: Date }>>`
      SELECT current_setting('TimeZone') AS tz,
             extract(epoch FROM ${written}::timestamptz)::float8 * 1000 AS stored,
             clock_timestamp() AS "dbNow"`;
    expect(r?.tz).toBe('UTC');
    expect(Math.abs((r?.stored ?? 0) - written.getTime())).toBeLessThan(5);
    expect(Math.abs((r?.dbNow.getTime() ?? 0) - Date.now())).toBeLessThan(HOUR / 60);
  });

  it('waktu catat audit (diisi trigger server) terbaca sesuai jam aplikasi', async () => {
    const before = Date.now();
    const id = crypto.randomUUID();
    const tenantId = '0199a000-0000-7000-8000-000000000001';
    const row = await withTenant(db, tenantId, (tx) =>
      tx.auditEvent.create({
        data: { id, tenantId, resourceType: 'tes_zona_waktu', action: 'verify' },
        select: { occurredAt: true },
      }),
    );
    const read = await withTenant(db, tenantId, (tx) =>
      tx.auditEvent.findUniqueOrThrow({ where: { id }, select: { occurredAt: true } }),
    );
    for (const at of [row.occurredAt, read.occurredAt]) {
      expect(at.getTime()).toBeGreaterThanOrEqual(before - 1000);
      expect(at.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    }
  });
});
