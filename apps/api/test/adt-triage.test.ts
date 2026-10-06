/**
 * Fase 3 · potongan 3.3 · ADT, papan bed, triase IGD, gelang, Aplicare (K03/K04/K05) lewat API: saran triase dari
 * server (turun tanpa alasan 422, di bawah batas protokol 422), status bed berversi (409), alokasi ganda dan hunian
 * ganda (409), admisi dari IGD (gelang, DPJP di tim, IGD selesai disposisi rawat inap, SEP rawat inap, outbox
 * Aplicare, staging biaya), transfer memindah lingkup unit, pulang (bed kotor, gelang batal), boarding > 4 jam di
 * papan, SEP IGD otomatis/menyusul, aliran SSE papan IGD + papan bed (potret awal, tanpa bocor antar-tenant).
 * Data fiktif.
 */
import type { AddressInfo } from 'node:net';
import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  createPrismaClient,
  seedClinicalMasters,
  seedFrontOffice,
  seedHospitalStructure,
  type TenantTx,
  withTenant,
} from '@simrs/db';
import { testDbUrls } from '@simrs/db/testing';
import { BPJS_APLICARE_UPDATE_OPERATION, BPJS_SEP_INSERT_OPERATION, newId } from '@simrs/shared';
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
let port: number;
let A: { id: string; code: string };
let B: { id: string; code: string };
const tok: Record<string, Tokens> = {};
const unit: Record<string, string> = {};
const unitB: Record<string, string> = {};
const beds: Record<string, string[]> = {};
let dpjpId: string;
let dpjpUserId: string;

const run = <R>(tenantId: string, fn: (tx: TenantTx) => Promise<R>) => withTenant(testDb(), tenantId, fn);
/** Pemilik skema (mis. memundurkan `requested_at` yang tidak bisa diubah peran aplikasi). */
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
    patch: (url: string, body: object) => http().patch(`/api/v1${url}`).set(auth()).send(body),
  };
};

let digitSeed = 0;
const uniqueDigits = (n: number) => {
  digitSeed += 1;
  return `${Date.now() % 1e7}${digitSeed}`.padStart(n, '0').slice(-n);
};
const DIAGNOSIS = { code: 'K35.8', display: 'Apendisitis akut lainnya' };
const CONSENT = { confirmedByStaff: true, signer: 'pasien' } as const;
const tomorrowAt = () => new Date(Date.now() + 86_400_000).toISOString();

async function clinicalTenant() {
  const t = await createTestTenant();
  const owner = createPrismaClient({ connectionString: testDbUrls().migrator, max: 1 });
  try {
    await withTenant(owner, t.id, async (tx) => {
      await seedHospitalStructure(tx, t.id);
      await seedClinicalMasters(tx, t.id);
    });
    await seedFrontOffice(owner, t.id);
  } finally {
    await owner.$disconnect();
  }
  return t;
}

const makePatient = (tenantId: string, name = 'Endang Fiktif Wijaya') =>
  createTestPatient(tenantId, {
    name,
    identifiers: { nik: `99990101900${uniqueDigits(5)}`, bpjs: `0000${uniqueDigits(8)}1` },
  });

/** Registrasi IGD lewat API (pendaftaran). */
async function igd(
  who = 'daftar',
  coverage: object = { payer: 'umum' },
  tenantUnits = unit,
  tenantId = A.id,
) {
  const p = await makePatient(tenantId);
  const r = await as(who)
    .post('/registration/emergency', {
      patient: { kind: 'known', patientId: p.id },
      unitId: tenantUnits.IGD,
      arrivalMode: 'datang_sendiri',
      coverage,
    })
    .expect(201);
  return { patientId: p.id, encounterId: r.body.encounter.id as string };
}

/** Admisi `planned` dari kunjungan IGD (registrasi fase 2). */
async function planned(e: { patientId: string; encounterId: string }, coverage: object = { payer: 'umum' }) {
  const r = await as('daftar')
    .post('/registration/admissions', {
      patientId: e.patientId,
      sourceEncounterId: e.encounterId,
      unitId: unit.MELATI,
      practitionerId: dpjpId,
      careClass: 'kelas_2',
      plannedAt: tomorrowAt(),
      coverage,
      generalConsent: CONSENT,
    })
    .expect(201);
  return r.body.encounter.id as string;
}

const bedStatus = (locationId: string) =>
  run(A.id, (tx) =>
    tx.bedStatus.findFirstOrThrow({
      where: { locationId },
      select: { status: true, version: true, encounterId: true },
    }),
  );
/** Bed `siap` pertama di unit (tes lain dalam berkas ini memakai bed yang sama). */
async function freeBed(unitCode: string) {
  const rows = await run(A.id, (tx) =>
    tx.bedStatus.findMany({
      where: { unitId: unit[unitCode], status: 'siap' },
      include: { location: { select: { code: true } } },
    }),
  );
  rows.sort((a, b) => a.location.code.localeCompare(b.location.code));
  const bed = rows[0];
  if (!bed) throw new Error(`tidak ada bed siap di ${unitCode}`);
  return bed.locationId;
}

beforeAll(async () => {
  app = await createTestApp();
  await app.listen(0, '127.0.0.1');
  port = (app.getHttpServer().address() as AddressInfo).port;
  A = await clinicalTenant();
  B = await clinicalTenant();
  for (const u of await run(A.id, (tx) => tx.unit.findMany({ select: { id: true, code: true } })))
    unit[u.code] = u.id;
  for (const u of await run(B.id, (tx) => tx.unit.findMany({ select: { id: true, code: true } })))
    unitB[u.code] = u.id;
  for (const code of ['MELATI', 'ANGGREK', 'IGD']) {
    beds[code] = (
      await run(A.id, (tx) =>
        tx.location.findMany({ where: { kind: 'bed', unitId: unit[code] }, orderBy: { code: 'asc' } }),
      )
    ).map((b) => b.id);
  }
  for (const [who, t, role, unitCode] of [
    ['daftar', A, 'petugas_pendaftaran', undefined],
    ['perawatIgd', A, 'perawat', 'IGD'],
    ['perawatMelati', A, 'perawat', 'MELATI'],
    ['perawatAnggrek', A, 'perawat', 'ANGGREK'],
    ['privasi', A, 'petugas_privasi', undefined],
    ['daftarB', B, 'petugas_pendaftaran', undefined],
    ['perawatIgdB', B, 'perawat', 'IGD'],
  ] as const) {
    const units = t === A ? unit : unitB;
    const user = await createTestUser(t.id, {
      roles: [{ code: role, unitId: unitCode ? units[unitCode] : undefined }],
      tenantCode: t.code,
    });
    tok[who] = await login(app, user);
  }
  const dokter = await createTestUser(A.id, {
    roles: [{ code: 'dokter', unitId: unit.MELATI }],
    tenantCode: A.code,
  });
  dpjpUserId = dokter.id;
  tok.dpjp = await login(app, dokter);
  dpjpId = await run(A.id, async (tx) => {
    const p = await tx.practitioner.findFirstOrThrow({ where: { name: 'dr. Andini Prameswari, Sp.PD' } });
    await tx.practitioner.update({ where: { id: p.id }, data: { userId: dokter.id } });
    return p.id;
  });
});

afterAll(async () => {
  await app?.close();
});

const vitals = { sbp: 130, dbp: 85, hr: 96, rr: 20, spo2: 98, temp: 36.8, gcs: 15 };
const triage = (encounterId: string, chosenLevel: number, overrideReason: string | null) => ({
  encounterId,
  occurredAt: new Date(Date.now() - 60_000).toISOString(),
  vitals,
  discriminators: ['nyeri_dada_kardiak'],
  chosenLevel,
  overrideReason,
  revision: { kind: 'baru' },
});

describe('triase IGD (K03)', () => {
  it('saran ATS dari server; turun tanpa alasan 422; di bawah batas 422; beralasan 201 → pelayanan dimulai + staging', async () => {
    const e = await igd();
    // Nyeri dada khas jantung: saran 2, batas bawah 3.
    const noReason = await as('perawatIgd').post('/triage/assessments', triage(e.encounterId, 3, null));
    expect(noReason.status).toBe(422);
    expect(noReason.body).toMatchObject({ code: 'TRIAGE_REASON_REQUIRED', details: { suggestedLevel: 2 } });
    const below = await as('perawatIgd').post(
      '/triage/assessments',
      triage(e.encounterId, 4, 'EKG normal, nyeri tidak khas setelah dinilai ulang'),
    );
    expect(below.status).toBe(422);
    expect(below.body.code).toBe('TRIAGE_LEVEL_NOT_ALLOWED');
    // Perawat bangsal tidak berhak atas pasien IGD.
    await as('perawatMelati')
      .post('/triage/assessments', triage(e.encounterId, 2, null))
      .expect(403);

    const ok = await as('perawatIgd')
      .post(
        '/triage/assessments',
        triage(e.encounterId, 3, 'EKG normal, nyeri tidak khas setelah dinilai ulang'),
      )
      .expect(201);
    expect(ok.body).toMatchObject({ suggestedLevel: 2, maxLevel: 3, chosenLevel: 3, version: 1 });
    expect(ok.body.overrideReason).toContain('EKG normal');
    expect(ok.body.reasons.length).toBeGreaterThan(0);

    const enc = await run(A.id, (tx) => tx.encounter.findUniqueOrThrow({ where: { id: e.encounterId } }));
    expect(enc.status).toBe('in_progress');
    const billable = await run(A.id, (tx) =>
      tx.billableEvent.findMany({ where: { encounterId: e.encounterId, kind: 'igd' } }),
    );
    expect(billable).toHaveLength(1);
    const ss = await run(A.id, (tx) =>
      tx.outboxMessage.findMany({
        where: {
          operation: 'satusehat.encounter.upsert',
          payload: { path: ['sourceId'], equals: e.encounterId },
        },
      }),
    );
    expect(ss.map((m) => m.status)).toEqual(['held']);

    // Papan IGD unit sendiri: level terpilih + saran.
    const board = await as('perawatIgd').get('/triage/board').expect(200);
    expect(board.body.unitId).toBe(unit.IGD);
    expect(
      board.body.items.find((i: { encounterId: string }) => i.encounterId === e.encounterId),
    ).toMatchObject({
      triage: { level: 3, suggestedLevel: 2, maxLevel: 3 },
    });
    // Perawat bangsal: bukan papan unitnya.
    expect((await as('perawatMelati').get(`/triage/board?unitId=${unit.IGD}`)).status).toBe(403);
  });

  it('status alur IGD + penempatan bed IGD: bed terisi, pindah bed → bed lama kotor', async () => {
    const e = await igd();
    const [b1, b2] = [beds.IGD?.[0] as string, beds.IGD?.[1] as string];
    await as('perawatIgd')
      .post(`/encounters/${e.encounterId}/ed-status`, {
        status: 'pemeriksaan',
        zone: 'K',
        locationId: b1,
      })
      .expect(201);
    expect(await bedStatus(b1)).toMatchObject({ status: 'terisi', encounterId: e.encounterId });
    await as('perawatIgd')
      .post(`/encounters/${e.encounterId}/ed-status`, { status: 'observasi', zone: 'K', locationId: b2 })
      .expect(201);
    expect((await bedStatus(b1)).status).toBe('kotor');
    expect((await bedStatus(b2)).status).toBe('terisi');
    // Bed bukan unit IGD → 422.
    await as('perawatIgd')
      .post(`/encounters/${e.encounterId}/ed-status`, {
        status: 'observasi',
        zone: 'K',
        locationId: beds.MELATI?.[0],
      })
      .expect(422);
  });
});

describe('papan bed dan status bed (K05)', () => {
  it('status manual berversi: versi lama 409; transisi tak sah 422; perawat unit lain 403', async () => {
    const bed = await freeBed('ANGGREK');
    const { version } = await bedStatus(bed);
    const r = await as('daftar')
      .patch(`/adt/beds/${bed}/status`, { status: 'rusak', baseVersion: version, note: 'Rem roda rusak' })
      .expect(200);
    expect(r.body).toMatchObject({ status: 'rusak', version: version + 1 });
    const stale = await as('daftar').patch(`/adt/beds/${bed}/status`, {
      status: 'siap',
      baseVersion: version,
      note: null,
    });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('BED_VERSION_CONFLICT');
    await as('daftar')
      .patch(`/adt/beds/${bed}/status`, { status: 'dipesan', baseVersion: version + 1, note: null })
      .expect(422);
    await as('perawatMelati')
      .patch(`/adt/beds/${bed}/status`, { status: 'siap', baseVersion: version + 1, note: null })
      .expect(403);
    await as('perawatAnggrek')
      .patch(`/adt/beds/${bed}/status`, { status: 'siap', baseVersion: version + 1, note: null })
      .expect(200);
    // Perubahan bed rawat inap → revisi ruang Aplicare naik + outbox.
    const room = await run(A.id, (tx) =>
      tx.aplicareRoom.findFirstOrThrow({ where: { unitId: unit.ANGGREK, careClass: 'kelas_1' } }),
    );
    expect(room.roomCode).toBe('ANGGREK-K1');
    expect(room.revision).toBeGreaterThanOrEqual(2);
    const msgs = await run(A.id, (tx) =>
      tx.outboxMessage.findMany({
        where: { operation: BPJS_APLICARE_UPDATE_OPERATION, payload: { path: ['roomId'], equals: room.id } },
      }),
    );
    expect(msgs.map((m) => (m.payload as { revision: number }).revision)).toContain(room.revision);
    // Papan: perawat Melati hanya melihat unitnya.
    const board = await as('perawatMelati').get('/adt/beds').expect(200);
    expect(board.body.units.map((u: { unitId: string }) => u.unitId)).toEqual([unit.MELATI]);
  });
});

describe('alur IGD → rawat inap → transfer → pulang (K04)', () => {
  it('SEP IGD, permintaan bed + boarding, alokasi ganda 409, admisi, hunian ganda 409, gelang, transfer, pulang', async () => {
    const e = await igd('daftar', { payer: 'bpjs', initialDiagnosis: DIAGNOSIS });
    // SEP IGD otomatis (diagnosa awal dari registrasi): rawat jalan poli IGD, pending + outbox.
    const sepIgd = await run(A.id, (tx) =>
      tx.sep.findFirstOrThrow({ where: { encounterId: e.encounterId } }),
    );
    expect(sepIgd).toMatchObject({ status: 'pending', serviceType: 'rawat_jalan', poliCode: 'IGD' });
    expect(
      await run(A.id, (tx) =>
        tx.outboxMessage.count({
          where: { operation: BPJS_SEP_INSERT_OPERATION, payload: { path: ['sepId'], equals: sepIgd.id } },
        }),
      ),
    ).toBe(1);
    const dup = await as('daftar').post(`/encounters/${e.encounterId}/emergency-sep`, {
      initialDiagnosis: DIAGNOSIS,
      note: null,
    });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('SEP_DUPLICATE');

    // Permintaan bed dari IGD; permintaan kedua yang masih terbuka 409.
    const reqBody = {
      encounterId: e.encounterId,
      origin: 'igd',
      careClass: 'kelas_2',
      unitId: unit.MELATI,
      isolation: false,
      note: null,
    };
    const first = (await as('perawatIgd').post('/adt/bed-requests', reqBody).expect(201)).body.id as string;
    await as('perawatIgd').post('/adt/bed-requests', reqBody).expect(409);
    await as('perawatIgd')
      .post(`/adt/bed-requests/${first}/cancel`, { reason: 'Diganti permintaan baru' })
      .expect(200);

    // Boarding: menunggu > 4 jam (setelan bawaan) tampil di papan bed dan papan IGD. Waktu minta tidak bisa diubah
    // (trigger), jadi baris pengganti disisipkan pemilik skema dengan waktu mundur.
    const req = newId();
    const requester = await run(A.id, (tx) =>
      tx.bedRequest.findUniqueOrThrow({ where: { id: first }, select: { requestedBy: true } }),
    );
    await asOwner(A.id, (tx) =>
      tx.bedRequest.create({
        data: {
          id: req,
          tenantId: A.id,
          patientId: e.patientId,
          encounterId: e.encounterId,
          origin: 'igd',
          careClass: 'kelas_2',
          unitId: unit.MELATI,
          isolation: false,
          requestedBy: requester.requestedBy,
          requestedAt: new Date(Date.now() - 5 * 3_600_000),
        },
      }),
    );
    const bedBoard = await as('daftar').get('/adt/beds').expect(200);
    expect(bedBoard.body.boardingAlertHours).toBe(4);
    const boardReq = bedBoard.body.requests.find((r: { id: string }) => r.id === req);
    expect(boardReq).toMatchObject({ origin: 'igd', boarding: true, patientLabel: 'E. F. W.' });
    expect(boardReq.waitMinutes).toBeGreaterThanOrEqual(300);
    expect(JSON.stringify(bedBoard.body)).not.toContain('Endang');
    const edBoard = await as('perawatIgd').get('/triage/board').expect(200);
    expect(
      edBoard.body.items.find((i: { encounterId: string }) => i.encounterId === e.encounterId).bedRequest,
    ).toMatchObject({ status: 'menunggu', boarding: true });

    // Alokasi: bed → dipesan. Alokasi ganda bed yang sama untuk pasien lain → 409.
    const bed = await freeBed('MELATI');
    await as('daftar').post(`/adt/bed-requests/${req}/allocate`, { locationId: bed }).expect(200);
    expect(await bedStatus(bed)).toMatchObject({ status: 'dipesan', encounterId: e.encounterId });
    const other = await igd();
    const otherReq = (
      await as('perawatIgd')
        .post('/adt/bed-requests', { ...reqBody, encounterId: other.encounterId })
        .expect(201)
    ).body.id as string;
    const dupAlloc = await as('daftar').post(`/adt/bed-requests/${otherReq}/allocate`, { locationId: bed });
    expect(dupAlloc.status).toBe(409);
    expect(dupAlloc.body.code).toBe('BED_NOT_AVAILABLE');

    // Admisi planned (registrasi) → masuk bed. BPJS tanpa diagnosa awal → 422 (SEP rawat inap butuh diagnosa).
    const imp = await planned(e, {
      payer: 'bpjs',
      visitKind: 'rujukan_internal',
      referenceNumber: sepIgd.id.replace(/-/g, '').slice(0, 19).toUpperCase(),
      initialDiagnosis: DIAGNOSIS,
    });
    await as('daftar')
      .post('/adt/admissions', { encounterId: imp, locationId: bed, initialDiagnosis: null })
      .expect(422);
    const admitted = await as('daftar')
      .post('/adt/admissions', { encounterId: imp, locationId: bed, initialDiagnosis: DIAGNOSIS })
      .expect(201);
    expect(admitted.body).toMatchObject({ encounterId: imp, bedId: bed });
    expect(admitted.body.wristbandCode).toMatch(/^GL[A-Z2-9]{10}$/);
    expect(await bedStatus(bed)).toMatchObject({ status: 'terisi', encounterId: imp });
    const [impRow, igdRow, sepRi, team, request2, events] = await run(A.id, (tx) =>
      Promise.all([
        tx.encounter.findUniqueOrThrow({ where: { id: imp } }),
        tx.encounter.findUniqueOrThrow({ where: { id: e.encounterId } }),
        tx.sep.findUniqueOrThrow({ where: { id: admitted.body.sepId as string } }),
        tx.encounterParticipant.findMany({ where: { encounterId: imp, endedAt: null } }),
        tx.bedRequest.findUniqueOrThrow({ where: { id: req } }),
        tx.domainEvent.findMany({
          where: { name: 'adt.admitted', payload: { path: ['encounterId'], equals: imp } },
        }),
      ]),
    );
    expect(impRow).toMatchObject({ status: 'in_progress', unitId: unit.MELATI });
    expect(igdRow).toMatchObject({ status: 'finished', disposition: 'rawat_inap' });
    expect(sepRi).toMatchObject({ status: 'pending', serviceType: 'rawat_inap', poliCode: null });
    expect(team.map((m) => [m.userId, m.role])).toContainEqual([dpjpUserId, 'dpjp_utama']);
    expect(request2.status).toBe('selesai');
    expect(events).toHaveLength(1);
    expect(
      await run(A.id, (tx) => tx.billableEvent.count({ where: { encounterId: imp, kind: 'admisi' } })),
    ).toBe(1);

    // Hunian ganda: admisi lain ke bed yang sama → 409.
    const imp2 = await planned(other);
    const occupied = await as('daftar').post('/adt/admissions', {
      encounterId: imp2,
      locationId: bed,
      initialDiagnosis: null,
    });
    expect(occupied.status).toBe(409);
    expect(occupied.body.code).toBe('BED_NOT_AVAILABLE');

    // Gelang: perawat bangsal cetak; cetak ulang wajib alasan → kode baru, lama batal.
    const band = await as('perawatMelati').get(`/encounters/${imp}/wristband`).expect(200);
    expect(band.body.code).toBe(admitted.body.wristbandCode);
    await as('perawatMelati').post(`/encounters/${imp}/wristband/reprint`, { reason: 'x' }).expect(400);
    const reprint = await as('perawatMelati')
      .post(`/encounters/${imp}/wristband/reprint`, { reason: 'Gelang robek saat mandi' })
      .expect(201);
    expect(reprint.body.code).not.toBe(admitted.body.wristbandCode);
    expect(
      await run(A.id, (tx) => tx.patientWristband.count({ where: { encounterId: imp, voidedAt: null } })),
    ).toBe(1);

    // Transfer ke Anggrek: lingkup unit pindah (ADR-0031 tingkat bed); bed lama kotor.
    await as('perawatAnggrek').get(`/encounters/${imp}/wristband`).expect(403);
    const target = await freeBed('ANGGREK');
    await as('daftar')
      .post('/adt/transfers', { encounterId: imp, locationId: target, reason: 'Butuh ruang kelas 1' })
      .expect(201);
    await as('perawatAnggrek').get(`/encounters/${imp}/wristband`).expect(200);
    await as('perawatMelati').get(`/encounters/${imp}/wristband`).expect(403);
    expect((await bedStatus(bed)).status).toBe('kotor');
    expect(await bedStatus(target)).toMatchObject({ status: 'terisi', encounterId: imp });
    expect(
      await run(A.id, (tx) => tx.billableEvent.count({ where: { encounterId: imp, kind: 'transfer' } })),
    ).toBe(1);

    // Pulang: bed kotor, gelang batal, disposisi tercatat, event adt.discharged.
    await as('daftar').post('/adt/discharges', { encounterId: imp, disposition: 'pulang' }).expect(201);
    expect((await bedStatus(target)).status).toBe('kotor');
    const done = await run(A.id, (tx) => tx.encounter.findUniqueOrThrow({ where: { id: imp } }));
    expect(done).toMatchObject({ status: 'finished', disposition: 'pulang' });
    await as('daftar').get(`/encounters/${imp}/wristband`).expect(404);
    expect(
      await run(A.id, (tx) =>
        tx.domainEvent.count({
          where: { name: 'adt.discharged', payload: { path: ['encounterId'], equals: imp } },
        }),
      ),
    ).toBe(1);
    await as('daftar').post('/adt/discharges', { encounterId: imp, disposition: 'pulang' }).expect(409);
  });

  it('SEP IGD menyusul: tanpa penjaminan BPJS 422; BPJS tanpa diagnosa saat registrasi → endpoint dokter jaga', async () => {
    const umum = await igd();
    await as('daftar')
      .post(`/encounters/${umum.encounterId}/emergency-sep`, { initialDiagnosis: DIAGNOSIS, note: null })
      .expect(422);
    const bpjs = await igd('daftar', { payer: 'bpjs' });
    expect(await run(A.id, (tx) => tx.sep.count({ where: { encounterId: bpjs.encounterId } }))).toBe(0);
    const r = await as('daftar')
      .post(`/encounters/${bpjs.encounterId}/emergency-sep`, {
        initialDiagnosis: DIAGNOSIS,
        note: 'Nyeri perut',
      })
      .expect(201);
    const sep = await run(A.id, (tx) => tx.sep.findUniqueOrThrow({ where: { id: r.body.sepId as string } }));
    expect(sep).toMatchObject({ poliCode: 'IGD', serviceType: 'rawat_jalan', diagnosisCode: 'K35.8' });
  });
});

describe('permintaan bed terbuka saat admisi, transfer, dan pulang (regresi)', () => {
  const requestBody = (encounterId: string, unitId = unit.MELATI, careClass = 'kelas_2') => ({
    encounterId,
    origin: 'igd',
    careClass,
    unitId,
    isolation: false,
    note: null,
  });
  const requestRow = (id: string) => run(A.id, (tx) => tx.bedRequest.findUniqueOrThrow({ where: { id } }));

  it('admisi langsung ke bed siap walau permintaan bed IGD masih menunggu: 201, permintaan selesai di bed itu', async () => {
    const e = await igd();
    const req = (await as('perawatIgd').post('/adt/bed-requests', requestBody(e.encounterId)).expect(201))
      .body.id as string;
    const imp = await planned(e);
    const bed = await freeBed('MELATI');
    await as('daftar')
      .post('/adt/admissions', { encounterId: imp, locationId: bed, initialDiagnosis: null })
      .expect(201);
    expect(await requestRow(req)).toMatchObject({ status: 'selesai', allocatedLocationId: bed });
  });

  it('admisi ke bed lain dari yang dialokasikan: bed pesanan kembali siap (tidak tersangkut dipesan)', async () => {
    const e = await igd();
    const req = (await as('perawatIgd').post('/adt/bed-requests', requestBody(e.encounterId)).expect(201))
      .body.id as string;
    const reserved = await freeBed('MELATI');
    await as('daftar').post(`/adt/bed-requests/${req}/allocate`, { locationId: reserved }).expect(200);
    const imp = await planned(e);
    const other = await freeBed('MELATI');
    expect(other).not.toBe(reserved);
    await as('daftar')
      .post('/adt/admissions', { encounterId: imp, locationId: other, initialDiagnosis: null })
      .expect(201);
    expect(await bedStatus(reserved)).toMatchObject({ status: 'siap', encounterId: null });
    expect(await requestRow(req)).toMatchObject({ status: 'selesai', allocatedLocationId: other });
  });

  it('transfer ke bed yang dialokasikan menutup permintaannya; permintaan baru bisa dibuat', async () => {
    const e = await igd();
    const imp = await planned(e);
    await as('daftar')
      .post('/adt/admissions', {
        encounterId: imp,
        locationId: await freeBed('MELATI'),
        initialDiagnosis: null,
      })
      .expect(201);
    const req = (
      await as('daftar')
        .post('/adt/bed-requests', { ...requestBody(imp, unit.ANGGREK, 'kelas_1'), origin: 'lainnya' })
        .expect(201)
    ).body.id as string;
    const target = await freeBed('ANGGREK');
    await as('daftar').post(`/adt/bed-requests/${req}/allocate`, { locationId: target }).expect(200);
    await as('daftar')
      .post('/adt/transfers', { encounterId: imp, locationId: target, reason: 'Pindah kelas 1' })
      .expect(201);
    expect(await requestRow(req)).toMatchObject({ status: 'selesai', allocatedLocationId: target });
    await as('daftar')
      .post('/adt/bed-requests', { ...requestBody(imp, unit.MELATI), origin: 'lainnya' })
      .expect(201);
  });

  it('pasien IGD pulang sebelum masuk bed: bed pesanan kembali siap, permintaan batal beralasan', async () => {
    const e = await igd();
    const req = (await as('perawatIgd').post('/adt/bed-requests', requestBody(e.encounterId)).expect(201))
      .body.id as string;
    const reserved = await freeBed('MELATI');
    await as('daftar').post(`/adt/bed-requests/${req}/allocate`, { locationId: reserved }).expect(200);
    await as('daftar')
      .post('/adt/discharges', { encounterId: e.encounterId, disposition: 'pulang' })
      .expect(201);
    expect(await bedStatus(reserved)).toMatchObject({ status: 'siap', encounterId: null });
    const row = await requestRow(req);
    expect(row.status).toBe('batal');
    expect(row.closeReason?.length).toBeGreaterThanOrEqual(10);
  });

  it('pulang dikirim dua kali bersamaan: satu 201, satu 409 (bukan 500, tanpa event ganda)', async () => {
    const e = await igd();
    const statuses = (
      await Promise.all([
        as('daftar').post('/adt/discharges', { encounterId: e.encounterId, disposition: 'pulang' }),
        as('daftar').post('/adt/discharges', { encounterId: e.encounterId, disposition: 'pulang' }),
      ])
    ).map((r) => r.status);
    expect(statuses.sort()).toEqual([201, 409]);
    expect(
      await run(A.id, (tx) =>
        tx.domainEvent.count({
          where: { name: 'encounter.finished', payload: { path: ['encounterId'], equals: e.encounterId } },
        }),
      ),
    ).toBe(1);
  });
});

/** Klien SSE minimal (fetch + frame `\n\n`). */
async function openStream(who: string, path: string) {
  const controller = new AbortController();
  const res = await fetch(`http://127.0.0.1:${port}/api/v1/${path}`, {
    headers: bearer(tok[who] as Tokens),
    signal: controller.signal,
  });
  const events: Array<{ event: string; data: Record<string, unknown> }> = [];
  void (async () => {
    const reader = res.body?.getReader();
    if (!reader) return;
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let i: number;
        while ((i = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, i);
          buffer = buffer.slice(i + 2);
          const ev = /^event: (.+)$/m.exec(frame)?.[1];
          const data = /^data: (.+)$/m.exec(frame)?.[1];
          if (ev && data) events.push({ event: ev, data: JSON.parse(data) as Record<string, unknown> });
        }
      }
    } catch {
      // ditutup klien
    }
  })();
  const waitFor = async (pred: () => boolean, ms = 5_000) => {
    const until = Date.now() + ms;
    while (!pred()) {
      if (Date.now() > until) throw new Error(`waitFor timeout; events=${JSON.stringify(events)}`);
      await new Promise((r) => setTimeout(r, 20));
    }
  };
  return { status: res.status, events, waitFor, close: () => controller.abort() };
}

describe('SSE papan IGD dan papan bed', () => {
  it('papan IGD: potret awal unit sendiri lalu ed.status; status IGD RS lain tidak terkirim', async () => {
    const mine = await igd();
    const theirs = await igd('daftarB', { payer: 'umum' }, unitB, B.id);
    const s = await openStream('perawatIgd', 'triage/board/events');
    try {
      expect(s.status).toBe(200);
      await s.waitFor(() => s.events.some((e) => e.event === 'ed.board'));
      const snapshot = s.events.find((e) => e.event === 'ed.board')?.data as {
        unitId: string;
        items: Array<{ encounterId: string }>;
      };
      expect(snapshot.unitId).toBe(unit.IGD);
      expect(snapshot.items.some((i) => i.encounterId === mine.encounterId)).toBe(true);
      expect(snapshot.items.some((i) => i.encounterId === theirs.encounterId)).toBe(false);
      await as('perawatIgdB')
        .post(`/encounters/${theirs.encounterId}/ed-status`, {
          status: 'pemeriksaan',
          zone: 'R',
          locationId: null,
        })
        .expect(201);
      await as('perawatIgd')
        .post(`/encounters/${mine.encounterId}/ed-status`, {
          status: 'pemeriksaan',
          zone: 'R',
          locationId: null,
        })
        .expect(201);
      await s.waitFor(() =>
        s.events.some((e) => e.event === 'ed.status' && e.data.encounterId === mine.encounterId),
      );
      expect(s.events.some((e) => e.data.encounterId === theirs.encounterId)).toBe(false);
      // Potret awal memuat nama + RM pasien: setiap pasien yang tampil diaudit seperti `GET /triage/board`.
      expect(
        await run(A.id, (tx) =>
          tx.auditEvent.count({
            where: { patientId: mine.patientId, resourceType: 'ed_board', action: 'search' },
          }),
        ),
      ).toBeGreaterThanOrEqual(1);
    } finally {
      s.close();
    }
  });

  it('papan bed: potret awal bed.board lalu bed.status; tanpa izin papan IGD 403', async () => {
    const s = await openStream('daftar', 'adt/beds/events');
    try {
      expect(s.status).toBe(200);
      await s.waitFor(() => s.events.some((e) => e.event === 'bed.board'));
      const snapshot = s.events.find((e) => e.event === 'bed.board')?.data as { units: unknown[] };
      expect(snapshot.units.length).toBeGreaterThan(0);
      const bed = await freeBed('MELATI');
      const { version } = await bedStatus(bed);
      await as('daftar')
        .patch(`/adt/beds/${bed}/status`, { status: 'kotor', baseVersion: version, note: null })
        .expect(200);
      await s.waitFor(() => s.events.some((e) => e.event === 'bed.status' && e.data.bedId === bed));
    } finally {
      s.close();
    }
    const denied = await openStream('privasi', 'triage/board/events');
    denied.close();
    expect(denied.status).toBe(403);
  });
});
