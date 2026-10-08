/**
 * S08 · Audit agen BUG atas gerbang keselamatan transfusi (4.9): cek ganda dan transfusi serentak (tanpa 500,
 * tepat satu berhasil), petugas yang sama lewat sesi kedua tetap ditolak sebagai petugas kedua. Data fiktif.
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
import { newId } from '@simrs/shared';
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
    put: (url: string, body: object = {}) => http().put(`/api/v1${url}`).set(auth()).send(body),
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
/** Pasien rawat inap di Melati, DPJP = `dokter` (relasi), gelang aktif. */
async function admitted(name = 'Tn. Transfusi Fiktif') {
  const p = await createTestPatient(A.id, { name });
  seq += 1;
  return run(A.id, async (tx) => {
    const enc = await tx.encounter.create({
      data: {
        id: newId(),
        tenantId: A.id,
        number: `BD-RI-${String(Date.now() % 1e5).padStart(5, '0')}${seq}`,
        patientId: p.id,
        encounterClass: 'IMP',
        status: 'in_progress',
        unitId: units.MELATI as string,
        plannedAt: new Date(),
      },
    });
    const pid = newId();
    await tx.encounterParticipant.create({
      data: {
        id: pid,
        tenantId: A.id,
        encounterId: enc.id,
        userId: users.dokter as string,
        role: 'dpjp_utama',
      },
    });
    await tx.accessRelationship.create({
      data: {
        id: newId(),
        tenantId: A.id,
        userId: users.dokter as string,
        patientId: p.id,
        kind: 'dpjp',
        validFrom: new Date(Date.now() - 60_000),
        sourceType: 'encounter_participant',
        sourceId: pid,
      },
    });
    const band = `GL${newId().replace(/-/g, '').slice(-12).toUpperCase()}`;
    await tx.patientWristband.create({
      data: { id: newId(), tenantId: A.id, encounterId: enc.id, patientId: p.id, code: band },
    });
    return { patientId: p.id, encounterId: enc.id, band };
  });
}

async function bag(code: string, abo: string, rh: string, tenant = A) {
  return run(tenant.id, async (tx) => {
    const comp = await tx.bloodComponent.findFirstOrThrow({ where: { code } });
    return tx.bloodUnit.create({
      data: {
        id: newId(),
        tenantId: tenant.id,
        bagNo: `KTG-${code}-${newId().slice(-6).toUpperCase()}`,
        componentId: comp.id,
        abo,
        rh,
        collectedAt: new Date(Date.now() - 2 * 86_400_000),
        expiresAt: new Date(Date.now() + 20 * 86_400_000),
      },
    });
  });
}

const CHECKLIST = { identitas: true, nomor: true, golongan: true, kedaluwarsa: true, kantong_utuh: true };
const ask = (encounterId: string, over: object = {}) => ({
  encounterId,
  componentCode: 'PRC',
  units: 1,
  urgency: 'cito',
  indication: 'Anemia berat Hb 6,1 g/dL',
  patientAbo: null,
  patientRh: null,
  ...over,
});
const VITALS = { tempC: 36.8, systolic: 120, diastolic: 80, pulse: 84 };

beforeAll(async () => {
  app = await createTestApp();
  A = await supportTenant();
  B = await supportTenant();
  for (const code of ['MELATI', 'ANGGREK', 'LAB']) {
    units[code] = (await run(A.id, (tx) => tx.unit.findFirstOrThrow({ where: { code } }))).id;
  }
  for (const [who, t, role, unitCode] of [
    ['dokter', A, 'dokter', 'MELATI'],
    ['dokterLain', A, 'dokter', 'MELATI'],
    ['perawat', A, 'perawat', 'MELATI'],
    ['perawat2', A, 'perawat', 'MELATI'],
    ['perawatAnggrek', A, 'perawat', 'ANGGREK'],
    ['analis', A, 'analis_lab', 'LAB'],
    ['analis2', A, 'analis_lab', 'LAB'],
    ['analis3', A, 'analis_lab', 'LAB'],
    ['rm', A, 'petugas_rm', undefined],
    ['analisB', B, 'analis_lab', 'LAB'],
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

/** Permintaan sampai cek ganda pertama oleh `analis` (kantong belum keluar). */
async function checked(e: { encounterId: string }) {
  const rq = (await as('dokter').post('/blood/requests', ask(e.encounterId)).expect(201)).body;
  await as('analis').post(`/blood/requests/${rq.id}/receive`).expect(201);
  await as('analis').put(`/blood/requests/${rq.id}/group`, { abo: 'A', rh: 'pos' }).expect(200);
  const u = await bag('PRC', 'A', 'pos');
  await as('analis')
    .post('/blood/crossmatches', { bloodRequestId: rq.id, bloodUnitId: u.id, result: 'cocok', method: 'Gel' })
    .expect(201);
  const c = (
    await as('analis')
      .post('/blood/issue-checks', {
        bloodRequestId: rq.id,
        bloodUnitId: u.id,
        checklist: CHECKLIST,
        emergencyReason: null,
      })
      .expect(201)
  ).body;
  return { rq, unit: u, checkId: c.issueChecks[0].id as string };
}

const noServerErrors = (statuses: number[]) => expect(statuses.filter((s) => s >= 500)).toEqual([]);

describe('audit BUG · gerbang transfusi di bawah serentak', () => {
  it('pemeriksa pertama lewat sesi KEDUA (login ulang) tetap ditolak sebagai petugas kedua', async () => {
    const e = await admitted('Tn. Sesi Ganda Fiktif');
    const { checkId } = await checked(e);
    const user = await run(A.id, (tx) =>
      tx.user.findUniqueOrThrow({ where: { id: users.analis as string } }),
    );
    expect(user.id).toBe(users.analis);
    // Sesi baru akun yang sama (perangkat lain): token berbeda, pengguna sama.
    const again = await as('analis').get('/auth/me').expect(200);
    expect(again.body.user.id).toBe(users.analis);
    const res = await as('analis').post('/blood/issues', { issueCheckId: checkId }).expect(409);
    expect(res.body.code).toBe('BLOOD_SECOND_CHECKER_SAME');
  });

  it('dua petugas kedua mengeluarkan kantong serentak dari satu cek ganda: tepat satu 201, tanpa 500', async () => {
    const e = await admitted('Ny. Keluar Serentak Fiktif');
    const { unit, checkId } = await checked(e);
    const res = await Promise.all(
      ['analis2', 'analis3', 'analis2', 'analis3'].map((who) =>
        as(who).post('/blood/issues', { issueCheckId: checkId }),
      ),
    );
    const statuses = res.map((r) => r.status);
    noServerErrors(statuses);
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(await run(A.id, (tx) => tx.bloodIssue.count({ where: { bloodUnitId: unit.id } }))).toBe(1);
  });

  it('pasang kantong serentak (klik ganda) dan verifikasi serentak oleh dua petugas: masing-masing tepat satu', async () => {
    const e = await admitted('Tn. Pasang Serentak Fiktif');
    const { unit, checkId } = await checked(e);
    const issueId = (await as('analis2').post('/blood/issues', { issueCheckId: checkId }).expect(201)).body
      .issues[0].id as string;
    const start = () =>
      as('perawat').post('/blood/transfusions', {
        bloodIssueId: issueId,
        wristbandCode: e.band,
        bagNo: unit.bagNo,
        baseline: VITALS,
      });
    const started = await Promise.all([start(), start(), start()]);
    noServerErrors(started.map((r) => r.status));
    const ok = started.filter((r) => r.status === 201);
    expect(ok).toHaveLength(1);
    const tId = ok[0]?.body.id as string;
    const verified = await Promise.all(
      ['perawat2', 'dokter', 'perawat2'].map((who) =>
        as(who).post(`/blood/transfusions/${tId}/verify`, { wristbandCode: e.band, bagNo: unit.bagNo }),
      ),
    );
    noServerErrors(verified.map((r) => r.status));
    expect(verified.filter((r) => r.status === 201)).toHaveLength(1);
    expect(await run(A.id, (tx) => tx.transfusion.count({ where: { bloodIssueId: issueId } }))).toBe(1);
  });

  it('gelang dicabut (void) tidak bisa dipakai memasang kantong', async () => {
    const e = await admitted('Ny. Gelang Lama Fiktif');
    const { unit, checkId } = await checked(e);
    const issueId = (await as('analis2').post('/blood/issues', { issueCheckId: checkId }).expect(201)).body
      .issues[0].id as string;
    await run(A.id, (tx) =>
      tx.patientWristband.updateMany({
        where: { code: e.band },
        data: {
          voidedAt: new Date(),
          voidedBy: users.perawat as string,
          voidReason: 'Gelang rusak, diganti baru',
        },
      }),
    );
    const res = await as('perawat')
      .post('/blood/transfusions', {
        bloodIssueId: issueId,
        wristbandCode: e.band,
        bagNo: unit.bagNo,
        baseline: VITALS,
      })
      .expect(422);
    expect(res.body.code).toBe('BLOOD_WRONG_PATIENT');
  });
});
