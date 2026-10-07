/** K12 · API eMAR/askep: izin, ABAC, RLS, gelang, cek ganda sesi kedua, konkurensi dosis dan staging. Data fiktif. */
import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  createPrismaClient,
  seedClinicalMasters,
  seedHospitalStructure,
  type TenantTx,
  withTenant,
} from '@simrs/db';
import { testDbUrls } from '@simrs/db/testing';
import {
  emarBoardSchema,
  isoDateJakarta,
  medicationAdministrationRecordSchema,
  newId,
  nursingCarePlanRecordSchema,
} from '@simrs/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bearer,
  createTestApp,
  createTestPatient,
  createTestTenant,
  createTestUser,
  login,
  testDb,
  type Tokens,
} from './helpers';

let app: NestExpressApplication;
let A: { id: string; code: string };
let B: { id: string; code: string };
const users: Record<string, string> = {};
const tok: Record<string, Tokens> = {};
const run = <R>(tenantId: string, fn: (tx: TenantTx) => Promise<R>) => withTenant(testDb(), tenantId, fn);
const as = (who = 'nurse') => ({
  get: (url: string) =>
    request(app.getHttpServer())
      .get(`/api/v1${url}`)
      .set(bearer(tok[who] as Tokens)),
  post: (url: string, data: object) =>
    request(app.getHttpServer())
      .post(`/api/v1${url}`)
      .set(bearer(tok[who] as Tokens))
      .send(data),
});

beforeAll(async () => {
  app = await createTestApp();
  A = await createTestTenant();
  B = await createTestTenant();
  const owner = createPrismaClient({ connectionString: testDbUrls().migrator, max: 1 });
  try {
    for (const t of [A, B])
      await withTenant(owner, t.id, async (tx) => {
        await seedHospitalStructure(tx, t.id);
        await seedClinicalMasters(tx, t.id);
      });
  } finally {
    await owner.$disconnect();
  }
  for (const [who, t, role, unitCode] of [
    ['nurse', A, 'perawat', 'MELATI'],
    ['second', A, 'perawat', 'MELATI'],
    ['wrongUnit', A, 'perawat', 'ANGGREK'],
    ['doctor', A, 'dokter', 'MELATI'],
    ['otherTenant', B, 'perawat', 'MELATI'],
  ] as const) {
    const unit = await run(t.id, (tx) => tx.unit.findFirstOrThrow({ where: { code: unitCode } }));
    const u = await createTestUser(t.id, { roles: [{ code: role, unitId: unit.id }], tenantCode: t.code });
    users[who] = u.id;
    tok[who] = await login(app, u);
  }
});
afterAll(async () => {
  await app?.close();
});

async function fixture(opts: { high?: boolean; frequency?: string; late?: boolean; future?: boolean } = {}) {
  const p = await createTestPatient(A.id, { name: 'Pasien eMAR Fiktif' });
  return run(A.id, async (tx) => {
    const unit = await tx.unit.findFirstOrThrow({ where: { code: 'MELATI' } });
    const enc = await tx.encounter.create({
      data: {
        id: newId(),
        tenantId: A.id,
        number: `N-${newId()}`,
        patientId: p.id,
        encounterClass: 'IMP',
        status: 'in_progress',
        unitId: unit.id,
        plannedAt: new Date(),
      },
    });
    const group = await tx.orderGroup.create({
      data: {
        id: newId(),
        tenantId: A.id,
        encounterId: enc.id,
        patientId: p.id,
        idempotencyKey: newId(),
        requestHash: 'b'.repeat(64),
        orderedBy: users.doctor as string,
        orderedRole: 'dokter',
      },
    });
    const drug = await tx.drug.findFirstOrThrow({
      where: { name: opts.high ? 'Enoksaparin 60 mg/0,6 mL injeksi' : 'Seftriakson 2 g injeksi' },
    });
    const med = await tx.medicationRequest.create({
      data: {
        id: newId(),
        tenantId: A.id,
        orderGroupId: group.id,
        encounterId: enc.id,
        patientId: p.id,
        drugId: drug.id,
        name: drug.name,
        dose: '1 ampul',
        route: 'IV',
        frequency: opts.frequency ?? '3x1',
        highAlert: !!opts.high,
      },
    });
    await tx.orderStatusEvent.create({
      data: {
        id: newId(),
        tenantId: A.id,
        medicationRequestId: med.id,
        status: 'aktif',
        changedBy: users.doctor as string,
      },
    });
    const slot = ['stat', 'prn'].includes(med.frequency)
      ? null
      : await tx.medicationSchedule.create({
          data: {
            id: newId(),
            tenantId: A.id,
            medicationRequestId: med.id,
            encounterId: enc.id,
            scheduledAt: new Date(Date.now() + (opts.late ? -7_200_000 : opts.future ? 7_200_000 : 60_000)),
          },
        });
    const band = await tx.patientWristband.create({
      data: {
        id: newId(),
        tenantId: A.id,
        encounterId: enc.id,
        patientId: p.id,
        code: `GL${newId().replaceAll('-', '').slice(-12).toUpperCase()}`,
        issuedBy: users.nurse as string,
      },
    });
    return { enc, med, slot, band };
  });
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function scanned(f: Fixture, who = 'nurse') {
  const r = await as(who)
    .post('/nursing/wristband-scans', { encounterId: f.enc.id, code: f.band.code })
    .expect(201);
  return r.body.id as string;
}
const dose = (f: Fixture, scanId: string, over: object = {}) => ({
  medicationRequestId: f.med.id,
  scheduleId: f.slot?.id ?? null,
  scanId,
  labelCode: f.med.id,
  status: 'given',
  occurredAt: new Date().toISOString(),
  reason: null,
  doubleCheckUserId: null,
  ...over,
});

describe('eMAR', () => {
  it('pindaian salah tetap tersimpan dan diaudit sebelum 422; dokter tidak berizin pemberian', async () => {
    const f = await fixture();
    await as('doctor')
      .post('/nursing/wristband-scans', { encounterId: f.enc.id, code: f.band.code })
      .expect(403);
    await as().post('/nursing/wristband-scans', { encounterId: f.enc.id, code: 'SALAH' }).expect(422);
    await run(A.id, async (tx) => {
      expect(await tx.wristbandScan.count({ where: { encounterId: f.enc.id, matched: false } })).toBe(1);
      expect(
        await tx.auditEvent.count({
          where: { patientId: f.enc.patientId, resourceType: 'wristband_scan', outcome: 'denied' },
        }),
      ).toBe(1);
    });
  });

  it('tanpa scan, milik petugas lain, label salah, dan scan kedaluwarsa ditolak', async () => {
    const f = await fixture();
    const scan = await scanned(f);
    await as().post('/nursing/administrations', dose(f, newId())).expect(422);
    await as('second').post('/nursing/administrations', dose(f, scan)).expect(422);
    await as()
      .post('/nursing/administrations', dose(f, scan, { labelCode: newId() }))
      .expect(422);
    await run(A.id, (tx) =>
      tx.tenantSetting.upsert({
        where: { tenantId_key: { tenantId: A.id, key: 'emar.scan_valid_minutes' } },
        create: { tenantId: A.id, key: 'emar.scan_valid_minutes', value: 0 },
        update: { value: 0 },
      }),
    );
    await as().post('/nursing/administrations', dose(f, scan)).expect(422);
    await run(A.id, (tx) =>
      tx.tenantSetting.update({
        where: { tenantId_key: { tenantId: A.id, key: 'emar.scan_valid_minutes' } },
        data: { value: 10 },
      }),
    );
  });

  it('tenant lain 404 dan unit lain 403 untuk scan, board, pemberian, dan cek ganda', async () => {
    const f = await fixture({ high: true });
    const scan = await scanned(f);
    for (const [who, status] of [
      ['otherTenant', 404],
      ['wrongUnit', 403],
    ] as const) {
      await as(who).get(`/nursing/emar/${f.enc.id}`).expect(status);
      await as(who)
        .post('/nursing/wristband-scans', { encounterId: f.enc.id, code: f.band.code })
        .expect(status);
      await as(who).post('/nursing/administrations', dose(f, scan)).expect(status);
      const { doubleCheckUserId: _unused, ...body } = dose(f, scan);
      await as(who).post('/nursing/double-checks', body).expect(status);
    }
  });

  it('dosis serentak hanya sekali; staging held, biaya dan event ikut transaksi', async () => {
    const f = await fixture();
    const scan = await scanned(f);
    const body = dose(f, scan);
    const r = await Promise.all([
      as().post('/nursing/administrations', body),
      as().post('/nursing/administrations', body),
    ]);
    expect(r.map((r) => r.status).sort(), JSON.stringify(r.map((r) => r.body))).toEqual([201, 409]);
    const record = r.find((r) => r.status === 201)?.body;
    expect(medicationAdministrationRecordSchema.safeParse(record).success).toBe(true);
    await run(A.id, async (tx) => {
      expect(await tx.medicationAdministration.count({ where: { medicationRequestId: f.med.id } })).toBe(1);
      expect(await tx.billableEvent.count({ where: { sourceId: record.id, kind: 'obat' } })).toBe(1);
      const out = await tx.outboxMessage.findFirstOrThrow({
        where: {
          operation: 'satusehat.medicationadministration.upsert',
          payload: { path: ['sourceId'], equals: record.id },
        },
      });
      expect(out.status).toBe('held');
      expect(out.payload).toEqual({ sourceId: record.id, revision: 1 });
      expect(
        await tx.domainEvent.count({
          where: {
            name: 'medication.administered',
            payload: { path: ['administrationId'], equals: record.id },
          },
        }),
      ).toBe(1);
    });
    const board = await as().get(`/nursing/emar/${f.enc.id}`).expect(200);
    expect(emarBoardSchema.safeParse(board.body).success).toBe(true);
    // Aturan pakai tampil berlabel di layar perawat, bukan kode frekuensi mentah.
    expect(
      board.body.orders.find((m: { medicationRequestId: string }) => m.medicationRequestId === f.med.id).sig,
    ).toMatch(/ · 3×1 \(tiap 8 jam\)$/);
    expect(
      board.body.orders
        .find((m: { medicationRequestId: string }) => m.medicationRequestId === f.med.id)
        .slots.find((s: { scheduleId: string }) => s.scheduleId === f.slot?.id).state,
    ).toBe('diberikan');
  });

  it('telat wajib alasan berdasarkan jam server; ditunda dapat dilanjutkan menjadi given', async () => {
    const f = await fixture({ late: true });
    const scan = await scanned(f);
    await as().post('/nursing/administrations', dose(f, scan)).expect(422);
    await as()
      .post(
        '/nursing/administrations',
        dose(f, scan, { status: 'held', reason: 'Pasien sedang menjalani pemeriksaan' }),
      )
      .expect(201);
    const r = await as()
      .post(
        '/nursing/administrations',
        dose(f, scan, { reason: 'Pasien kembali dari pemeriksaan penunjang' }),
      )
      .expect(201);
    expect(r.body.late).toBe(true);
    const future = await fixture({ future: true });
    await as()
      .post('/nursing/administrations', dose(future, await scanned(future)))
      .expect(409);
  });

  it('high-alert memerlukan atestasi sesi kedua; ID palsu, cek sendiri dan perubahan isi ditolak', async () => {
    const f = await fixture({ high: true });
    const scan = await scanned(f);
    const body = dose(f, scan);
    await as()
      .post('/nursing/administrations', { ...body, doubleCheckUserId: users.second })
      .expect(422);
    const { doubleCheckUserId: _unused, ...checking } = body;
    await as().post('/nursing/double-checks', checking).expect(422);
    const c = await as('second').post('/nursing/double-checks', checking);
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    expect(c.body.userId).toBe(users.second);
    await as()
      .post('/nursing/administrations', {
        ...body,
        reason: 'Mengubah isi setelah pemeriksaan dosis',
        doubleCheckId: c.body.id,
      })
      .expect(422);
    const r = await as()
      .post('/nursing/administrations', { ...body, doubleCheckId: c.body.id })
      .expect(201);
    expect(r.body.doubleCheckedBy.userId).toBe(users.second);
  });

  it('gelang dicetak ulang membatalkan scan; order batal dan encounter selesai tidak menerima dosis', async () => {
    const f = await fixture();
    const scan = await scanned(f);
    await run(A.id, (tx) =>
      tx.patientWristband.update({
        where: { id: f.band.id },
        data: { voidedAt: new Date(), voidedBy: users.nurse, voidReason: 'Cetak ulang gelang pasien' },
      }),
    );
    await as().post('/nursing/administrations', dose(f, scan)).expect(422);
    const cancelled = await fixture();
    const cancelledScan = await scanned(cancelled);
    await run(A.id, (tx) =>
      tx.orderStatusEvent.create({
        data: {
          id: newId(),
          tenantId: A.id,
          medicationRequestId: cancelled.med.id,
          status: 'dibatalkan',
          reason: 'Terapi dihentikan oleh dokter',
          changedBy: users.doctor as string,
        },
      }),
    );
    await as().post('/nursing/administrations', dose(cancelled, cancelledScan)).expect(409);
    const ended = await fixture();
    const endedScan = await scanned(ended);
    await run(A.id, (tx) =>
      tx.encounter.update({ where: { id: ended.enc.id }, data: { status: 'finished' } }),
    );
    await as().post('/nursing/administrations', dose(ended, endedScan)).expect(403);
  });

  it('stat hanya sekali; PRN dosis berikutnya membutuhkan scan baru; order terjadwal tidak boleh melewati scheduleId', async () => {
    for (const frequency of ['stat', 'prn']) {
      const f = await fixture({ frequency });
      const scan = await scanned(f);
      await as().post('/nursing/administrations', dose(f, scan)).expect(201);
      await as().post('/nursing/administrations', dose(f, scan)).expect(409);
      const again = await scanned(f);
      await as()
        .post('/nursing/administrations', dose(f, again))
        .expect(frequency === 'stat' ? 409 : 201);
    }
    const f = await fixture();
    await as()
      .post('/nursing/administrations', dose(f, await scanned(f), { scheduleId: null }))
      .expect(422);
  });

  it('order aktif membentuk jadwal dinamis idempoten dari frekuensi dan batas durasi di WIB', async () => {
    const f = await fixture();
    const date = isoDateJakarta(new Date(Date.now() + 86_400_000));
    const drug = await run(A.id, (tx) =>
      tx.drug.findFirstOrThrow({ where: { name: 'Seftriakson 2 g injeksi' } }),
    );
    const r = await request(app.getHttpServer())
      .post('/api/v1/orders/submit')
      .set(bearer(tok.doctor as Tokens))
      .set('Idempotency-Key', newId())
      .send({
        encounterId: f.enc.id,
        orderSetId: null,
        items: [
          {
            type: 'obat',
            drugId: drug.id,
            compound: null,
            dose: '2 g',
            route: 'IV',
            frequency: '2x1',
            customTimes: ['07.00', '19.00'],
            durationDays: 2,
            instructions: null,
            override: 'Order klinis fiktif untuk uji jadwal',
          },
        ],
      })
      .expect(201);
    const med = r.body.medicationRequests[0];
    const board = await as().get(`/nursing/emar/${f.enc.id}?date=${date}`).expect(200);
    const order = board.body.orders.find(
      (m: { medicationRequestId: string }) => m.medicationRequestId === med.id,
    );
    expect(order.slots.map((s: { time: string }) => s.time)).toEqual(['07.00', '19.00']);
    await as().get(`/nursing/emar/${f.enc.id}?date=${date}`).expect(200);
    await run(A.id, async (tx) =>
      expect(
        await tx.medicationSchedule.count({
          where: { medicationRequestId: med.id, scheduledAt: { gte: new Date(`${date}T00:00:00+07:00`) } },
        }),
      ).toBe(2),
    );
  });

  it('selisih jam klien kecil dinormalisasi; pemberian yang dibalik waktunya ditolak', async () => {
    const f = await fixture();
    const scanId = await scanned(f);
    const scan = await run(A.id, (tx) => tx.wristbandScan.findUniqueOrThrow({ where: { id: scanId } }));
    await as()
      .post(
        '/nursing/administrations',
        dose(f, scanId, { occurredAt: new Date(scan.scannedAt.getTime() - 60_000).toISOString() }),
      )
      .expect(422);
    const r = await as()
      .post(
        '/nursing/administrations',
        dose(f, scanId, { occurredAt: new Date(scan.scannedAt.getTime() - 1000).toISOString() }),
      )
      .expect(201);
    expect(new Date(r.body.at).getTime()).toBe(scan.scannedAt.getTime());
  });
});

describe('asuhan dan cairan', () => {
  it('askep append-only, koreksi versi baru oleh penulis; izin unit dan tenant dijaga', async () => {
    const f = await fixture();
    const diagnoses = await as().get('/nursing/diagnoses').expect(200);
    const body = {
      encounterId: f.enc.id,
      diagnosisId: diagnoses.body[0].id,
      goals: 'Risiko jatuh berkurang',
      interventions: ['Dampingi mobilisasi pasien'],
      evaluation: null,
      occurredAt: new Date().toISOString(),
      revision: { kind: 'baru' },
    };
    const r = await as().post('/nursing/care-plans', body).expect(201);
    expect(nursingCarePlanRecordSchema.safeParse(r.body).success).toBe(true);
    await as('second')
      .post('/nursing/care-plans', {
        ...body,
        revision: {
          kind: 'koreksi',
          supersedesId: r.body.id,
          correctionReason: 'Perbaikan tujuan asuhan pasien',
        },
      })
      .expect(403);
    const corrected = await as()
      .post('/nursing/care-plans', {
        ...body,
        goals: 'Mobilisasi dengan pendamping',
        revision: {
          kind: 'koreksi',
          supersedesId: r.body.id,
          correctionReason: 'Perbaikan tujuan asuhan pasien',
        },
      })
      .expect(201);
    expect(corrected.body.version).toBe(2);
    const list = await as().get(`/nursing/care-plans/${f.enc.id}`).expect(200);
    expect(list.body.map((r: { id: string }) => r.id)).toEqual([corrected.body.id]);
    await as('otherTenant').get(`/nursing/care-plans/${f.enc.id}`).expect(404);
    await as('wrongUnit').post('/nursing/care-plans', body).expect(403);
  });

  it('balans cairan dihitung dari observasi versi terkini, bukan menjumlahkan koreksi dua kali', async () => {
    const f = await fixture();
    const body = {
      encounterId: f.enc.id,
      direction: 'intake',
      route: 'oral',
      volumeMl: 300,
      note: null,
      occurredAt: new Date().toISOString(),
      revision: { kind: 'baru' },
    };
    const r = await as().post('/nursing/fluid-balances', body).expect(201);
    await as()
      .post('/nursing/fluid-balances', {
        ...body,
        volumeMl: 500,
        revision: {
          kind: 'koreksi',
          supersedesId: r.body.id,
          correctionReason: 'Perbaikan volume cairan masuk',
        },
      })
      .expect(201);
    await as()
      .post('/nursing/fluid-balances', { ...body, direction: 'output', route: 'urin', volumeMl: 200 })
      .expect(201);
    const result = await as().get(`/nursing/fluid-balances/${f.enc.id}`).expect(200);
    expect(result.body).toMatchObject({ intakeMl: 500, outputMl: 200, balanceMl: 300 });
    expect(result.body.entries).toHaveLength(2);
    await as('otherTenant').get(`/nursing/fluid-balances/${f.enc.id}`).expect(404);
  });
});
