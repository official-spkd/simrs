/**
 * Fase 4 · 4.7 · S06 Kamar operasi lewat API: jadwal (tumpang tindih 409), batal beralasan, daftar tilik WHO
 * (butir persetujuan diisi sistem, urutan + kelengkapan 409, time out memeriksa ulang persetujuan 3.7), insisi sebelum
 * time out 409 / override dokter beralasan (≥ 15) tercatat + audit + notifikasi mutu, hitung kasa (sign out ditolak bila
 * beda; tindak lanjut membuka), konfirmasi serentak hanya satu, urutan juga ditegakkan DB (SQL langsung), BHP depo OK,
 * laporan operasi ber-TTE operator, isolasi tenant, 403 kasir/apoteker/perawat unit lain. Data fiktif.
 */
import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  createPrismaClient,
  seedClinicalMasters,
  seedFrontOffice,
  seedHospitalStructure,
  seedSupportMasters,
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
let B: { id: string; code: string };
const tok: Record<string, Tokens> = {};
const users: Record<string, string> = {};
const unitA: Record<string, string> = {};
const rooms: string[] = [];

const run = <R>(tenantId: string, fn: (tx: TenantTx) => Promise<R>) => withTenant(testDb(), tenantId, fn);
async function asOwner<R>(tenantId: string, fn: (tx: TenantTx) => Promise<R>) {
  const owner = createPrismaClient({ connectionString: testDbUrls().migrator, max: 1 });
  try {
    return await withTenant(owner, tenantId, fn);
  } finally {
    await owner.$disconnect();
  }
}
const as = (who: string) => {
  const auth = () => bearer(tok[who] as Tokens);
  const http = () => request(app.getHttpServer());
  return {
    get: (url: string) => http().get(`/api/v1${url}`).set(auth()),
    post: (url: string, body: object = {}) =>
      http().post(`/api/v1${url}`).set(auth()).set('Idempotency-Key', newId()).send(body),
  };
};

let seq = 0;
const digits = (n: number) => {
  seq += 1;
  return `${Date.now() % 1e7}${seq}`.padStart(n, '0').slice(-n);
};

async function tenant() {
  const t = await createTestTenant();
  const owner = createPrismaClient({ connectionString: testDbUrls().migrator, max: 1 });
  try {
    await withTenant(owner, t.id, async (tx) => {
      await seedHospitalStructure(tx, t.id);
      await seedClinicalMasters(tx, t.id);
    });
    await seedFrontOffice(owner, t.id);
    await withTenant(owner, t.id, (tx) => seedSupportMasters(tx, t.id));
  } finally {
    await owner.$disconnect();
  }
  return t;
}

/** Pasien IGD aktif (registrasi API). */
async function encounter(tenantId = A.id, who = 'daftar', units = unitA) {
  const p = await createTestPatient(tenantId, {
    name: 'Ratna Fiktif Sari',
    identifiers: { nik: `99990101900${digits(5)}` },
  });
  const r = await as(who)
    .post('/registration/emergency', {
      patient: { kind: 'known', patientId: p.id },
      unitId: units.IGD,
      arrivalMode: 'datang_sendiri',
      coverage: { payer: 'umum' },
    })
    .expect(201);
  return { patientId: p.id, encounterId: r.body.encounter.id as string };
}

/** Jam WIB hari ini + `dayOffset` (jadwal unik per tes agar tidak saling tumpang tindih). */
let slot = 0;
function nextSlot(hours = 1) {
  slot += 1;
  const start = new Date(Date.UTC(2030, 0, 1 + slot, 1, 0)); // 08.00 WIB, hari berbeda tiap kasus
  return {
    startsAt: start.toISOString(),
    endsAt: new Date(start.getTime() + hours * 3_600_000).toISOString(),
  };
}

async function scheduleCase(room = rooms[0] as string, times = nextSlot()) {
  const e = await encounter();
  const r = await as('perawatOk')
    .post('/surgery/cases', {
      encounterId: e.encounterId,
      roomId: room,
      ...times,
      priority: 'elektif',
      procedureName: 'Kolesistektomi laparoskopik',
      procedureCode: '51.23',
      team: [
        { userId: users.dokterOp, role: 'operator' },
        { userId: users.perawatOk, role: 'perawat_sirkuler' },
      ],
    })
    .expect(201);
  return { ...e, caseId: r.body.id as string, times };
}

/** Persetujuan tindakan final `setuju` (3.7) untuk kunjungan ini; isinya cukup untuk trigger klinis. */
async function consent(e: { patientId: string; encounterId: string }) {
  const id = newId();
  await run(A.id, (tx) =>
    tx.consent.create({
      data: {
        id,
        rootId: id,
        tenantId: A.id,
        patientId: e.patientId,
        encounterId: e.encounterId,
        occurredAt: new Date(),
        authorUserId: users.dokterOp as string,
        authorRole: 'dokter',
        procedure: 'Kolesistektomi laparoskopik',
        decision: 'setuju',
        information: Array.from({ length: 7 }, (_, i) => ({ item: i + 1, explained: true })),
        informerUserId: users.dokterOp as string,
        explainedAt: new Date(),
      },
    }),
  );
  return id;
}

const ITEMS = {
  'sign-in': ['sign-in-1', 'sign-in-2', 'sign-in-3', 'sign-in-4', 'sign-in-5'],
  'time-out': ['time-out-1', 'time-out-2', 'time-out-3', 'time-out-4', 'time-out-5'],
  'sign-out': ['sign-out-1', 'sign-out-3', 'sign-out-4', 'sign-out-5'],
} as const;

async function checkAll(caseId: string, phase: keyof typeof ITEMS, who = 'perawatOk') {
  for (const itemCode of ITEMS[phase]) {
    await as(who).post(`/surgery/cases/${caseId}/checklist/items`, { phase, itemCode }).expect(200);
  }
}
const confirm = (caseId: string, phase: string, who = 'perawatOk') =>
  as(who).post(`/surgery/cases/${caseId}/checklist/confirm`, { phase });
const event = (caseId: string, kind: string, overrideReason: string | null = null, who = 'perawatOk') =>
  as(who).post(`/surgery/cases/${caseId}/events`, {
    kind,
    occurredAt: new Date(Date.now() - 60_000).toISOString(),
    overrideReason,
  });

beforeAll(async () => {
  app = await createTestApp();
  A = await tenant();
  B = await tenant();
  for (const u of await run(A.id, (tx) => tx.unit.findMany({ select: { id: true, code: true } })))
    unitA[u.code] = u.id;
  const unitB: Record<string, string> = {};
  for (const u of await run(B.id, (tx) => tx.unit.findMany({ select: { id: true, code: true } })))
    unitB[u.code] = u.id;
  rooms.push(
    ...(
      await run(A.id, (tx) =>
        tx.location.findMany({ where: { unitId: unitA.OK, kind: 'ruang' }, orderBy: { code: 'asc' } }),
      )
    ).map((r) => r.id),
  );
  for (const [who, t, role, unitCode] of [
    ['daftar', A, 'petugas_pendaftaran', undefined],
    ['perawatOk', A, 'perawat', 'OK'],
    ['perawatMelati', A, 'perawat', 'MELATI'],
    ['dokterOp', A, 'dokter', 'OK'],
    ['dokterLain', A, 'dokter', 'MELATI'],
    ['kasir', A, 'kasir', undefined],
    ['apoteker', A, 'apoteker', 'FARMASI'],
    ['mutu', A, 'manajemen', undefined],
    ['perawatOkB', B, 'perawat', 'OK'],
  ] as const) {
    const units = t === A ? unitA : unitB;
    const user = await createTestUser(t.id, {
      roles: [{ code: role, unitId: unitCode ? units[unitCode] : undefined }],
      tenantCode: t.code,
    });
    users[who] = user.id;
    tok[who] = await login(app, user);
  }
});

afterAll(async () => {
  await app?.close();
});

describe('papan dan izin', () => {
  it('perawat unit OK melihat 4 kamar; kasir/apoteker 403; perawat bangsal 403', async () => {
    const board = await as('perawatOk').get('/surgery/board?date=2030-01-02').expect(200);
    expect(board.body.rooms).toHaveLength(4);
    expect(board.body.rooms.map((r: { code: string }) => r.code)).toEqual(['OK-1', 'OK-2', 'OK-3', 'OK-4']);
    await as('kasir').get('/surgery/board').expect(403);
    await as('apoteker').get('/surgery/board').expect(403);
    await as('perawatMelati').get('/surgery/board').expect(403);
    // Calon kasus: kunjungan aktif dicari No. RM (perawat OK, izin jadwal).
    const e = await encounter();
    const mrn = (await run(A.id, (tx) => tx.patient.findUniqueOrThrow({ where: { id: e.patientId } }))).mrn;
    const found = await as('perawatOk')
      .get(`/surgery/candidates?q=${encodeURIComponent(mrn)}`)
      .expect(200);
    expect(found.body.items[0]).toMatchObject({
      encounterId: e.encounterId,
      rm: mrn,
      encounterClass: 'EMER',
    });
    await as('dokterOp')
      .get(`/surgery/candidates?q=${encodeURIComponent(mrn)}`)
      .expect(403);
  });
});

describe('jadwal kamar', () => {
  it('tumpang tindih kasus aktif 409 ROOM_OVERLAP; batal beralasan membebaskan slot; kamar lain boleh', async () => {
    const c = await scheduleCase();
    expect(
      (await run(A.id, (tx) => tx.surgeryCase.findUniqueOrThrow({ where: { id: c.caseId } }))).caseNo,
    ).toMatch(/^OK-\d{4}-\d{4}$/);
    const e = await encounter();
    const clash = {
      encounterId: e.encounterId,
      roomId: rooms[0],
      startsAt: new Date(Date.parse(c.times.startsAt) + 30 * 60_000).toISOString(),
      endsAt: new Date(Date.parse(c.times.endsAt) + 30 * 60_000).toISOString(),
      priority: 'cito',
      procedureName: 'Apendektomi',
      procedureCode: null,
      team: [{ userId: users.dokterOp, role: 'operator' }],
    };
    const r = await as('perawatOk').post('/surgery/cases', clash);
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('ROOM_OVERLAP');
    await as('perawatOk')
      .post('/surgery/cases', { ...clash, roomId: rooms[1] })
      .expect(201);
    await as('perawatOk').post(`/surgery/cases/${c.caseId}/cancel`, { reason: 'pendek' }).expect(400);
    const cancelled = await as('perawatOk')
      .post(`/surgery/cases/${c.caseId}/cancel`, { reason: 'Pasien demam, operasi ditunda' })
      .expect(200);
    expect(cancelled.body).toMatchObject({ status: 'batal', cancelReason: 'Pasien demam, operasi ditunda' });
    await as('perawatOk').post('/surgery/cases', clash).expect(201);
    // Dokter tanpa izin jadwal 403.
    await as('dokterOp').post('/surgery/cases', clash).expect(403);
  });
});

describe('daftar tilik WHO, insisi, hitung kasa', () => {
  it('alur lengkap: persetujuan sistem, urutan, time out, insisi, hitung, sign out, keluar, laporan ber-TTE', async () => {
    const c = await scheduleCase(rooms[2]);
    // Butir persetujuan diisi sistem, tidak bisa dicentang manual.
    const manual = await as('perawatOk').post(`/surgery/cases/${c.caseId}/checklist/items`, {
      phase: 'sign-in',
      itemCode: 'sign-in-consent',
    });
    expect(manual.status).toBe(409);
    expect(manual.body.code).toBe('CHECKLIST_INCOMPLETE');
    await checkAll(c.caseId, 'sign-in');
    // Time out sebelum sign in → 409 CHECKLIST_ORDER; sign in tanpa persetujuan → 409.
    expect((await confirm(c.caseId, 'time-out')).body.code).toBe('CHECKLIST_ORDER');
    const noConsent = await confirm(c.caseId, 'sign-in');
    expect(noConsent.status).toBe(409);
    expect(noConsent.body).toMatchObject({ code: 'CHECKLIST_INCOMPLETE', details: { consent: false } });
    // Induksi sebelum sign in → 409.
    expect((await event(c.caseId, 'induksi')).body.code).toBe('CHECKLIST_ORDER');
    const consentId = await consent(c);
    const signIn = await confirm(c.caseId, 'sign-in').expect(200);
    expect(signIn.body).toMatchObject({ status: 'persiapan', consent: { id: consentId } });
    expect(
      signIn.body.checklist[0].items.find((i: { code: string }) => i.code === 'sign-in-consent'),
    ).toMatchObject({ system: true, checked: true });
    await event(c.caseId, 'induksi').expect(201);
    // Time out sebelum semua butir → 409; insisi sebelum time out → 409.
    await as('perawatOk')
      .post(`/surgery/cases/${c.caseId}/checklist/items`, { phase: 'time-out', itemCode: 'time-out-1' })
      .expect(200);
    expect((await confirm(c.caseId, 'time-out')).body.code).toBe('CHECKLIST_INCOMPLETE');
    expect((await event(c.caseId, 'insisi')).body.code).toBe('TIMEOUT_REQUIRED');
    for (const itemCode of ITEMS['time-out'].slice(1)) {
      await as('perawatOk')
        .post(`/surgery/cases/${c.caseId}/checklist/items`, { phase: 'time-out', itemCode })
        .expect(200);
    }
    await confirm(c.caseId, 'time-out').expect(200);
    await event(c.caseId, 'insisi').expect(201);
    // Hitung: awal 10 kasa, akhir 9 → sign out ditolak; tindak lanjut membuka.
    await as('perawatOk')
      .post(`/surgery/cases/${c.caseId}/counts`, {
        kind: 'awal',
        items: [
          { itemCode: 'kasa', label: 'Kasa', quantity: 10 },
          { itemCode: 'jarum', label: 'Jarum', quantity: 4 },
        ],
      })
      .expect(201);
    await as('perawatOk')
      .post(`/surgery/cases/${c.caseId}/counts`, {
        kind: 'akhir',
        items: [
          { itemCode: 'kasa', label: 'Kasa', quantity: 9 },
          { itemCode: 'jarum', label: 'Jarum', quantity: 4 },
        ],
      })
      .expect(201);
    await event(c.caseId, 'tutup').expect(201);
    await checkAll(c.caseId, 'sign-out');
    const mismatch = await confirm(c.caseId, 'sign-out');
    expect(mismatch.status).toBe(409);
    expect(mismatch.body).toMatchObject({ code: 'COUNT_MISMATCH', details: { items: ['kasa'] } });
    expect((await event(c.caseId, 'keluar')).body.code).toBe('CHECKLIST_ORDER');
    await as('perawatOk')
      .post(`/surgery/cases/${c.caseId}/count-discrepancies`, {
        itemCode: 'kasa',
        action: 'Rontgen intraoperatif: tidak ada kasa tertinggal',
      })
      .expect(201);
    const signOut = await confirm(c.caseId, 'sign-out').expect(200);
    expect(signOut.body.unreconciled).toEqual([]);
    // Laporan: bukan operator 403; operator 201 dengan TTE pending; kedua kali 409.
    const report = {
      preOpDiagnosis: { icd10: 'K80.2', label: 'Batu kandung empedu tanpa kolesistitis' },
      postOpDiagnosis: { icd10: 'K80.2', label: 'Batu kandung empedu tanpa kolesistitis' },
      procedureCodes: ['51.23'],
      findings: 'Kandung empedu berisi batu multipel, dinding tidak menebal.',
      complications: '',
      bloodLossMl: 50,
      implants: '',
      paSpecimen: true,
    };
    await as('dokterLain').post(`/surgery/cases/${c.caseId}/reports`, report).expect(403);
    const rep = await as('dokterOp').post(`/surgery/cases/${c.caseId}/reports`, report).expect(201);
    expect(rep.body.report).toMatchObject({
      version: 1,
      procedureCodes: ['51.23'],
      signatureStatus: 'pending',
    });
    await as('dokterOp').post(`/surgery/cases/${c.caseId}/reports`, report).expect(409);
    const done = await event(c.caseId, 'keluar').expect(201);
    expect(done.body.status).toBe('selesai');
    expect(
      await run(A.id, (tx) =>
        tx.domainEvent.count({
          where: { name: 'surgery.case_completed', payload: { path: ['surgeryCaseId'], equals: c.caseId } },
        }),
      ),
    ).toBe(1);
  });

  it('override insisi: < 15 karakter 400; perawat 403; dokter tercatat + audit + notifikasi mutu', async () => {
    const c = await scheduleCase(rooms[3]);
    await consent(c);
    await checkAll(c.caseId, 'sign-in');
    await confirm(c.caseId, 'sign-in').expect(200);
    await event(c.caseId, 'insisi', 'terlalu pendek').expect(400);
    await event(c.caseId, 'insisi', 'Perdarahan aktif, tidak bisa menunggu time out').expect(403);
    const ok = await event(
      c.caseId,
      'insisi',
      'Perdarahan aktif, tidak bisa menunggu time out',
      'dokterOp',
    ).expect(201);
    expect(ok.body.events.find((e: { kind: string }) => e.kind === 'insisi')).toMatchObject({
      overrideReason: 'Perdarahan aktif, tidak bisa menunggu time out',
    });
    const audit = await run(A.id, (tx) =>
      tx.auditEvent.findFirstOrThrow({ where: { resourceType: 'surgery_event', patientId: c.patientId } }),
    );
    expect(audit.reason).toContain('Perdarahan aktif');
    expect(
      await run(A.id, (tx) =>
        tx.notification.count({ where: { recipientUserId: users.mutu, kind: 'surgery_override' } }),
      ),
    ).toBeGreaterThanOrEqual(1);
  });

  it('time out memeriksa ulang persetujuan: dicabut sesudah sign in → 409', async () => {
    const c = await scheduleCase(rooms[1]);
    const consentId = await consent(c);
    await checkAll(c.caseId, 'sign-in');
    await confirm(c.caseId, 'sign-in').expect(200);
    await checkAll(c.caseId, 'time-out');
    await run(A.id, async (tx) => {
      const v1 = await tx.consent.findUniqueOrThrow({ where: { id: consentId } });
      const id = newId();
      await tx.consent.create({
        data: {
          id,
          rootId: id,
          tenantId: A.id,
          patientId: v1.patientId,
          encounterId: v1.encounterId,
          addendumOf: v1.id,
          occurredAt: new Date(),
          authorUserId: users.dokterOp as string,
          authorRole: 'dokter',
          procedure: v1.procedure,
          decision: 'dicabut',
          refusalReason: 'Pasien mencabut persetujuan sebelum operasi',
          information: Array.from({ length: 7 }, (_, i) => ({ item: i + 1, explained: true })),
          informerUserId: users.dokterOp as string,
          explainedAt: new Date(),
        },
      });
    });
    const r = await confirm(c.caseId, 'time-out');
    expect(r.status).toBe(409);
    expect(r.body.message).toContain('dicabut');
  });

  it('dua konfirmasi sign in serentak: hanya satu; urutan juga ditegakkan DB (SQL langsung)', async () => {
    const c = await scheduleCase(rooms[0]);
    await consent(c);
    await checkAll(c.caseId, 'sign-in');
    const both = await Promise.all([confirm(c.caseId, 'sign-in'), confirm(c.caseId, 'sign-in')]);
    expect(both.map((r) => r.status).sort()).toEqual([200, 409]);
    await expect(
      run(A.id, (tx) =>
        tx.surgicalSafetyConfirmation.create({
          data: {
            id: newId(),
            tenantId: A.id,
            surgeryCaseId: c.caseId,
            phase: 'sign-out',
            confirmedBy: users.perawatOk as string,
          },
        }),
      ),
    ).rejects.toThrow(/CHECKLIST_ORDER/);
    await expect(
      run(A.id, (tx) =>
        tx.surgeryEvent.create({
          data: {
            id: newId(),
            tenantId: A.id,
            surgeryCaseId: c.caseId,
            kind: 'insisi',
            occurredAt: new Date(),
            recordedBy: users.perawatOk as string,
          },
        }),
      ),
    ).rejects.toThrow(/TIMEOUT_REQUIRED/);
  });
});

describe('BHP depo OK, lingkup, isolasi', () => {
  it('BHP mengurangi saldo depo OK; melebihi saldo 409', async () => {
    const c = await scheduleCase(rooms[3]);
    const batch = await asOwner(A.id, async (tx) => {
      const depot = await tx.stockLocation.findFirstOrThrow({ where: { code: 'DEPO-OK' } });
      const drug = await tx.drug.findFirstOrThrow({ where: { name: 'Seftriakson 2 g injeksi' } });
      const supplier = await tx.supplier.findFirstOrThrow();
      const receiptId = newId();
      await tx.stockReceipt.create({
        data: {
          id: receiptId,
          tenantId: A.id,
          receiptNo: `TRM-3001-${digits(4)}`,
          stockLocationId: depot.id,
          supplierId: supplier.id,
          invoiceNo: 'FKT-OK-UJI',
          receivedBy: users.perawatOk as string,
        },
      });
      const batchId = newId();
      await tx.stockBatch.create({
        data: {
          id: batchId,
          tenantId: A.id,
          drugId: drug.id,
          batchNo: `SFX-OK-${digits(4)}`,
          expiryDate: new Date('2031-01-01'),
          unitCost: 18_500n,
          supplierId: supplier.id,
        },
      });
      await tx.stockMovement.create({
        data: {
          id: newId(),
          tenantId: A.id,
          stockLocationId: depot.id,
          stockBatchId: batchId,
          kind: 'receipt',
          quantity: 5,
          refType: 'stock_receipts',
          refId: receiptId,
          createdBy: users.perawatOk as string,
        },
      });
      return batchId;
    });
    const opts = await as('perawatOk').get('/surgery/supplies/options').expect(200);
    expect(opts.body.items.find((i: { stockBatchId: string }) => i.stockBatchId === batch)).toMatchObject({
      quantity: 5,
    });
    const r = await as('perawatOk')
      .post(`/surgery/cases/${c.caseId}/supplies`, {
        items: [{ stockBatchId: batch, quantity: 2, implant: false }],
      })
      .expect(201);
    expect(r.body.supplies).toEqual([expect.objectContaining({ quantity: 2, implant: false })]);
    const over = await as('perawatOk').post(`/surgery/cases/${c.caseId}/supplies`, {
      items: [{ stockBatchId: batch, quantity: 10, implant: false }],
    });
    expect(over.status).toBe(409);
    expect(over.body.code).toBe('STOCK_INSUFFICIENT');
  });

  it('dokter tanpa relasi 403; dokter di tim melihat kasus; tenant lain 404', async () => {
    const c = await scheduleCase(rooms[2]);
    await as('dokterLain').get(`/surgery/cases/${c.caseId}`).expect(403);
    await as('dokterOp').get(`/surgery/cases/${c.caseId}`).expect(200);
    const board = await as('dokterOp')
      .get(`/surgery/board?date=${c.times.startsAt.slice(0, 10)}`)
      .expect(200);
    expect(
      board.body.rooms.flatMap((r: { cases: Array<{ id: string }> }) => r.cases.map((x) => x.id)),
    ).toContain(c.caseId);
    await as('perawatOkB').get(`/surgery/cases/${c.caseId}`).expect(404);
  });
});
