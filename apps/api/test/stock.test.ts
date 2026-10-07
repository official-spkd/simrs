import {
  createPrismaClient,
  seedClinicalMasters,
  seedHospitalStructure,
  seedSupportMasters,
  seedSupportStock,
  type TenantTx,
  withTenant,
} from '@simrs/db';
import { testDbUrls } from '@simrs/db/testing';
import { isoDateJakarta } from '@simrs/shared';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bearer,
  createTestApp,
  createTestTenant,
  createTestUser,
  login,
  type Tokens,
  testDb,
} from './helpers';

/**
 * S05 · Stok depo, B01 minimal (rencana fase 4 §4.6a): penerimaan, mutasi dua langkah, penyesuaian beralasan, saldo =
 * Σ ledger, stok tidak pernah negatif di bawah transaksi serentak, batch kedaluwarsa ditolak, lingkup unit, isolasi.
 */

let app: NestExpressApplication;
let A: { id: string; code: string };
let B: { id: string; code: string };
const tok: Record<string, Tokens> = {};
const users: Record<string, string> = {};
const loc: Record<string, string> = {};

const run = <R>(tenantId: string, fn: (tx: TenantTx) => Promise<R>) => withTenant(testDb(), tenantId, fn);
const as = (who: string) => {
  const auth = () => bearer(tok[who] as Tokens);
  const http = () => request(app.getHttpServer());
  return {
    get: (url: string) => http().get(`/api/v1${url}`).set(auth()),
    post: (url: string, body: object = {}) => http().post(`/api/v1${url}`).set(auth()).send(body),
  };
};

const day = (offset: number) => isoDateJakarta(new Date(Date.now() + offset * 86_400_000));

async function supportTenant(seedStockAs?: (t: { id: string }) => Promise<string>) {
  const t = await createTestTenant();
  const owner = createPrismaClient({ connectionString: testDbUrls().migrator, max: 1 });
  try {
    await withTenant(owner, t.id, async (tx) => {
      await seedHospitalStructure(tx, t.id);
      await seedClinicalMasters(tx, t.id);
      await seedSupportMasters(tx, t.id);
    });
    if (seedStockAs) {
      const actor = await seedStockAs(t);
      await withTenant(owner, t.id, (tx) => seedSupportStock(tx, t.id, actor));
    }
  } finally {
    await owner.$disconnect();
  }
  return t;
}

async function addUser(who: string, t: { id: string; code: string }, role: string, unitCode?: string) {
  const unitId = unitCode
    ? (await run(t.id, (tx) => tx.unit.findFirstOrThrow({ where: { code: unitCode } }))).id
    : undefined;
  const user = await createTestUser(t.id, { roles: [{ code: role, unitId }], tenantCode: t.code });
  users[who] = user.id;
  tok[who] = await login(app, user);
}

const drugId = (name: string) =>
  run(A.id, async (tx) => (await tx.drug.findFirstOrThrow({ where: { name } })).id);
const supplierId = () =>
  run(A.id, async (tx) => (await tx.supplier.findFirstOrThrow({ where: { code: 'PBF-FIKTIF-1' } })).id);
const batchId = (batchNo: string) =>
  run(A.id, async (tx) => (await tx.stockBatch.findFirstOrThrow({ where: { batchNo } })).id);
const balance = (locationId: string, stockBatchId: string) =>
  run(
    A.id,
    async (tx) =>
      (
        await tx.stockBalance.findUnique({
          where: {
            tenantId_stockLocationId_stockBatchId: {
              tenantId: A.id,
              stockLocationId: locationId,
              stockBatchId,
            },
          },
        })
      )?.quantity ?? 0,
  );

/** Properti ledger: setiap saldo = Σ qty ledger lokasi × batch itu, dan tidak ada saldo negatif. */
async function assertLedgerConsistent(tenantId: string) {
  const mismatches = await run(
    tenantId,
    (tx) =>
      tx.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*)::bigint AS n FROM (
        SELECT b.stock_location_id, b.stock_batch_id, b.quantity, coalesce(sum(m.quantity), 0) AS ledger
        FROM stock_balances b
        LEFT JOIN stock_movements m
          ON m.stock_location_id = b.stock_location_id AND m.stock_batch_id = b.stock_batch_id
        GROUP BY b.stock_location_id, b.stock_batch_id, b.quantity
      ) x WHERE x.quantity <> x.ledger OR x.quantity < 0`,
  );
  expect(Number(mismatches[0]?.n ?? -1)).toBe(0);
}

beforeAll(async () => {
  app = await createTestApp();
  A = await supportTenant(async (t) => {
    await addUser('apoteker', t as typeof A, 'apoteker', 'FARMASI');
    return users.apoteker as string;
  });
  B = await supportTenant();
  await addUser('apotekerIgd', A, 'apoteker', 'IGD');
  await addUser('apotekerTanpaUnit', A, 'apoteker');
  await addUser('manajemen', A, 'manajemen');
  await addUser('perawat', A, 'perawat', 'MELATI');
  await addUser('apotekerB', B, 'apoteker', 'FARMASI');
  for (const code of ['GUDANG', 'DEPO-RI', 'DEPO-RJ', 'DEPO-IGD']) {
    loc[code] = (await run(A.id, (tx) => tx.stockLocation.findFirstOrThrow({ where: { code } }))).id;
  }
});

afterAll(async () => {
  await app?.close();
});

describe('stok depo (S05, 4.6a)', () => {
  it('lokasi dan saldo mengikuti lingkup: unit FARMASI melihat gudang + depo RJ/RI; manajemen semua; tanpa unit kosong', async () => {
    const mine = await as('apoteker').get('/stock/locations').expect(200);
    expect((mine.body as Array<{ code: string }>).map((l) => l.code).sort()).toEqual([
      'DEPO-RI',
      'DEPO-RJ',
      'GUDANG',
    ]);
    const all = await as('manajemen').get('/stock/locations').expect(200);
    expect((all.body as unknown[]).length).toBeGreaterThanOrEqual(5);
    expect((await as('apotekerTanpaUnit').get('/stock/locations').expect(200)).body).toEqual([]);
    await as('apoteker').get(`/stock/balances?stockLocationId=${loc['DEPO-IGD']}`).expect(403);
    await as('perawat').get('/stock/locations').expect(403);
    // Manajemen hanya membaca.
    await as('manajemen')
      .post('/stock/adjustments', {
        stockLocationId: loc.GUDANG,
        items: [{ stockBatchId: await batchId('PCT-01'), quantityDelta: -1 }],
        reason: 'Uji manajemen tanpa izin menyesuaikan stok',
      })
      .expect(403);

    const bal = await as('apoteker').get(`/stock/balances?stockLocationId=${loc.GUDANG}`).expect(200);
    const sfx = (bal.body as Array<{ batchNo: string; expired: boolean; expiringSoon: boolean }>).filter(
      (b) => b.batchNo.startsWith('SFX-'),
    );
    // FEFO: ED terdekat dulu; batch lewat ED dan dekat ED ditandai.
    expect(sfx.map((b) => [b.batchNo, b.expired, b.expiringSoon])).toEqual([
      ['SFX-LAMA', true, false],
      ['SFX-DEKAT', false, true],
      ['SFX-BARU', false, false],
    ]);
    const expiring = await as('apoteker').get('/stock/balances?expiring=1').expect(200);
    expect((expiring.body as Array<{ batchNo: string }>).every((b) => b.batchNo !== 'SFX-BARU')).toBe(true);
    await assertLedgerConsistent(A.id);
  });

  it('penerimaan: nomor TRM, batch baru + saldo + event; batch kedaluwarsa ditolak; ED berbeda untuk batch sama 409', async () => {
    const parasetamol = await drugId('Parasetamol 500 mg tablet');
    const body = (items: object[]) => ({
      stockLocationId: loc['DEPO-RJ'],
      supplierId: '',
      invoiceNo: 'FKT-UJI-001',
      items,
    });
    const supplier = await supplierId();
    const r = await as('apoteker')
      .post('/stock/receipts', {
        ...body([
          { drugId: parasetamol, batchNo: 'PCT-UJI-1', expiryDate: day(400), quantity: 200, unitCost: '160' },
        ]),
        supplierId: supplier,
      })
      .expect(201);
    expect(r.body).toMatchObject({
      receiptNo: expect.stringMatching(/^TRM-\d{4}-\d{4}$/),
      items: [{ batchNo: 'PCT-UJI-1', quantity: 200, unitCost: '160' }],
      receivedBy: { userId: users.apoteker },
    });
    const pct = r.body.items[0].stockBatchId as string;
    expect(await balance(loc['DEPO-RJ'] as string, pct)).toBe(200);
    const events = await run(A.id, (tx) =>
      tx.domainEvent.count({
        where: { name: 'stock.received', payload: { path: ['stockReceiptId'], equals: r.body.id } },
      }),
    );
    expect(events).toBe(1);

    const expired = await as('apoteker')
      .post('/stock/receipts', {
        ...body([
          { drugId: parasetamol, batchNo: 'PCT-LAMA-X', expiryDate: day(0), quantity: 5, unitCost: '160' },
        ]),
        supplierId: supplier,
      })
      .expect(409);
    expect(expired.body.code).toBe('BATCH_EXPIRED');
    const mismatch = await as('apoteker')
      .post('/stock/receipts', {
        ...body([
          { drugId: parasetamol, batchNo: 'PCT-UJI-1', expiryDate: day(300), quantity: 5, unitCost: '160' },
        ]),
        supplierId: supplier,
      })
      .expect(409);
    expect(mismatch.body.code).toBe('CONFLICT');
    // Penerimaan ulang batch yang sama (ED sama) menambah saldo batch itu.
    await as('apoteker')
      .post('/stock/receipts', {
        ...body([
          { drugId: parasetamol, batchNo: 'PCT-UJI-1', expiryDate: day(400), quantity: 50, unitCost: '160' },
        ]),
        supplierId: supplier,
      })
      .expect(201);
    expect(await balance(loc['DEPO-RJ'] as string, pct)).toBe(250);
    // Di luar lingkup unit → 403.
    await as('apoteker')
      .post('/stock/receipts', {
        ...body([
          { drugId: parasetamol, batchNo: 'PCT-UJI-2', expiryDate: day(400), quantity: 5, unitCost: '160' },
        ]),
        stockLocationId: loc['DEPO-IGD'],
        supplierId: supplier,
      })
      .expect(403);
    await assertLedgerConsistent(A.id);
  });

  it('mutasi dua langkah: dikirim mengurangi asal tanpa menambah tujuan; diterima sekali di tujuan; batch ED ditolak', async () => {
    const baru = await batchId('SFX-BARU');
    const before = {
      gudang: await balance(loc.GUDANG as string, baru),
      igd: await balance(loc['DEPO-IGD'] as string, baru),
    };
    const sent = await as('apoteker')
      .post('/stock/transfers', {
        fromStockLocationId: loc.GUDANG,
        toStockLocationId: loc['DEPO-IGD'],
        items: [{ stockBatchId: baru, quantity: 10 }],
      })
      .expect(201);
    expect(sent.body).toMatchObject({
      transferNo: expect.stringMatching(/^MUT-\d{4}-\d{4}$/),
      status: 'dikirim',
      // Pengirim berunit FARMASI tidak berlingkup atas depo IGD.
      canReceive: false,
    });
    // Setengah jalan: total stok fisik (dua depo) berkurang sebesar yang dalam perjalanan, tidak tergandakan.
    expect(await balance(loc.GUDANG as string, baru)).toBe(before.gudang - 10);
    expect(await balance(loc['DEPO-IGD'] as string, baru)).toBe(before.igd);

    await as('apoteker').post(`/stock/transfers/${sent.body.id}/receive`).expect(403);
    const pending = await as('apotekerIgd').get('/stock/transfers?status=dikirim').expect(200);
    expect(pending.body).toContainEqual(expect.objectContaining({ id: sent.body.id, canReceive: true }));
    // Terima serentak (klik ganda / dua tablet): sekali saja.
    const [a, b] = await Promise.all([
      as('apotekerIgd').post(`/stock/transfers/${sent.body.id}/receive`),
      as('apotekerIgd').post(`/stock/transfers/${sent.body.id}/receive`),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(await balance(loc['DEPO-IGD'] as string, baru)).toBe(before.igd + 10);
    const done = a.status === 200 ? a : b;
    expect(done.body).toMatchObject({ status: 'diterima', receivedBy: { userId: users.apotekerIgd } });

    const lama = await batchId('SFX-LAMA');
    const exp = await as('apoteker')
      .post('/stock/transfers', {
        fromStockLocationId: loc.GUDANG,
        toStockLocationId: loc['DEPO-RI'],
        items: [{ stockBatchId: lama, quantity: 1 }],
      })
      .expect(409);
    expect(exp.body.code).toBe('BATCH_EXPIRED');
    const tooMuch = await as('apoteker')
      .post('/stock/transfers', {
        fromStockLocationId: loc.GUDANG,
        toStockLocationId: loc['DEPO-RI'],
        items: [{ stockBatchId: baru, quantity: 100_000 }],
      })
      .expect(409);
    expect(tooMuch.body.code).toBe('STOCK_INSUFFICIENT');
    // Gagal = tidak ada nomor/dokumen mutasi yang tertinggal.
    expect(await run(A.id, (tx) => tx.stockTransfer.count({ where: { status: 'dikirim' } }))).toBe(0);
    await assertLedgerConsistent(A.id);
  });

  it('penyesuaian beralasan; batch ED hanya dihapusbukukan; stok tidak pernah negatif di bawah penyesuaian serentak', async () => {
    const lama = await batchId('SFX-LAMA');
    const reason = 'Hapus buku batch kedaluwarsa hasil opname bulanan';
    await as('apoteker')
      .post('/stock/adjustments', {
        stockLocationId: loc.GUDANG,
        items: [{ stockBatchId: lama, quantityDelta: 1 }],
        reason,
      })
      .expect(409);
    await as('apoteker')
      .post('/stock/adjustments', {
        stockLocationId: loc.GUDANG,
        items: [{ stockBatchId: lama, quantityDelta: -1 }],
        reason: 'pendek',
      })
      .expect(400);
    const wo = await as('apoteker')
      .post('/stock/adjustments', {
        stockLocationId: loc.GUDANG,
        items: [{ stockBatchId: lama, quantityDelta: -(await balance(loc.GUDANG as string, lama)) }],
        reason,
      })
      .expect(201);
    expect(wo.body).toMatchObject({ reason, adjustedBy: { userId: users.apoteker } });
    expect(await balance(loc.GUDANG as string, lama)).toBe(0);
    const kinds = await as('apoteker')
      .get(`/stock/movements?stockLocationId=${loc.GUDANG}&stockBatchId=${lama}`)
      .expect(200);
    expect((kinds.body as Array<{ kind: string; reason: string | null }>)[0]).toMatchObject({
      kind: 'write_off',
      reason,
    });

    // Serentak: 8 permintaan masing-masing −5 atas saldo 30 → paling banyak 6 berhasil, saldo tidak negatif.
    const dekat = await batchId('SFX-DEKAT');
    const start = await balance(loc.GUDANG as string, dekat);
    expect(start).toBe(30);
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        as('apoteker').post('/stock/adjustments', {
          stockLocationId: loc.GUDANG,
          items: [{ stockBatchId: dekat, quantityDelta: -5 }],
          reason: 'Rusak saat penyimpanan, uji serentak',
        }),
      ),
    );
    const ok = results.filter((r) => r.status === 201).length;
    expect(ok).toBe(6);
    expect(results.filter((r) => r.status === 409).every((r) => r.body.code === 'STOCK_INSUFFICIENT')).toBe(
      true,
    );
    expect(await balance(loc.GUDANG as string, dekat)).toBe(0);
    await assertLedgerConsistent(A.id);
  });

  it('kartu stok berisi nomor dokumen; isolasi RS: id RS lain 404, daftar RS lain tidak terlihat', async () => {
    const card = await as('apoteker').get(`/stock/movements?stockLocationId=${loc.GUDANG}`).expect(200);
    const rows = card.body as Array<{ kind: string; refNo: string | null }>;
    expect(rows.some((m) => m.kind === 'receipt' && /^TRM-/.test(m.refNo ?? ''))).toBe(true);
    expect(rows.some((m) => m.kind === 'transfer_out' && /^MUT-/.test(m.refNo ?? ''))).toBe(true);
    await as('apotekerB').get(`/stock/balances?stockLocationId=${loc.GUDANG}`).expect(404);
    expect((await as('apotekerB').get('/stock/balances').expect(200)).body).toEqual([]);
    expect((await as('apotekerB').get('/stock/transfers').expect(200)).body).toEqual([]);
    const drugs = await as('apoteker').get('/stock/drugs?q=seftriakson').expect(200);
    expect((drugs.body as Array<{ name: string }>).map((d) => d.name)).toContain('Seftriakson 2 g injeksi');
    expect((await as('apoteker').get('/stock/suppliers').expect(200)).body.length).toBeGreaterThanOrEqual(2);
  });
});
