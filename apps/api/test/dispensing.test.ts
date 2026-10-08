/**
 * Fase 4 · potongan 4.6b · S05 dispensing: FEFO (batch ED terdekat keluar dulu, batch kedaluwarsa tidak pernah),
 * override FEFO beralasan, `BATCH_EXPIRED`/`STOCK_INSUFFICIENT` 409, klik ganda satu efek, cek ganda apoteker lain,
 * serah high alert tanpa cek ganda 409, titik tagih saat serah, retur memulihkan saldo, label farmasi dipindai eMAR
 * (tanpa tagihan ganda), lingkup depo, isolasi tenant. Data fiktif.
 */
import type { NestExpressApplication } from '@nestjs/platform-express';
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
import { newId } from '@simrs/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bearer,
  createTestApp,
  createTestPatient,
  createTestTenant,
  createTestUser,
  login,
  type Tokens,
  testDb,
} from './helpers';

let app: NestExpressApplication;
let A: { id: string; code: string };
const tok: Record<string, Tokens> = {};
const users: Record<string, string> = {};

const run = <R>(tenantId: string, fn: (tx: TenantTx) => Promise<R>) => withTenant(testDb(), tenantId, fn);
const as = (who: string) => {
  const auth = () => bearer(tok[who] as Tokens);
  const http = () => request(app.getHttpServer());
  return {
    get: (url: string) => http().get(`/api/v1${url}`).set(auth()),
    post: (url: string, body: object = {}, key: string | null = null) => {
      const req = http().post(`/api/v1${url}`).set(auth());
      return (key ? req.set('Idempotency-Key', key) : req).send(body);
    },
  };
};

async function supportTenant(stockActor: (t: { id: string; code: string }) => Promise<string>) {
  const t = await createTestTenant();
  const owner = createPrismaClient({ connectionString: testDbUrls().migrator, max: 1 });
  try {
    await withTenant(owner, t.id, async (tx) => {
      await seedHospitalStructure(tx, t.id);
      await seedClinicalMasters(tx, t.id);
      await seedSupportMasters(tx, t.id);
    });
    const actor = await stockActor(t);
    await withTenant(owner, t.id, (tx) => seedSupportStock(tx, t.id, actor));
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
  return user.id;
}

const drugId = (name: string) =>
  run(A.id, async (tx) => (await tx.drug.findFirstOrThrow({ where: { name } })).id);
const batchId = (batchNo: string) =>
  run(A.id, async (tx) => (await tx.stockBatch.findFirstOrThrow({ where: { batchNo } })).id);
const depotRi = () =>
  run(A.id, async (tx) => (await tx.stockLocation.findFirstOrThrow({ where: { code: 'DEPO-RI' } })).id);
const balance = (batchNo: string) =>
  run(A.id, async (tx) => {
    const loc = await tx.stockLocation.findFirstOrThrow({ where: { code: 'DEPO-RI' } });
    const b = await tx.stockBatch.findFirstOrThrow({ where: { batchNo } });
    return (
      (
        await tx.stockBalance.findUnique({
          where: {
            tenantId_stockLocationId_stockBatchId: {
              tenantId: A.id,
              stockLocationId: loc.id,
              stockBatchId: b.id,
            },
          },
        })
      )?.quantity ?? 0
    );
  });

let seq = 0;
/** Pasien rawat inap aktif di MELATI dengan gelang aktif. */
async function inpatient() {
  const p = await createTestPatient(A.id, { name: 'Pasien Dispensing Fiktif' });
  seq += 1;
  return run(A.id, async (tx) => {
    const unit = await tx.unit.findFirstOrThrow({ where: { code: 'MELATI' } });
    const enc = await tx.encounter.create({
      data: {
        id: newId(),
        tenantId: A.id,
        number: `RI-DSP-${String(Date.now() % 1e5).padStart(5, '0')}${seq}`,
        patientId: p.id,
        encounterClass: 'IMP',
        status: 'in_progress',
        unitId: unit.id,
        plannedAt: new Date(),
      },
    });
    const band = await tx.patientWristband.create({
      data: {
        id: newId(),
        tenantId: A.id,
        encounterId: enc.id,
        patientId: p.id,
        code: `GL${newId().replaceAll('-', '').slice(-12).toUpperCase()}`,
        issuedBy: users.perawat as string,
      },
    });
    return { patientId: p.id, encounterId: enc.id, band: band.code };
  });
}

const injection = (drug: string, frequency = 'stat') => ({
  type: 'obat',
  drugId: drug,
  compound: null,
  dose: '1 ampul',
  route: 'intravena',
  frequency,
  customTimes: null,
  durationDays: 3,
  instructions: null,
  override: null,
});

/** CPOE → terima farmasi → konfirmasi semua temuan yang menahan → setujui. Hasil: resep berstatus penyiapan. */
async function approvedPrescription(e: { encounterId: string }, items: object[]) {
  const g = await as('dokter')
    .post('/orders/submit', { encounterId: e.encounterId, orderSetId: null, items }, newId())
    .expect(201);
  const p = await as('apoteker')
    .post('/pharmacy/prescriptions', { orderGroupId: g.body.id, stockLocationId: await depotRi() })
    .expect(201);
  for (const a of p.body.alerts.filter((x: { blocking: boolean }) => x.blocking)) {
    await as('apoteker')
      .post(`/pharmacy/prescriptions/${p.body.id}/alerts/${a.id}/decision`, {
        decision: 'konfirmasi',
        reason: null,
      })
      .expect(200);
  }
  const ok = await as('apoteker')
    .post(`/pharmacy/prescriptions/${p.body.id}/reviews`, {
      aspects: { administratif: true, farmasetik: true, klinis: true },
      decision: 'setujui',
      reason: null,
      medicationRequestIds: [],
    })
    .expect(201);
  expect(ok.body.status).toBe('penyiapan');
  return ok.body as { id: string; items: Array<{ id: string; name: string }> };
}

beforeAll(async () => {
  app = await createTestApp();
  A = await supportTenant((t) => addUser('apoteker', t, 'apoteker', 'FARMASI'));
  // Tenant kedua: isolasi (apoteker B tidak melihat penyiapan RS A).
  await supportTenant((t) => addUser('apotekerB', t, 'apoteker', 'FARMASI'));
  await addUser('apoteker2', A, 'apoteker', 'FARMASI');
  await addUser('apotekerIgd', A, 'apoteker', 'IGD');
  await addUser('dokter', A, 'dokter', 'MELATI');
  await addUser('perawat', A, 'perawat', 'MELATI');
});

afterAll(async () => {
  await app?.close();
});

describe('penyiapan FEFO', () => {
  it('FEFO: batch kedaluwarsa dilewati, ED terdekat keluar dulu lalu dipecah; ledger dispense ber-pasien; label OBT; resep → serah', async () => {
    const e = await inpatient();
    const rx = await approvedPrescription(e, [injection(await drugId('Seftriakson 2 g injeksi'))]);
    const med = rx.items[0]?.id as string;
    // Seed DEPO-RI: SFX-LAMA (kedaluwarsa) 5, SFX-DEKAT 8, SFX-BARU 25.
    const before = {
      lama: await balance('SFX-LAMA'),
      dekat: await balance('SFX-DEKAT'),
      baru: await balance('SFX-BARU'),
    };
    expect(before.lama).toBe(5);

    await as('apoteker')
      .post(`/dispensing/prescriptions/${rx.id}/prepare`, {
        items: [{ medicationRequestId: med, quantity: 1, stockBatchId: null, fefoOverrideReason: null }],
      })
      .expect(400); // tanpa Idempotency-Key

    const key = newId();
    const body = {
      items: [
        {
          medicationRequestId: med,
          quantity: before.dekat + 2,
          stockBatchId: null,
          fefoOverrideReason: null,
        },
      ],
    };
    const r = await as('apoteker').post(`/dispensing/prescriptions/${rx.id}/prepare`, body, key).expect(201);
    expect(r.body.items.map((i: { batchNo: string; quantity: number }) => [i.batchNo, i.quantity])).toEqual(
      expect.arrayContaining([
        ['SFX-DEKAT', before.dekat],
        ['SFX-BARU', 2],
      ]),
    );
    expect(r.body.items).toHaveLength(2);
    for (const i of r.body.items) expect(i.labelBarcode).toMatch(/^OBT-[0-9A-F]{12}$/);
    expect(r.body).toMatchObject({ hasHighAlert: false, doubleCheck: null, handover: null });

    // Klik ganda dengan kunci sama: satu efek.
    const again = await as('apoteker')
      .post(`/dispensing/prescriptions/${rx.id}/prepare`, body, key)
      .expect(200);
    expect(again.body.id).toBe(r.body.id);
    expect(await balance('SFX-DEKAT')).toBe(0);
    expect(await balance('SFX-BARU')).toBe(before.baru - 2);
    expect(await balance('SFX-LAMA')).toBe(5);

    const stored = await run(A.id, async (tx) => ({
      moves: await tx.stockMovement.findMany({
        where: { refId: r.body.id },
        select: { kind: true, quantity: true, patientId: true, encounterId: true },
      }),
      status: (await tx.pharmacyPrescription.findUniqueOrThrow({ where: { id: rx.id } })).status,
    }));
    expect(stored.status).toBe('serah');
    expect(stored.moves).toHaveLength(2);
    for (const m of stored.moves) {
      expect(m).toMatchObject({ kind: 'dispense', patientId: e.patientId, encounterId: e.encounterId });
      expect(m.quantity).toBeLessThan(0);
    }
    // Resep sudah serah: penyiapan kedua (kunci lain) ditolak.
    await as('apoteker').post(`/dispensing/prescriptions/${rx.id}/prepare`, body, newId()).expect(409);
  });

  it('override FEFO tanpa alasan 400; batch kedaluwarsa 409 BATCH_EXPIRED; saldo kurang 409 STOCK_INSUFFICIENT; telaah belum selesai 409', async () => {
    const e = await inpatient();
    const rx = await approvedPrescription(e, [injection(await drugId('Seftriakson 2 g injeksi'))]);
    const med = rx.items[0]?.id as string;
    const prep = (item: object) =>
      as('apoteker').post(
        `/dispensing/prescriptions/${rx.id}/prepare`,
        {
          items: [
            { medicationRequestId: med, quantity: 1, stockBatchId: null, fefoOverrideReason: null, ...item },
          ],
        },
        newId(),
      );
    await prep({ stockBatchId: await batchId('SFX-BARU') }).expect(400);
    const expired = await prep({
      stockBatchId: await batchId('SFX-LAMA'),
      fefoOverrideReason: 'Mencoba batch lama untuk uji keselamatan',
    }).expect(409);
    expect(expired.body.code).toBe('BATCH_EXPIRED');
    const short = await prep({
      stockBatchId: await batchId('SFX-BARU'),
      quantity: 9999,
      fefoOverrideReason: 'Pasien perlu stok untuk beberapa hari',
    }).expect(409);
    expect(short.body.code).toBe('STOCK_INSUFFICIENT');
    const fefoShort = await prep({ quantity: 9999 }).expect(409);
    expect(fefoShort.body.code).toBe('STOCK_INSUFFICIENT');
    const manual = await prep({
      stockBatchId: await batchId('SFX-BARU'),
      fefoOverrideReason: 'Batch dekat sudah habis disiapkan ke bangsal lain',
    }).expect(201);
    expect(manual.body.items[0]).toMatchObject({
      batchNo: 'SFX-BARU',
      fefoOverrideReason: expect.stringContaining('Batch dekat'),
    });

    // Resep yang belum lolos telaah tidak bisa disiapkan.
    const g = await as('dokter')
      .post(
        '/orders/submit',
        {
          encounterId: e.encounterId,
          orderSetId: null,
          items: [injection(await drugId('Omeprazol 40 mg injeksi'))],
        },
        newId(),
      )
      .expect(201);
    const p = await as('apoteker')
      .post('/pharmacy/prescriptions', { orderGroupId: g.body.id, stockLocationId: await depotRi() })
      .expect(201);
    await as('apoteker')
      .post(
        `/dispensing/prescriptions/${p.body.id}/prepare`,
        {
          items: [
            {
              medicationRequestId: p.body.items[0].id,
              quantity: 1,
              stockBatchId: null,
              fefoOverrideReason: null,
            },
          ],
        },
        newId(),
      )
      .expect(409);
  });
});

describe('cek ganda, serah terima, retur, eMAR', () => {
  it('high alert: serah tanpa cek ganda 409; penyiap tidak boleh cek ganda; apoteker kedua → serah → tagihan + event; retur layak/tidak layak; eMAR memindai label', async () => {
    const e = await inpatient();
    const rx = await approvedPrescription(e, [injection(await drugId('Insulin glargine 100 unit/mL pen'))]);
    const med = rx.items[0]?.id as string;
    const insBefore = await balance('INS-01');
    const d = await as('apoteker')
      .post(
        `/dispensing/prescriptions/${rx.id}/prepare`,
        { items: [{ medicationRequestId: med, quantity: 2, stockBatchId: null, fefoOverrideReason: null }] },
        newId(),
      )
      .expect(201);
    expect(d.body.hasHighAlert).toBe(true);
    const label = d.body.items[0].labelBarcode as string;
    const handover = { receiverKind: 'perawat', receiverName: 'Ns. Penerima Fiktif', counselingGiven: true };

    const noCheck = await as('apoteker')
      .post(`/dispensing/dispenses/${d.body.id}/handover`, handover)
      .expect(409);
    expect(noCheck.body.code).toBe('HIGH_ALERT_DOUBLE_CHECK_REQUIRED');
    const same = await as('apoteker').post(`/dispensing/dispenses/${d.body.id}/double-check`).expect(409);
    expect(same.body.code).toBe('DOUBLE_CHECK_SAME_USER');
    await as('apotekerIgd').post(`/dispensing/dispenses/${d.body.id}/double-check`).expect(403);
    await as('apotekerB').post(`/dispensing/dispenses/${d.body.id}/double-check`).expect(404);
    const checked = await as('apoteker2').post(`/dispensing/dispenses/${d.body.id}/double-check`).expect(200);
    expect(checked.body.doubleCheck.by.userId).toBe(users.apoteker2);

    // Retur sebelum serah ditolak.
    await as('apoteker')
      .post(
        `/dispensing/dispenses/${d.body.id}/returns`,
        {
          items: [{ dispenseItemId: d.body.items[0].id, quantity: 1, condition: 'layak' }],
          reason: 'Pasien pulang lebih awal',
        },
        newId(),
      )
      .expect(409);

    const done = await as('apoteker')
      .post(`/dispensing/dispenses/${d.body.id}/handover`, handover)
      .expect(200);
    expect(done.body.handover).toMatchObject({ receiverKind: 'perawat', by: { userId: users.apoteker } });
    const billed = await run(A.id, async (tx) => ({
      billable: await tx.billableEvent.findMany({
        where: { encounterId: e.encounterId, kind: 'obat' },
        select: { sourceType: true, quantity: true },
      }),
      event: await tx.domainEvent.findFirst({
        where: { name: 'pharmacy.dispensed', payload: { path: ['dispenseId'], equals: d.body.id } },
        select: { payload: true },
      }),
      status: (await tx.pharmacyPrescription.findUniqueOrThrow({ where: { id: rx.id } })).status,
    }));
    expect(billed.billable).toEqual([{ sourceType: 'dispense_items', quantity: 2 }]);
    expect(billed.event?.payload).toMatchObject({
      pharmacyPrescriptionId: rx.id,
      dispenseItemIds: [d.body.items[0].id],
    });
    expect(billed.status).toBe('selesai');
    await as('apoteker').post(`/dispensing/dispenses/${d.body.id}/handover`, handover).expect(409);

    // Label untuk eMAR: perawat bangsal membaca; apoteker tanpa izin pemberian obat 403.
    const l = await as('perawat').get(`/dispensing/labels/${label}`).expect(200);
    expect(l.body).toMatchObject({
      medicationRequestId: med,
      handedOver: true,
      highAlert: true,
      quantity: 2,
    });
    await as('perawat').get('/dispensing/labels/OBT-000000000000').expect(404);
    await as('apoteker').get(`/dispensing/labels/${label}`).expect(403);

    // eMAR memindai etiket farmasi: dosis tercatat, tidak ada tagihan kedua (ditagih saat serah).
    const scan = await as('perawat')
      .post('/nursing/wristband-scans', { encounterId: e.encounterId, code: e.band })
      .expect(201);
    const doseBody = {
      medicationRequestId: med,
      scheduleId: null,
      scanId: scan.body.id,
      labelCode: label,
      status: 'given',
      occurredAt: new Date().toISOString(),
      reason: null,
    };
    // Obat high alert: cek ganda perawat kedua dulu (ADR-0077) memakai label yang sama.
    await addUser('perawat2', A, 'perawat', 'MELATI');
    const check = await as('perawat2').post('/nursing/double-checks', doseBody);
    expect(check.status, JSON.stringify(check.body)).toBe(201);
    await as('perawat')
      .post('/nursing/administrations', {
        ...doseBody,
        labelCode: 'OBT-FFFFFFFFFFFF',
        doubleCheckId: check.body.id,
        doubleCheckUserId: null,
      })
      .expect(422);
    const given = await as('perawat').post('/nursing/administrations', {
      ...doseBody,
      doubleCheckId: check.body.id,
      doubleCheckUserId: null,
    });
    expect(given.status, JSON.stringify(given.body)).toBe(201);
    const emar = await run(A.id, async (tx) => ({
      billable: await tx.billableEvent.count({
        where: { encounterId: e.encounterId, sourceType: 'medication_administrations' },
      }),
      event: await tx.domainEvent.findFirst({
        where: { name: 'medication.administered', payload: { path: ['medicationRequestId'], equals: med } },
        select: { payload: true },
      }),
    }));
    expect(emar.billable).toBe(0);
    expect(emar.event?.payload).toMatchObject({ wardStock: false });

    // Retur: layak 1 kembali ke saldo; tidak layak 1 dicatat tanpa saldo; melebihi → 409.
    const item = d.body.items[0].id as string;
    const afterHandover = await balance('INS-01');
    expect(afterHandover).toBe(insBefore - 2);
    await as('apoteker')
      .post(
        `/dispensing/dispenses/${d.body.id}/returns`,
        {
          items: [{ dispenseItemId: item, quantity: 3, condition: 'layak' }],
          reason: 'Pasien pulang lebih awal',
        },
        newId(),
      )
      .expect(409);
    // Perawat: retur hanya untuk pasien yang dirawatnya (lingkup relasi).
    const nurseReturn = {
      items: [
        { dispenseItemId: item, quantity: 1, condition: 'layak' },
        { dispenseItemId: item, quantity: 1, condition: 'tidak_layak' },
      ],
      reason: 'Pasien pulang lebih awal, satu pen rusak',
    };
    await as('perawat').post(`/dispensing/dispenses/${d.body.id}/returns`, nurseReturn, newId()).expect(403);
    await run(A.id, (tx) =>
      tx.accessRelationship.create({
        data: {
          id: newId(),
          tenantId: A.id,
          userId: users.perawat as string,
          patientId: e.patientId,
          kind: 'perawat_penanggung_jawab',
        },
      }),
    );
    const ret = await as('perawat')
      .post(
        `/dispensing/dispenses/${d.body.id}/returns`,
        {
          items: [
            { dispenseItemId: item, quantity: 1, condition: 'layak' },
            { dispenseItemId: item, quantity: 1, condition: 'tidak_layak' },
          ],
          reason: 'Pasien pulang lebih awal, satu pen rusak',
        },
        newId(),
      )
      .expect(201);
    expect(ret.body.items[0].returned).toBe(2);
    expect(ret.body.returns.map((r: { restocked: boolean }) => r.restocked).sort()).toEqual([false, true]);
    expect(await balance('INS-01')).toBe(insBefore - 1);
    const returned = await run(A.id, (tx) =>
      tx.domainEvent.count({
        where: { name: 'pharmacy.returned', payload: { path: ['dispenseId'], equals: d.body.id } },
      }),
    );
    expect(returned).toBe(2);
    await as('apoteker')
      .post(
        `/dispensing/dispenses/${d.body.id}/returns`,
        {
          items: [{ dispenseItemId: item, quantity: 1, condition: 'layak' }],
          reason: 'Pasien pulang lebih awal',
        },
        newId(),
      )
      .expect(409);

    // Saldo = Σ ledger untuk batch ini di semua lokasi.
    const ledger = await run(A.id, async (tx) => {
      const b = await tx.stockBatch.findFirstOrThrow({ where: { batchNo: 'INS-01' } });
      const sum = await tx.stockMovement.aggregate({
        where: { stockBatchId: b.id },
        _sum: { quantity: true },
      });
      const bal = await tx.stockBalance.aggregate({
        where: { stockBatchId: b.id },
        _sum: { quantity: true },
      });
      return [sum._sum.quantity, bal._sum.quantity];
    });
    expect(ledger[0]).toBe(ledger[1]);

    const view = await as('apoteker').get(`/dispensing/prescriptions/${rx.id}/dispenses`).expect(200);
    expect(view.body).toHaveLength(1);
    await as('apotekerB').get(`/dispensing/dispenses/${d.body.id}`).expect(404);
  });
});
