import { newId } from '@simrs/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  allocateNumber,
  createPrismaClient,
  isModuleEnabled,
  type PrismaClient,
  withTenant,
} from '../src/index';
import { SEED_TENANTS } from '../src/seed-data';
import { testDbUrls } from '../src/testing';

const [A, B] = SEED_TENANTS;
let app: PrismaClient;
let owner: PrismaClient;

beforeAll(() => {
  app = createPrismaClient({ connectionString: testDbUrls().app, max: 10 });
  owner = createPrismaClient({ connectionString: testDbUrls().migrator, max: 2 });
});

afterAll(async () => {
  await app.$disconnect();
  await owner.$disconnect();
});

describe('penomoran (P08)', () => {
  it('nomor unik dan berurutan walau dialokasikan paralel', async () => {
    const T = { id: newId(), code: `NUM${Date.now()}`, name: 'RS Fiktif Uji Nomor' };
    await withTenant(owner, T.id, (tx) => tx.tenant.create({ data: T }));
    const results = await Promise.all(
      Array.from({ length: 20 }, () => withTenant(app, T.id, (tx) => allocateNumber(tx, T.id, 'mrn'))),
    );
    const values = results.map((r) => r.value).sort((a, b) => (a < b ? -1 : 1));
    expect(values).toEqual(Array.from({ length: 20 }, (_, i) => BigInt(i + 1)));
    expect(results.find((r) => r.value === 1n)?.number).toBe('00-00-00-01');
  });

  it('transaksi batal tidak menghabiskan nomor', async () => {
    const T = { id: newId(), code: `NUM${Date.now()}B`, name: 'RS Fiktif Uji Nomor B' };
    await withTenant(owner, T.id, (tx) => tx.tenant.create({ data: T }));
    await withTenant(app, T.id, (tx) =>
      allocateNumber(tx, T.id, 'invoice', new Date('2026-10-05T00:00:00Z')),
    );
    await withTenant(app, T.id, async (tx) => {
      await allocateNumber(tx, T.id, 'invoice', new Date('2026-10-05T00:00:00Z'));
      throw new Error('batal');
    }).catch(() => {});
    const next = await withTenant(app, T.id, (tx) =>
      allocateNumber(tx, T.id, 'invoice', new Date('2026-10-05T00:00:00Z')),
    );
    expect(next.number).toBe('INV-2610-00002');
  });

  it('urutan terpisah per tenant dan per periode', async () => {
    const a = await withTenant(app, A.id, (tx) =>
      allocateNumber(tx, A.id, 'journal', new Date('2031-01-15T00:00:00Z')),
    );
    const b = await withTenant(app, B.id, (tx) =>
      allocateNumber(tx, B.id, 'journal', new Date('2031-01-15T00:00:00Z')),
    );
    const a2 = await withTenant(app, A.id, (tx) =>
      allocateNumber(tx, A.id, 'journal', new Date('2031-02-15T00:00:00Z')),
    );
    expect(a.period).toBe('3101');
    expect(b.value).toBeLessThanOrEqual(a.value + 1n);
    expect(a2.period).toBe('3102');
  });

  it('tenant lain tidak bisa mengalokasikan nomor atas nama tenant ini (RLS)', async () => {
    const err = await withTenant(app, A.id, (tx) => allocateNumber(tx, B.id, 'mrn')).catch((e: unknown) => e);
    expect(String(err)).toMatch(/row-level security/i);
  });
});

describe('modul aktif (P10)', () => {
  it('bawaan katalog bila belum diatur, lalu mengikuti pengaturan tenant', async () => {
    const T = { id: newId(), code: `MOD${Date.now()}`, name: 'RS Fiktif Uji Modul' };
    await withTenant(owner, T.id, (tx) => tx.tenant.create({ data: T }));
    expect(await withTenant(app, T.id, (tx) => isModuleEnabled(tx, 'P05'))).toBe(true);
    expect(await withTenant(app, T.id, (tx) => isModuleEnabled(tx, 'B02'))).toBe(false);
    await withTenant(app, T.id, (tx) =>
      tx.tenantModule.create({ data: { tenantId: T.id, moduleCode: 'P05', enabled: false } }),
    );
    expect(await withTenant(app, T.id, (tx) => isModuleEnabled(tx, 'P05'))).toBe(false);
  });
});

describe('struktur faskes (P01)', () => {
  it('unit tidak bisa menunjuk faskes milik tenant lain (FK komposit)', async () => {
    const facilityB = await withTenant(app, B.id, (tx) =>
      tx.facility.create({
        data: { id: newId(), tenantId: B.id, code: `FB${Date.now()}`, name: 'Faskes B' },
      }),
    );
    const err = await withTenant(app, A.id, (tx) =>
      tx.unit.create({
        data: {
          id: newId(),
          tenantId: A.id,
          facilityId: facilityB.id,
          code: `U${Date.now()}`,
          name: 'Unit',
          kind: 'poli',
        },
      }),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(String(err)).toMatch(/foreign key|Foreign key/i);
  });

  it('master tidak bisa dihapus oleh role aplikasi', async () => {
    const f = await withTenant(app, A.id, (tx) =>
      tx.facility.create({
        data: { id: newId(), tenantId: A.id, code: `FA${Date.now()}`, name: 'Faskes A' },
      }),
    );
    const err = await withTenant(app, A.id, (tx) => tx.facility.delete({ where: { id: f.id } })).catch(
      (e: unknown) => e,
    );
    expect(String(err)).toMatch(/permission denied/i);
  });

  it('bed wajib punya induk; kode harus format baku (CHECK)', async () => {
    const f = await withTenant(app, A.id, (tx) =>
      tx.facility.create({
        data: { id: newId(), tenantId: A.id, code: `FC${Date.now()}`, name: 'Faskes C' },
      }),
    );
    const u = await withTenant(app, A.id, (tx) =>
      tx.unit.create({
        data: {
          id: newId(),
          tenantId: A.id,
          facilityId: f.id,
          code: `UC${Date.now()}`,
          name: 'Bangsal',
          kind: 'rawat_inap',
        },
      }),
    );
    const orphanBed = await withTenant(app, A.id, (tx) =>
      tx.location.create({
        data: {
          id: newId(),
          tenantId: A.id,
          unitId: u.id,
          kind: 'bed',
          code: `BD${Date.now()}`,
          name: 'Bed',
        },
      }),
    ).catch((e: unknown) => e);
    expect(String(orphanBed)).toMatch(/locations_bed_has_parent|check constraint/i);
    const badCode = await withTenant(app, A.id, (tx) =>
      tx.facility.create({ data: { id: newId(), tenantId: A.id, code: 'kode kecil', name: 'X' } }),
    ).catch((e: unknown) => e);
    expect(String(badCode)).toMatch(/facilities_code_format|check constraint/i);
  });
});
