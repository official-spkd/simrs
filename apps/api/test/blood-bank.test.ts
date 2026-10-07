/**
 * Fase 4 · potongan 4.9 · S08 Bank darah (ADR-0105): permintaan DPJP bernomor, terima + golongan + crossmatch, gerbang
 * ABO/Rh per komponen, cek ganda DUA petugas (sesi masing-masing) sebelum kantong keluar, darurat golongan O beralasan,
 * transfusi di samping pasien (gelang ↔ kantong + petugas kedua), TTV + deteksi reaksi, event `blood.unit_issued`,
 * izin (403), ABAC tampilan ruangan vs layanan, dan isolasi tenant. Data fiktif.
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

/** Permintaan → terima → golongan → crossmatch cocok → cek ganda analis → keluar oleh analis2. */
async function issued(e: { encounterId: string }, abo = 'A', rh = 'pos') {
  const rq = (await as('dokter').post('/blood/requests', ask(e.encounterId)).expect(201)).body;
  await as('analis').post(`/blood/requests/${rq.id}/receive`).expect(201);
  await as('analis').put(`/blood/requests/${rq.id}/group`, { abo, rh }).expect(200);
  const u = await bag('PRC', abo, rh);
  await as('analis')
    .post('/blood/crossmatches', { bloodRequestId: rq.id, bloodUnitId: u.id, result: 'cocok', method: 'Gel' })
    .expect(201);
  const checked = (
    await as('analis')
      .post('/blood/issue-checks', {
        bloodRequestId: rq.id,
        bloodUnitId: u.id,
        checklist: CHECKLIST,
        emergencyReason: null,
      })
      .expect(201)
  ).body;
  const out = (
    await as('analis2').post('/blood/issues', { issueCheckId: checked.issueChecks[0].id }).expect(201)
  ).body;
  return { rq: out, unit: u, issueId: out.issues[0].id as string };
}

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

describe('bank darah (S08)', () => {
  it('alur penuh: nomor BD, golongan, crossmatch, cek ganda dua petugas, event blood.unit_issued', async () => {
    const e = await admitted();
    const rq = (await as('dokter').post('/blood/requests', ask(e.encounterId)).expect(201)).body;
    expect(rq.requestNo).toMatch(/^BD-\d{4}-\d{4}$/);
    expect(rq.status).toBe('diminta');
    await as('analis').post(`/blood/requests/${rq.id}/receive`).expect(201);
    const prcA = await bag('PRC', 'A', 'pos');
    // Golongan belum diperiksa → crossmatch ditolak.
    const noGroup = await as('analis')
      .post('/blood/crossmatches', {
        bloodRequestId: rq.id,
        bloodUnitId: prcA.id,
        result: 'cocok',
        method: 'Gel',
      })
      .expect(409);
    expect(noGroup.body.code).toBe('BLOOD_GROUP_REQUIRED');
    await as('analis').put(`/blood/requests/${rq.id}/group`, { abo: 'A', rh: 'pos' }).expect(200);
    const prcB = await bag('PRC', 'B', 'pos');
    const incompatible = await as('analis')
      .post('/blood/crossmatches', {
        bloodRequestId: rq.id,
        bloodUnitId: prcB.id,
        result: 'cocok',
        method: 'Gel',
      })
      .expect(409);
    expect(incompatible.body.code).toBe('BLOOD_INCOMPATIBLE');
    const ffp = await bag('FFP', 'A', 'pos');
    const wrongComponent = await as('analis')
      .post('/blood/crossmatches', {
        bloodRequestId: rq.id,
        bloodUnitId: ffp.id,
        result: 'cocok',
        method: 'Gel',
      })
      .expect(409);
    expect(wrongComponent.body.code).toBe('BLOOD_COMPONENT_MISMATCH');
    await as('analis')
      .post('/blood/crossmatches', {
        bloodRequestId: rq.id,
        bloodUnitId: prcA.id,
        result: 'cocok',
        method: 'Gel',
      })
      .expect(201);
    // Golongan terkunci setelah crossmatch.
    const locked = await as('analis')
      .put(`/blood/requests/${rq.id}/group`, { abo: 'O', rh: 'pos' })
      .expect(409);
    expect(locked.body.code).toBe('BLOOD_GROUP_LOCKED');
    // Butir cek ganda tidak lengkap ditolak validasi.
    await as('analis')
      .post('/blood/issue-checks', {
        bloodRequestId: rq.id,
        bloodUnitId: prcA.id,
        checklist: { ...CHECKLIST, kantong_utuh: false },
        emergencyReason: null,
      })
      .expect(400);
    const checked = (
      await as('analis')
        .post('/blood/issue-checks', {
          bloodRequestId: rq.id,
          bloodUnitId: prcA.id,
          checklist: CHECKLIST,
          emergencyReason: null,
        })
        .expect(201)
    ).body;
    const checkId = checked.issueChecks[0].id as string;
    // Petugas yang sama tidak boleh mengeluarkan (petugas kedua dari sesinya sendiri).
    const same = await as('analis').post('/blood/issues', { issueCheckId: checkId }).expect(409);
    expect(same.body.code).toBe('BLOOD_SECOND_CHECKER_SAME');
    const out = (await as('analis2').post('/blood/issues', { issueCheckId: checkId }).expect(201)).body;
    expect(out.status).toBe('selesai');
    expect(out.issues).toHaveLength(1);
    expect(out.issues[0].checkedBy.id).toBe(users.analis);
    expect(out.issues[0].issuedBy.id).toBe(users.analis2);
    await as('analis2').post('/blood/issues', { issueCheckId: checkId }).expect(409);
    const unit = await run(A.id, (tx) => tx.bloodUnit.findUniqueOrThrow({ where: { id: prcA.id } }));
    expect(unit.status).toBe('dikeluarkan');
    const ev = await run(A.id, (tx) =>
      tx.domainEvent.findFirst({ where: { name: 'blood.unit_issued' }, orderBy: { occurredAt: 'desc' } }),
    );
    expect(ev?.payload).toMatchObject({ bloodRequestId: rq.id, bloodUnitId: prcA.id, emergency: false });
  });

  it('darurat tanpa crossmatch hanya sel darah merah golongan O beralasan (O Rh-negatif bila Rh belum diketahui)', async () => {
    const e = await admitted('Tn. Darurat Fiktif');
    const rq = (
      await as('dokter')
        .post('/blood/requests', ask(e.encounterId, { urgency: 'darurat', units: 2 }))
        .expect(201)
    ).body;
    const aPos = await bag('PRC', 'A', 'pos');
    const oPos = await bag('PRC', 'O', 'pos');
    const oNeg = await bag('PRC', 'O', 'neg');
    const reason = 'Syok hemoragik kelas IV, tidak sempat crossmatch';
    const check = (unitId: string, emergencyReason: string | null) =>
      as('analis').post('/blood/issue-checks', {
        bloodRequestId: rq.id,
        bloodUnitId: unitId,
        checklist: CHECKLIST,
        emergencyReason,
      });
    expect((await check(aPos.id, reason).expect(409)).body.code).toBe('CROSSMATCH_REQUIRED');
    expect((await check(oNeg.id, null).expect(409)).body.code).toBe('CROSSMATCH_REQUIRED');
    expect((await check(oPos.id, reason).expect(409)).body.code).toBe('BLOOD_INCOMPATIBLE');
    const ok = (await check(oNeg.id, reason).expect(201)).body;
    const out = (
      await as('analis2').post('/blood/issues', { issueCheckId: ok.issueChecks[0].id }).expect(201)
    ).body;
    expect(out.issues[0].emergencyReason).toBe(reason);
    expect(out.status).toBe('diproses');
  });

  it('transfusi: gelang ↔ kantong wajib cocok; berjalan setelah petugas kedua; TTV, selesai; dugaan reaksi menghentikan', async () => {
    const e = await admitted('Ny. Bedside Fiktif');
    const { unit, issueId } = await issued(e);
    const start = (over: object = {}) =>
      as('perawat').post('/blood/transfusions', {
        bloodIssueId: issueId,
        wristbandCode: e.band,
        bagNo: unit.bagNo,
        baseline: VITALS,
        ...over,
      });
    const other = await admitted('Tn. Pasien Lain Fiktif');
    expect((await start({ wristbandCode: other.band }).expect(422)).body.code).toBe('BLOOD_WRONG_PATIENT');
    expect((await start({ bagNo: 'KTG-SALAH-01' }).expect(422)).body.code).toBe('BLOOD_WRONG_BAG');
    // Penolakan di samping pasien tercatat walau transaksi batal.
    const denied = await run(A.id, (tx) =>
      tx.auditEvent.count({
        where: { action: 'access_denied', resourceType: 'transfusion', patientId: e.patientId },
      }),
    );
    expect(denied).toBeGreaterThanOrEqual(2);
    const t = (await start({ bagNo: ` ${unit.bagNo.toLowerCase()} ` }).expect(201)).body;
    expect(t.status).toBe('menunggu_verifikasi');
    await as('perawat')
      .post(`/blood/transfusions/${t.id}/vitals`, { label: '15_menit', ...VITALS, signs: [] })
      .expect(409);
    const self = await as('perawat')
      .post(`/blood/transfusions/${t.id}/verify`, { wristbandCode: e.band, bagNo: unit.bagNo })
      .expect(409);
    expect(self.body.code).toBe('BLOOD_SECOND_CHECKER_SAME');
    await as('perawat2')
      .post(`/blood/transfusions/${t.id}/verify`, { wristbandCode: e.band, bagNo: 'KTG-SALAH-02' })
      .expect(422);
    const running = (
      await as('perawat2')
        .post(`/blood/transfusions/${t.id}/verify`, { wristbandCode: e.band, bagNo: unit.bagNo })
        .expect(201)
    ).body;
    expect(running.status).toBe('berjalan');
    expect(running.verifiedBy.id).toBe(users.perawat2);
    await as('perawat').post(`/blood/transfusions/${t.id}/finish`).expect(409);
    const v = (
      await as('perawat')
        .post(`/blood/transfusions/${t.id}/vitals`, { label: '15_menit', ...VITALS, signs: [] })
        .expect(201)
    ).body;
    expect(v.reaction).toBe(false);
    const done = (await as('perawat').post(`/blood/transfusions/${t.id}/finish`).expect(201)).body;
    expect(done.status).toBe('selesai');

    // Kantong kedua: suhu naik 1,5 °C → dugaan reaksi, transfusi dihentikan; laporan reaksi beralasan.
    const second = await issued(e);
    const t2 = (
      await as('perawat')
        .post('/blood/transfusions', {
          bloodIssueId: second.issueId,
          wristbandCode: e.band,
          bagNo: second.unit.bagNo,
          baseline: VITALS,
        })
        .expect(201)
    ).body;
    await as('dokter')
      .post(`/blood/transfusions/${t2.id}/verify`, { wristbandCode: e.band, bagNo: second.unit.bagNo })
      .expect(201);
    const r = (
      await as('perawat')
        .post(`/blood/transfusions/${t2.id}/vitals`, {
          label: '15_menit',
          ...VITALS,
          tempC: 38.3,
          signs: ['Menggigil'],
        })
        .expect(201)
    ).body;
    expect(r.reaction).toBe(true);
    expect(r.reasons).toEqual(['Menggigil', 'Suhu naik 1,5 °C']);
    expect(r.transfusion.status).toBe('dihentikan');
    await as('perawat')
      .post('/blood/reactions', {
        bloodIssueId: second.issueId,
        occurredAt: new Date().toISOString(),
        severity: 'sedang',
        description:
          'Menggigil dan demam 38,3 °C pada menit ke-15; transfusi dihentikan, NaCl 0,9% dipertahankan',
      })
      .expect(201);
    const board = (await as('perawat').get(`/blood/board?encounterId=${e.encounterId}`).expect(200)).body;
    expect(board.view).toBe('ruangan');
    const rq2 = board.requests.find((x: { id: string }) => x.id === second.rq.id);
    expect(rq2.issues[0].reactions).toHaveLength(1);
  });

  it('izin: perawat tidak crossmatch/mengeluarkan, dokter tidak mengeluarkan, RM tanpa akses (403)', async () => {
    const e = await admitted();
    const rq = (await as('dokter').post('/blood/requests', ask(e.encounterId)).expect(201)).body;
    await as('perawat').post(`/blood/requests/${rq.id}/receive`).expect(403);
    await as('perawat').post('/blood/requests', ask(e.encounterId)).expect(403);
    await as('dokter')
      .post('/blood/issue-checks', {
        bloodRequestId: rq.id,
        bloodUnitId: newId(),
        checklist: CHECKLIST,
        emergencyReason: null,
      })
      .expect(403);
    await as('analis')
      .post('/blood/transfusions', {
        bloodIssueId: newId(),
        wristbandCode: 'X',
        bagNo: 'Y',
        baseline: VITALS,
      })
      .expect(403);
    await as('rm').get('/blood/board').expect(403);
  });

  it('ABAC: bank darah melihat semua permintaan aktif; perawat bangsal lain dan dokter tanpa relasi tidak; tenant lain 404', async () => {
    const e = await admitted('Tn. Abac Darah Fiktif');
    const rq = (await as('dokter').post('/blood/requests', ask(e.encounterId)).expect(201)).body;
    const bank = (await as('analis').get('/blood/board').expect(200)).body;
    expect(bank.view).toBe('layanan');
    expect(bank.requests.map((x: { id: string }) => x.id)).toContain(rq.id);
    expect(bank.units.length).toBeGreaterThan(0);
    const ward = (await as('perawat').get('/blood/board').expect(200)).body;
    expect(ward.view).toBe('ruangan');
    expect(ward.requests.map((x: { id: string }) => x.id)).toContain(rq.id);
    expect(ward.units).toEqual([]);
    const elsewhere = (await as('perawatAnggrek').get('/blood/board').expect(200)).body;
    expect(elsewhere.requests.map((x: { id: string }) => x.id)).not.toContain(rq.id);
    await as('perawatAnggrek').get(`/blood/requests/${rq.id}`).expect(403);
    await as('dokterLain').get(`/blood/requests/${rq.id}`).expect(403);
    await as('analisB').get(`/blood/requests/${rq.id}`).expect(404);
    const other = (await as('analisB').get('/blood/board').expect(200)).body;
    expect(other.requests.map((x: { id: string }) => x.id)).not.toContain(rq.id);
  });

  it('stok: kantong masuk tercatat; tanggal tidak masuk akal ditolak', async () => {
    const now = Date.now();
    const u = (
      await as('analis')
        .post('/blood/units', {
          bagNo: `KTG-UTD-${newId().slice(-6)}`,
          componentCode: 'FFP',
          abo: 'AB',
          rh: 'pos',
          collectedAt: new Date(now - 86_400_000).toISOString(),
          expiresAt: new Date(now + 300 * 86_400_000).toISOString(),
        })
        .expect(201)
    ).body;
    expect(u.component.aboRule).toBe('plasma');
    await as('analis')
      .post('/blood/units', {
        bagNo: `KTG-UTD-${newId().slice(-6)}`,
        componentCode: 'PRC',
        abo: 'O',
        rh: 'neg',
        collectedAt: new Date(now).toISOString(),
        expiresAt: new Date(now - 86_400_000).toISOString(),
      })
      .expect(422);
    await as('perawat')
      .post('/blood/units', {
        bagNo: 'KTG-X1',
        componentCode: 'PRC',
        abo: 'O',
        rh: 'neg',
        collectedAt: new Date(now).toISOString(),
        expiresAt: new Date(now + 86_400_000).toISOString(),
      })
      .expect(403);
  });
});
