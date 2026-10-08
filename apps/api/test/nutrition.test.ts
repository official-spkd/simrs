/**
 * Fase 4 · potongan 4.9 · S07 Gizi (ADR-0105): order diet (satu aktif per kunjungan), daftar makan per bangsal × jam
 * makan (label: dua pengenal + alergi), layanan makan + sisa makanan append-only, izin (403), tampilan layanan (ahli
 * gizi) vs ruangan (perawat bangsal, ABAC), dan isolasi tenant. Data fiktif.
 */
import {
  createPrismaClient,
  seedClinicalMasters,
  seedHospitalStructure,
  seedSupportMasters,
  type TenantTx,
  withTenant,
} from '@simrs/db';
import { testDbUrls } from '@simrs/db/testing';
import {
  dietOrderRecordSchema,
  encounterNutritionSchema,
  npoRecordSchema,
  nutritionScreeningRecordSchema,
  isoDateJakarta,
  mealListSchema,
  mealServiceRecordSchema,
  newId,
} from '@simrs/shared';
import type { NestExpressApplication } from '@nestjs/platform-express';
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
let B: { id: string; code: string };
const tok: Record<string, Tokens> = {};
const users: Record<string, string> = {};
const units: Record<string, string> = {};
const diet: Record<string, string> = {};

const run = <R>(tenantId: string, fn: (tx: TenantTx) => Promise<R>) => withTenant(testDb(), tenantId, fn);
const owner = <R>(tenantId: string, fn: (tx: TenantTx) => Promise<R>) => {
  const c = createPrismaClient({ connectionString: testDbUrls().migrator, max: 1 });
  return withTenant(c, tenantId, fn).finally(() => c.$disconnect());
};
const as = (who: string) => {
  const auth = () => bearer(tok[who] as Tokens);
  const http = () => request(app.getHttpServer());
  return {
    get: (url: string) => http().get(`/api/v1${url}`).set(auth()),
    post: (url: string, body: object = {}) => http().post(`/api/v1${url}`).set(auth()).send(body),
  };
};

async function supportTenant() {
  const t = await createTestTenant();
  await owner(t.id, async (tx) => {
    await seedHospitalStructure(tx, t.id);
    await seedClinicalMasters(tx, t.id);
    await seedSupportMasters(tx, t.id);
  });
  return t;
}

let seq = 0;
async function admitted(unit: 'MELATI' | 'ANGGREK', name: string) {
  const p = await createTestPatient(A.id, { name });
  seq += 1;
  return run(A.id, async (tx) => {
    const enc = await tx.encounter.create({
      data: {
        id: newId(),
        tenantId: A.id,
        number: `GZ-RI-${String(Date.now() % 1e5).padStart(5, '0')}${seq}`,
        patientId: p.id,
        encounterClass: 'IMP',
        status: 'in_progress',
        unitId: units[unit] as string,
        plannedAt: new Date(),
      },
    });
    return { patientId: p.id, encounterId: enc.id, name };
  });
}

const today = isoDateJakarta();
const order = (encounterId: string, over: object = {}) => ({
  encounterId,
  dietTypeId: diet.NB,
  texture: 'biasa',
  notes: null,
  startsOn: today,
  ...over,
});

beforeAll(async () => {
  app = await createTestApp();
  A = await supportTenant();
  B = await supportTenant();
  for (const code of ['MELATI', 'ANGGREK']) {
    units[code] = (await run(A.id, (tx) => tx.unit.findFirstOrThrow({ where: { code } }))).id;
  }
  for (const code of ['NB', 'DM-1700', 'LUNAK']) {
    diet[code] = (await run(A.id, (tx) => tx.dietType.findFirstOrThrow({ where: { code } }))).id;
  }
  for (const [who, t, role, unitCode] of [
    ['gizi', A, 'ahli_gizi', undefined],
    ['perawat', A, 'perawat', 'MELATI'],
    ['perawatAnggrek', A, 'perawat', 'ANGGREK'],
    ['kasir', A, 'kasir', undefined],
    ['giziB', B, 'ahli_gizi', undefined],
  ] as const) {
    const unitId = unitCode
      ? (await run(t.id, (tx) => tx.unit.findFirstOrThrow({ where: { code: unitCode } }))).id
      : undefined;
    const user = await createTestUser(t.id, { roles: [{ code: role, unitId }], tenantCode: t.code });
    users[who] = user.id;
    tok[who] = await login(app, user);
  }
});

afterAll(async () => {
  await app?.close();
});

/** Skrining MST oleh perawat lalu verifikasi ahli gizi (syarat antar makanan, 4.9b). */
async function verified(encounterId: string, dietOrderId: string) {
  await as('perawat')
    .post('/nutrition/screenings', { encounterId, weightLoss: 'tidak', poorAppetite: false })
    .expect(201);
  await as('gizi').post(`/nutrition/diet-orders/${dietOrderId}/verify`).expect(201);
}

describe('gizi (S07)', () => {
  it('order diet: satu aktif per kunjungan (order baru menutup yang lama); jenis diet nonaktif ditolak', async () => {
    const e = await admitted('MELATI', 'Ny. Diet Fiktif');
    const first = (await as('perawat').post('/nutrition/diet-orders', order(e.encounterId)).expect(201)).body;
    expect(first.status).toBe('aktif');
    dietOrderRecordSchema.parse(first);
    const second = (
      await as('gizi')
        .post(
          '/nutrition/diet-orders',
          order(e.encounterId, { dietTypeId: diet['DM-1700'], texture: 'lunak', notes: 'Tanpa santan' }),
        )
        .expect(201)
    ).body;
    const list = (await as('perawat').get(`/encounters/${e.encounterId}/diet-orders`).expect(200)).body;
    expect(list.map((d: { id: string; status: string }) => [d.id, d.status])).toEqual([
      [second.id, 'aktif'],
      [first.id, 'selesai'],
    ]);
    await run(A.id, (tx) =>
      tx.dietType.update({ where: { id: diet.LUNAK as string }, data: { active: false } }),
    );
    await as('gizi')
      .post('/nutrition/diet-orders', order(e.encounterId, { dietTypeId: diet.LUNAK }))
      .expect(422);
    await run(A.id, (tx) =>
      tx.dietType.update({ where: { id: diet.LUNAK as string }, data: { active: true } }),
    );
    const ended = (await as('gizi').post(`/nutrition/diet-orders/${second.id}/end`).expect(201)).body;
    expect(ended.status).toBe('selesai');
    await as('gizi').post(`/nutrition/diet-orders/${second.id}/end`).expect(409);
  });

  it('daftar makan per jam makan: ahli gizi melihat semua bangsal; perawat hanya bangsalnya; label dua pengenal + alergi', async () => {
    const melati = await admitted('MELATI', 'Tn. Makan Melati');
    const anggrek = await admitted('ANGGREK', 'Tn. Makan Anggrek');
    await as('perawat')
      .post('/nutrition/diet-orders', order(melati.encounterId, { notes: 'Alergi udang' }))
      .expect(201);
    await as('perawatAnggrek').post('/nutrition/diet-orders', order(anggrek.encounterId)).expect(201);
    const all = (await as('gizi').get(`/nutrition/meal-list?date=${today}&meal=siang`).expect(200)).body;
    expect(all.view).toBe('layanan');
    mealListSchema.parse(all);
    const names = all.rows.map((r: { patient: { name: string } }) => r.patient.name);
    expect(names).toEqual(expect.arrayContaining(['Tn. Makan Melati', 'Tn. Makan Anggrek']));
    const row = all.rows.find((r: { encounterId: string }) => r.encounterId === melati.encounterId);
    expect(row.patient.mrn).toBeTruthy();
    expect(row.patient.unitName).toBe('Bangsal Melati');
    expect(row.notes).toBe('Alergi udang');
    expect(Array.isArray(row.allergies)).toBe(true);
    expect(all.units.map((u: { name: string }) => u.name)).toEqual(
      expect.arrayContaining(['Bangsal Melati', 'Bangsal Anggrek']),
    );
    const onlyMelati = (
      await as('gizi').get(`/nutrition/meal-list?date=${today}&meal=siang&unitId=${units.MELATI}`).expect(200)
    ).body;
    expect(onlyMelati.rows.every((r: { unitId: string }) => r.unitId === units.MELATI)).toBe(true);
    const ward = (await as('perawat').get(`/nutrition/meal-list?date=${today}&meal=siang`).expect(200)).body;
    expect(ward.view).toBe('ruangan');
    const wardNames = ward.rows.map((r: { patient: { name: string } }) => r.patient.name);
    expect(wardNames).toContain('Tn. Makan Melati');
    expect(wardNames).not.toContain('Tn. Makan Anggrek');
    // Perawat bangsal lain tidak bisa mengorder/mencatat untuk pasien Melati.
    await as('perawatAnggrek').post('/nutrition/diet-orders', order(melati.encounterId)).expect(403);
    // Tenant lain tidak melihat apa pun dari RS ini.
    const other = (await as('giziB').get(`/nutrition/meal-list?date=${today}&meal=siang`).expect(200)).body;
    expect(other.rows.map((r: { encounterId: string }) => r.encounterId)).not.toContain(melati.encounterId);
    await as('giziB').get(`/encounters/${melati.encounterId}/diet-orders`).expect(404);
  });

  it('layanan makan + sisa makanan: append-only, baris terbaru berlaku, waktu masa depan ditolak', async () => {
    const e = await admitted('MELATI', 'Ny. Sisa Makan Fiktif');
    const d = (await as('perawat').post('/nutrition/diet-orders', order(e.encounterId)).expect(201)).body;
    const servedAt = new Date(Date.now() - 30 * 60_000).toISOString();
    // 4.9b: order belum diverifikasi ahli gizi → tidak diantar.
    const unverified = await as('gizi')
      .post('/nutrition/meal-services', { dietOrderId: d.id, meal: 'siang', servedAt, leftover: null })
      .expect(409);
    expect(unverified.body.code).toBe('DIET_NOT_VERIFIED');
    await verified(e.encounterId, d.id);
    await as('gizi')
      .post('/nutrition/meal-services', { dietOrderId: d.id, meal: 'siang', servedAt, leftover: null })
      .expect(201);
    const after = (
      await as('perawat')
        .post('/nutrition/meal-services', {
          dietOrderId: d.id,
          meal: 'siang',
          servedAt,
          leftover: 'sisa_setengah',
        })
        .expect(201)
    ).body;
    expect(after.recordedBy.id).toBe(users.perawat);
    mealServiceRecordSchema.parse(after);
    const list = (
      await as('perawat')
        .get(`/nutrition/meal-list?date=${isoDateJakarta(servedAt)}&meal=siang`)
        .expect(200)
    ).body;
    const row = list.rows.find((r: { dietOrderId: string }) => r.dietOrderId === d.id);
    expect(row.service.leftover).toBe('sisa_setengah');
    await as('perawat')
      .post('/nutrition/meal-services', {
        dietOrderId: d.id,
        meal: 'malam',
        servedAt: new Date(Date.now() + 3 * 3_600_000).toISOString(),
        leftover: null,
      })
      .expect(422);
    await expect(
      run(A.id, (tx) => tx.mealService.update({ where: { id: after.id }, data: { leftover: 'habis' } })),
    ).rejects.toThrow();
  });

  it('izin: kasir tanpa akses gizi (403); kunjungan rawat jalan ditolak (409)', async () => {
    await as('kasir').get(`/nutrition/meal-list?date=${today}&meal=pagi`).expect(403);
    await as('kasir').get('/nutrition/diet-types').expect(403);
    const types = (await as('gizi').get('/nutrition/diet-types').expect(200)).body;
    expect(types.map((t: { code: string }) => t.code)).toContain('NB');
    const p = await createTestPatient(A.id, { name: 'Tn. Rawat Jalan Fiktif' });
    const amb = await run(A.id, (tx) =>
      tx.encounter.create({
        data: {
          id: newId(),
          tenantId: A.id,
          number: `GZ-RJ-${String(Date.now() % 1e6)}`,
          patientId: p.id,
          encounterClass: 'AMB',
          status: 'in_progress',
          unitId: units.MELATI as string,
        },
      }),
    );
    await as('gizi').post('/nutrition/diet-orders', order(amb.id)).expect(409);
  });

  it('4.9b: skrining MST dihitung server; verifikasi hanya ahli gizi dan butuh skrining; puasa menahan antar sampai dicabut', async () => {
    const e = await admitted('MELATI', 'Tn. Puasa Fiktif');
    const d = (await as('perawat').post('/nutrition/diet-orders', order(e.encounterId)).expect(201)).body;
    expect(d.verifiedBy).toBeNull();
    // Perawat tidak memegang `nutrition.verify`.
    await as('perawat').post(`/nutrition/diet-orders/${d.id}/verify`).expect(403);
    const noScreen = await as('gizi').post(`/nutrition/diet-orders/${d.id}/verify`).expect(409);
    expect(noScreen.body.code).toBe('NUTRITION_SCREENING_REQUIRED');
    const sc = (
      await as('perawat')
        .post('/nutrition/screenings', { encounterId: e.encounterId, weightLoss: '6_10', poorAppetite: true })
        .expect(201)
    ).body;
    expect(sc).toMatchObject({ score: 3, atRisk: true });
    nutritionScreeningRecordSchema.parse(sc);
    const v = (await as('gizi').post(`/nutrition/diet-orders/${d.id}/verify`).expect(201)).body;
    expect(v.verifiedBy.id).toBe(users.gizi);
    expect((await as('gizi').post(`/nutrition/diet-orders/${d.id}/verify`).expect(409)).body.code).toBe(
      'DIET_VERIFIED',
    );
    // Puasa: satu aktif, alasan wajib, antar ditolak sampai dicabut.
    await as('perawat')
      .post('/nutrition/npo', { encounterId: e.encounterId, reason: 'pendek', plannedUntil: null })
      .expect(400);
    const npo = (
      await as('perawat')
        .post('/nutrition/npo', {
          encounterId: e.encounterId,
          reason: 'Persiapan endoskopi pukul 13.00',
          plannedUntil: new Date(Date.now() + 3 * 3_600_000).toISOString(),
        })
        .expect(201)
    ).body;
    await as('perawat')
      .post('/nutrition/npo', {
        encounterId: e.encounterId,
        reason: 'Persiapan endoskopi ulang',
        plannedUntil: null,
      })
      .expect(409);
    const servedAt = new Date().toISOString();
    const held = await as('gizi')
      .post('/nutrition/meal-services', { dietOrderId: d.id, meal: 'siang', servedAt, leftover: null })
      .expect(409);
    expect(held.body.code).toBe('NPO_ACTIVE');
    const list = (await as('gizi').get(`/nutrition/meal-list?date=${today}&meal=siang`).expect(200)).body;
    const row = list.rows.find((r: { dietOrderId: string }) => r.dietOrderId === d.id);
    expect(row).toMatchObject({ verified: true, npo: { reason: 'Persiapan endoskopi pukul 13.00' } });
    expect(row.screening).toMatchObject({ score: 3, atRisk: true });
    const lifted = (await as('perawat').post(`/nutrition/npo/${npo.id}/lift`).expect(201)).body;
    npoRecordSchema.parse(lifted);
    expect(lifted.liftedBy.id).toBe(users.perawat);
    await as('perawat').post(`/nutrition/npo/${npo.id}/lift`).expect(409);
    await as('gizi')
      .post('/nutrition/meal-services', { dietOrderId: d.id, meal: 'siang', servedAt, leftover: null })
      .expect(201);
    const all = (await as('perawat').get(`/encounters/${e.encounterId}/nutrition`).expect(200)).body;
    encounterNutritionSchema.parse(all);
    expect(all.npo).toHaveLength(1);
    expect(all.screenings).toHaveLength(1);
    await expect(
      run(A.id, (tx) => tx.nutritionScreening.update({ where: { id: sc.id }, data: { score: 0 } })),
    ).rejects.toThrow();
  });
});
