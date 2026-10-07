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
import { isoDateJakarta, newId } from '@simrs/shared';
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
 * S05 · Stok depo (4.6a) di bawah beban (audit agen BUG): mutasi/penyesuaian/penerimaan serentak multi-batch dengan
 * urutan item berlawanan tidak boleh deadlock (500), saldo = Σ ledger, IDOR terima mutasi lintas RS/lingkup, dan
 * ledger tidak bisa diubah langsung oleh role aplikasi.
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

async function supportTenant(seedStockAs?: (t: { id: string; code: string }) => Promise<string>) {
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

const batchId = (batchNo: string) =>
  run(A.id, async (tx) => (await tx.stockBatch.findFirstOrThrow({ where: { batchNo } })).id);

async function ledgerMismatches(tenantId: string): Promise<number> {
  const rows = await run(
    tenantId,
    (tx) =>
      tx.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*)::bigint AS n FROM (
        SELECT b.quantity, coalesce(sum(m.quantity), 0) AS ledger
        FROM stock_balances b
        LEFT JOIN stock_movements m
          ON m.stock_location_id = b.stock_location_id AND m.stock_batch_id = b.stock_batch_id
        GROUP BY b.stock_location_id, b.stock_batch_id, b.quantity
      ) x WHERE x.quantity <> x.ledger OR x.quantity < 0`,
  );
  return Number(rows[0]?.n ?? -1);
}

beforeAll(async () => {
  app = await createTestApp();
  A = await supportTenant(async (t) => {
    await addUser('apoteker', t, 'apoteker', 'FARMASI');
    return users.apoteker as string;
  });
  B = await supportTenant();
  await addUser('apotekerRi', A, 'apoteker', 'FARMASI');
  await addUser('apotekerIgd', A, 'apoteker', 'IGD');
  await addUser('apotekerB', B, 'apoteker', 'FARMASI');
  for (const code of ['GUDANG', 'DEPO-RI', 'DEPO-RJ', 'DEPO-IGD']) {
    loc[code] = (await run(A.id, (tx) => tx.stockLocation.findFirstOrThrow({ where: { code } }))).id;
  }
});

afterAll(async () => {
  await app?.close();
});

describe('stok depo di bawah beban (audit BUG, 4.6a)', () => {
  it('mutasi multi-batch serentak dengan urutan item berlawanan: tanpa deadlock/500, saldo = Σ ledger', async () => {
    const [met, pct] = [await batchId('MET-01'), await batchId('PCT-01')];
    const send = (items: Array<{ stockBatchId: string; quantity: number }>) =>
      as('apoteker').post('/stock/transfers', {
        fromStockLocationId: loc.GUDANG,
        toStockLocationId: loc['DEPO-IGD'],
        items,
      });
    const results = await Promise.all(
      Array.from({ length: 16 }, (_, i) =>
        send(
          i % 2 === 0
            ? [
                { stockBatchId: met, quantity: 1 },
                { stockBatchId: pct, quantity: 1 },
              ]
            : [
                { stockBatchId: pct, quantity: 1 },
                { stockBatchId: met, quantity: 1 },
              ],
        ),
      ),
    );
    expect(results.map((r) => r.status).filter((s) => s !== 201)).toEqual([]);
    expect(await ledgerMismatches(A.id)).toBe(0);

    // Terima serentak di depo tujuan (urutan item berlawanan per mutasi): tanpa deadlock.
    const received = await Promise.all(
      results.map((r) => as('apotekerIgd').post(`/stock/transfers/${r.body.id}/receive`)),
    );
    expect(received.map((r) => r.status).filter((s) => s !== 200)).toEqual([]);
    expect(await ledgerMismatches(A.id)).toBe(0);
  });

  it('terima satu mutasi 16× serentak: tepat satu 200, sisanya 409, nol 500; saldo = Σ ledger', async () => {
    const [met, pct] = [await batchId('MET-01'), await batchId('PCT-01')];
    const sent = await as('apoteker')
      .post('/stock/transfers', {
        fromStockLocationId: loc.GUDANG,
        toStockLocationId: loc['DEPO-IGD'],
        items: [
          { stockBatchId: pct, quantity: 3 },
          { stockBatchId: met, quantity: 2 },
        ],
      })
      .expect(201);
    const results = await Promise.all(
      Array.from({ length: 16 }, () => as('apotekerIgd').post(`/stock/transfers/${sent.body.id}/receive`)),
    );
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    expect(statuses.filter((s) => s !== 200 && s !== 409)).toEqual([]);
    const moved = await run(A.id, (tx) =>
      tx.stockMovement.count({ where: { refId: sent.body.id, kind: 'transfer_in' } }),
    );
    expect(moved).toBe(2);
    expect(await ledgerMismatches(A.id)).toBe(0);
  });

  it('penyesuaian dan penerimaan multi-item serentak dengan urutan berlawanan: tanpa deadlock/500', async () => {
    const [enx, omz] = [await batchId('ENX-01'), await batchId('OMZ-01')];
    const adjust = (order: string[]) =>
      as('apoteker').post('/stock/adjustments', {
        stockLocationId: loc.GUDANG,
        items: order.map((stockBatchId) => ({ stockBatchId, quantityDelta: -1 })),
        reason: 'Opname serentak uji urutan kunci',
      });
    const adj = await Promise.all(
      Array.from({ length: 12 }, (_, i) => adjust(i % 2 ? [enx, omz] : [omz, enx])),
    );
    expect(adj.map((r) => r.status).filter((s) => s !== 201)).toEqual([]);

    const supplier = await run(A.id, async (tx) => (await tx.supplier.findFirstOrThrow()).id);
    const drug = (name: string) =>
      run(A.id, async (tx) => (await tx.drug.findFirstOrThrow({ where: { name } })).id);
    const [d1, d2] = [await drug('Parasetamol 500 mg tablet'), await drug('Metformin 500 mg tablet')];
    const tag = newId().slice(-6).toUpperCase();
    const line = (drugId: string, batchNo: string) => ({
      drugId,
      batchNo,
      expiryDate: day(300),
      quantity: 5,
      unitCost: '100',
    });
    const receive = (first: boolean) =>
      as('apoteker').post('/stock/receipts', {
        stockLocationId: loc['DEPO-RJ'],
        supplierId: supplier,
        invoiceNo: `FKT-${tag}`,
        items: first
          ? [line(d1, `X1-${tag}`), line(d2, `X2-${tag}`)]
          : [line(d2, `X2-${tag}`), line(d1, `X1-${tag}`)],
      });
    const rec = await Promise.all(Array.from({ length: 10 }, (_, i) => receive(i % 2 === 0)));
    expect(rec.map((r) => r.status).filter((s) => s !== 201)).toEqual([]);
    // Batch baru serentak = satu baris batch per obat + nomor batch.
    const created = await run(A.id, (tx) => tx.stockBatch.count({ where: { batchNo: { endsWith: tag } } }));
    expect(created).toBe(2);
    expect(await ledgerMismatches(A.id)).toBe(0);
  });

  it('IDOR terima mutasi: RS lain 404 (tanpa mengubah status), lingkup unit lain 403, id acak 404', async () => {
    const sfx = await batchId('SFX-BARU');
    const sent = await as('apoteker')
      .post('/stock/transfers', {
        fromStockLocationId: loc.GUDANG,
        toStockLocationId: loc['DEPO-IGD'],
        items: [{ stockBatchId: sfx, quantity: 2 }],
      })
      .expect(201);
    await as('apotekerB').post(`/stock/transfers/${sent.body.id}/receive`).expect(404);
    await as('apotekerRi').post(`/stock/transfers/${sent.body.id}/receive`).expect(403);
    await as('apotekerIgd').post(`/stock/transfers/${newId()}/receive`).expect(404);
    const t = await run(A.id, (tx) =>
      tx.stockTransfer.findUniqueOrThrow({ where: { id: sent.body.id }, select: { status: true } }),
    );
    expect(t.status).toBe('dikirim');
    // Batch RS lain di kiriman → 404 tanpa dokumen tertinggal.
    const foreign = await run(B.id, (tx) => tx.stockBatch.findFirst({ select: { id: true } }));
    if (foreign) {
      await as('apoteker')
        .post('/stock/transfers', {
          fromStockLocationId: loc.GUDANG,
          toStockLocationId: loc['DEPO-IGD'],
          items: [{ stockBatchId: foreign.id, quantity: 1 }],
        })
        .expect(404);
    }
    await as('apotekerIgd').post(`/stock/transfers/${sent.body.id}/receive`).expect(200);
  });

  it('ledger append-only dan saldo hanya lewat trigger: role aplikasi tidak bisa UPDATE/DELETE', async () => {
    const m = await run(A.id, (tx) => tx.stockMovement.findFirstOrThrow({ select: { id: true } }));
    await expect(
      run(A.id, (tx) => tx.stockMovement.update({ where: { id: m.id }, data: { quantity: 999 } })),
    ).rejects.toThrow();
    await expect(run(A.id, (tx) => tx.stockMovement.delete({ where: { id: m.id } }))).rejects.toThrow();
    await expect(
      run(A.id, (tx) => tx.$executeRaw`UPDATE stock_balances SET quantity = quantity + 1000`),
    ).rejects.toThrow();
    expect(await ledgerMismatches(A.id)).toBe(0);
  });
});
