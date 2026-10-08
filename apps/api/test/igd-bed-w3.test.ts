/**
 * W3 · Layar IGD + Tempat tidur ke API (rencana fase 3 §W3, ADR-0104): papan IGD lengkap untuk layar (identitas
 * ringkas, penjamin, triase terkini, bed IGD, SEP), pratinjau saran triase dari server, status alur berurutan (utang
 * 3.3: `changedAt desc, id desc` + waktu naik ketat) dan status `triase` otomatis, sinyal SSE `ed.changed` /
 * `bed.request`, admisi dari IGD satu langkah (`/registration/emergency-admissions`), status Aplicare di papan bed,
 * dan dua transfer berlawanan arah tanpa deadlock (utang 3.3). Data fiktif.
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
let port: number;
let A: { id: string; code: string };
const tok: Record<string, Tokens> = {};
const userIds: Record<string, string> = {};
const unit: Record<string, string> = {};
const beds: Record<string, string[]> = {};
let dpjpId: string;
let dpjpUserId: string;

const run = <R>(fn: (tx: TenantTx) => Promise<R>) => withTenant(testDb(), A.id, fn);
const as = (who: string) => {
  const auth = () => bearer(tok[who] as Tokens);
  const http = () => request(app.getHttpServer());
  return {
    get: (url: string) => http().get(`/api/v1${url}`).set(auth()),
    post: (url: string, body: object = {}, key: string = newId()) =>
      http().post(`/api/v1${url}`).set(auth()).set('Idempotency-Key', key).send(body),
    patch: (url: string, body: object) => http().patch(`/api/v1${url}`).set(auth()).send(body),
  };
};

let digitSeed = 0;
const uniqueDigits = (n: number) => {
  digitSeed += 1;
  return `${Date.now() % 1e7}${digitSeed}`.padStart(n, '0').slice(-n);
};
const CONSENT = { confirmedByStaff: true, signer: 'pasien' } as const;
const DIAGNOSIS = { code: 'K35.8', display: 'Apendisitis akut lainnya' };

async function igd(coverage: object = { payer: 'umum' }, birthDate = '1980-05-17') {
  const p = await createTestPatient(A.id, {
    name: 'Sulastri Fiktif Rahayu',
    birthDate,
    identifiers: { nik: `99990101900${uniqueDigits(5)}`, bpjs: `0000${uniqueDigits(8)}1` },
  });
  const r = await as('daftar')
    .post('/registration/emergency', {
      patient: { kind: 'known', patientId: p.id },
      unitId: unit.IGD,
      arrivalMode: 'ambulans',
      coverage,
    })
    .expect(201);
  return { patientId: p.id, encounterId: r.body.encounter.id as string };
}

const vitals = { sbp: 88, dbp: 60, hr: 118, rr: 24, spo2: 95, temp: 37.9, gcs: 15 };

const bedStatus = (locationId: string) =>
  run((tx) =>
    tx.bedStatus.findFirstOrThrow({
      where: { locationId },
      select: { status: true, version: true, encounterId: true },
    }),
  );
async function freeBeds(unitCode: string, n: number): Promise<string[]> {
  const rows = await run((tx) =>
    tx.bedStatus.findMany({
      where: { unitId: unit[unitCode], status: 'siap' },
      include: { location: { select: { code: true } } },
    }),
  );
  rows.sort((a, b) => a.location.code.localeCompare(b.location.code));
  if (rows.length < n) throw new Error(`bed siap di ${unitCode} kurang`);
  return rows.slice(0, n).map((r) => r.locationId);
}

/** IGD → permintaan bed → alokasi → admisi satu langkah; kembalikan kunjungan rawat inap + bed. */
async function admitted(unitCode: string, careClass: string, bedId: string) {
  const e = await igd();
  const req = (
    await as('perawatIgd')
      .post('/adt/bed-requests', {
        encounterId: e.encounterId,
        origin: 'igd',
        careClass,
        unitId: unit[unitCode],
        isolation: false,
        note: null,
      })
      .expect(201)
  ).body.id as string;
  await as('daftar').post(`/adt/bed-requests/${req}/allocate`, { locationId: bedId }).expect(200);
  const r = await as('daftar')
    .post('/registration/emergency-admissions', {
      bedRequestId: req,
      practitionerId: dpjpId,
      generalConsent: CONSENT,
      initialDiagnosis: null,
    })
    .expect(201);
  return { ...e, imp: r.body.encounterId as string, bedId };
}

beforeAll(async () => {
  app = await createTestApp();
  await app.listen(0, '127.0.0.1');
  port = (app.getHttpServer().address() as AddressInfo).port;
  A = await createTestTenant();
  const owner = createPrismaClient({ connectionString: testDbUrls().migrator, max: 1 });
  try {
    await withTenant(owner, A.id, async (tx) => {
      await seedHospitalStructure(tx, A.id);
      await seedClinicalMasters(tx, A.id);
    });
    await seedFrontOffice(owner, A.id);
  } finally {
    await owner.$disconnect();
  }
  for (const u of await run((tx) => tx.unit.findMany({ select: { id: true, code: true } })))
    unit[u.code] = u.id;
  for (const code of ['MELATI', 'ANGGREK', 'IGD']) {
    beds[code] = (
      await run((tx) =>
        tx.location.findMany({ where: { kind: 'bed', unitId: unit[code] }, orderBy: { code: 'asc' } }),
      )
    ).map((b) => b.id);
  }
  for (const [who, role, unitCode] of [
    ['daftar', 'petugas_pendaftaran', undefined],
    ['daftarIgd', 'petugas_pendaftaran', 'IGD'],
    ['perawatIgd', 'perawat', 'IGD'],
    ['perawatMelati', 'perawat', 'MELATI'],
    ['dokterIgd', 'dokter', 'IGD'],
    ['dokterIgd2', 'dokter', 'IGD'],
  ] as const) {
    const user = await createTestUser(A.id, {
      roles: [{ code: role, unitId: unitCode ? unit[unitCode] : undefined }],
      tenantCode: A.code,
    });
    tok[who] = await login(app, user);
    userIds[who] = user.id;
  }
  const dokter = await createTestUser(A.id, {
    roles: [{ code: 'dokter', unitId: unit.MELATI }],
    tenantCode: A.code,
  });
  dpjpUserId = dokter.id;
  dpjpId = await run(async (tx) => {
    const p = await tx.practitioner.findFirstOrThrow({ where: { name: 'dr. Andini Prameswari, Sp.PD' } });
    await tx.practitioner.update({ where: { id: p.id }, data: { userId: dokter.id } });
    return p.id;
  });
});

/** Resume medis final ber-TTE (syarat `DischargeGate` 3.6), cukup baris final + dokumen + tanda tangan. */
async function seedSignedResume(encounterId: string, disposition: string): Promise<void> {
  await run(async (tx) => {
    const enc = await tx.encounter.findUniqueOrThrow({ where: { id: encounterId } });
    const id = newId();
    await tx.dischargeSummary.create({
      data: {
        id,
        tenantId: A.id,
        patientId: enc.patientId,
        encounterId,
        rootId: id,
        occurredAt: new Date(),
        authorUserId: dpjpUserId,
        authorRole: 'dokter',
        kind: 'rawat_inap',
        sections: {},
        disposition,
        dischargeCondition: 'Membaik',
      },
    });
    const docId = newId();
    await tx.document.create({
      data: {
        id: docId,
        tenantId: A.id,
        patientId: enc.patientId,
        kind: 'resume',
        title: 'Resume medis pulang',
        fileName: 'resume.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 10,
        sha256: 'a'.repeat(64),
        storageKey: `${A.id}/2026/10/${docId}`,
        sourceType: 'discharge_summaries',
        sourceId: id,
      },
    });
    await tx.documentSignature.create({
      data: {
        id: newId(),
        tenantId: A.id,
        documentId: docId,
        signerUserId: dpjpUserId,
        documentSha256: 'a'.repeat(64),
        verifyCode: `sv1.${A.id}.${'A'.repeat(11)}${newId().replace(/-/g, '')}`,
      },
    });
  });
}

afterAll(async () => {
  await app?.close();
});

describe('papan IGD untuk layar W3', () => {
  it('identitas ringkas, penjamin, triase terkini (tanda vital), bed IGD, SEP, daftar bed IGD', async () => {
    const e = await igd({ payer: 'bpjs', initialDiagnosis: DIAGNOSIS });
    const [igdBed] = await freeBeds('IGD', 1);
    await as('perawatIgd')
      .post('/triage/assessments', {
        encounterId: e.encounterId,
        occurredAt: new Date(Date.now() - 30_000).toISOString(),
        vitals,
        discriminators: ['nyeri_sedang'],
        chosenLevel: 2,
        overrideReason: null,
        revision: { kind: 'baru' },
      })
      .expect(201);
    await as('perawatIgd')
      .post(`/encounters/${e.encounterId}/ed-status`, {
        status: 'pemeriksaan',
        zone: 'B',
        locationId: igdBed,
      })
      .expect(201);
    const board = await as('perawatIgd').get('/triage/board').expect(200);
    expect(board.body.view).toBe('klinis');
    expect(board.body.unitName).toBe('Instalasi Gawat Darurat');
    const item = board.body.items.find((i: { encounterId: string }) => i.encounterId === e.encounterId);
    expect(item).toMatchObject({
      sex: 'female',
      arrivalMode: 'ambulans',
      payer: { kind: 'bpjs' },
      status: 'pemeriksaan',
      zone: 'B',
      bedId: igdBed,
      triage: { level: 2, vitals, discriminators: ['nyeri_sedang'], overrideReason: null },
      sep: { status: 'pending', number: null },
    });
    expect(item.ageYears).toBeGreaterThanOrEqual(45);
    expect(item.bedCode).toMatch(/^IGD-/);
    expect(item.triage.reasons.length).toBeGreaterThan(0);
    const bedRow = board.body.beds.find((b: { bedId: string }) => b.bedId === igdBed);
    expect(bedRow).toMatchObject({ status: 'terisi', encounterId: e.encounterId });

    // ADR-0109: loket pendaftaran IGD tanpa izin klinis. Papan klinis 403; papan administratif tanpa isi triase.
    await as('daftarIgd').get('/triage/board').expect(403);
    const admin = await as('daftarIgd').get('/triage/board/admission').expect(200);
    expect(admin.body.view).toBe('administratif');
    const adminItem = admin.body.items.find((i: { encounterId: string }) => i.encounterId === e.encounterId);
    expect(adminItem).toMatchObject({
      patientName: item.patientName,
      payer: { kind: 'bpjs' },
      status: 'pemeriksaan',
      bedId: igdBed,
      triaged: true,
      triage: null,
      sep: { status: 'pending', number: null },
    });
    expect(JSON.stringify(admin.body)).not.toContain('nyeri_sedang');
    // Triase, saran, dan status alur hanya petugas klinis.
    await as('daftarIgd')
      .post('/triage/assessments', {
        encounterId: e.encounterId,
        occurredAt: new Date().toISOString(),
        vitals,
        discriminators: [],
        chosenLevel: 3,
        overrideReason: null,
        revision: { kind: 'baru' },
      })
      .expect(403);
    await as('daftarIgd')
      .post(`/encounters/${e.encounterId}/ed-status`, { status: 'observasi', zone: 'B', locationId: igdBed })
      .expect(403);
  });

  it('pratinjau saran triase dari server tanpa menyimpan; perawat bangsal 403', async () => {
    const e = await igd();
    await as('daftarIgd')
      .post('/triage/suggestions', { encounterId: e.encounterId, vitals, discriminators: [] })
      .expect(403);
    const r = await as('perawatIgd')
      .post('/triage/suggestions', {
        encounterId: e.encounterId,
        vitals: { ...vitals, sbp: 76 },
        discriminators: ['nyeri_dada_kardiak'],
      })
      .expect(200);
    expect(r.body).toMatchObject({ level: 1, maxLevel: 3 });
    expect(r.body.reasons.join(' ')).toContain('TD sistolik 76');
    expect(await run((tx) => tx.triageAssessment.count({ where: { encounterId: e.encounterId } }))).toBe(0);
    await as('perawatMelati')
      .post('/triage/suggestions', { encounterId: e.encounterId, vitals, discriminators: [] })
      .expect(403);
  });

  it('status alur: triase pertama → `triase` otomatis; perubahan beruntun selalu yang terakhir (urutan waktu)', async () => {
    const e = await igd();
    await as('perawatIgd')
      .post('/triage/assessments', {
        encounterId: e.encounterId,
        occurredAt: new Date().toISOString(),
        vitals,
        discriminators: [],
        chosenLevel: 2,
        overrideReason: null,
        revision: { kind: 'baru' },
      })
      .expect(201);
    const item = async () =>
      (await as('perawatIgd').get('/triage/board').expect(200)).body.items.find(
        (i: { encounterId: string }) => i.encounterId === e.encounterId,
      );
    expect(await item()).toMatchObject({ status: 'triase', zone: 'T' });
    const seq = ['pemeriksaan', 'tunggu-lab', 'observasi', 'tunggu-dokter', 'siap-pulang'] as const;
    for (const status of seq) {
      await as('perawatIgd')
        .post(`/encounters/${e.encounterId}/ed-status`, { status, zone: 'B', locationId: null })
        .expect(201);
    }
    expect((await item()).status).toBe('siap-pulang');
    const rows = await run((tx) =>
      tx.edStatusEvent.findMany({ where: { encounterId: e.encounterId }, orderBy: { id: 'asc' } }),
    );
    // Waktu ubah naik ketat menurut urutan pencatatan (tidak ada dua event di milidetik yang sama).
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i]?.changedAt.getTime()).toBeGreaterThan(rows[i - 1]?.changedAt.getTime() ?? 0);
    }
    // Dua perubahan bersamaan: keduanya tercatat berurutan, papan menampilkan yang tercatat terakhir.
    const both = await Promise.all([
      as('perawatIgd').post(`/encounters/${e.encounterId}/ed-status`, {
        status: 'observasi',
        zone: 'B',
        locationId: null,
      }),
      as('perawatIgd').post(`/encounters/${e.encounterId}/ed-status`, {
        status: 'tunggu-bed',
        zone: 'B',
        locationId: null,
      }),
    ]);
    expect(both.map((r) => r.status)).toEqual([201, 201]);
    const last = both.map((r) => r.body).sort((a, b) => a.at.localeCompare(b.at))[1];
    expect((await item()).status).toBe(last.status);
  });
});

describe('"Ambil pasien" IGD (tinjauan 3.6, pilihan c)', () => {
  const death = () => ({
    revision: { kind: 'baru' },
    diedAt: new Date(Date.now() - 20 * 60_000).toISOString(),
    cause: { code: 'J18.9', display: 'Pneumonia' },
    note: 'Gagal napas akibat pneumonia berat',
  });

  it('dokter IGD tanpa relasi: surat kematian 403; ambil pasien → tim + papan + audit → surat kematian 201', async () => {
    const e = await igd();
    await as('dokterIgd').post(`/encounters/${e.encounterId}/death-certificate`, death()).expect(403);
    // Perawat (tanpa tanda tangan klinis) dan petugas pendaftaran tidak bisa mengambil pasien.
    await as('perawatIgd').post(`/encounters/${e.encounterId}/care-team/claim`).expect(403);
    await as('daftarIgd').post(`/encounters/${e.encounterId}/care-team/claim`).expect(403);

    const r = await as('dokterIgd').post(`/encounters/${e.encounterId}/care-team/claim`).expect(200);
    expect(r.body).toMatchObject({ encounterId: e.encounterId, unchanged: false, replacedUserId: null });
    const again = await as('dokterIgd').post(`/encounters/${e.encounterId}/care-team/claim`).expect(200);
    expect(again.body).toMatchObject({ unchanged: true, participantId: r.body.participantId });
    const board = await as('perawatIgd').get('/triage/board').expect(200);
    expect(
      board.body.items.find((i: { encounterId: string }) => i.encounterId === e.encounterId),
    ).toMatchObject({ doctor: 'Pengguna Uji Fiktif', doctorUserId: userIds.dokterIgd });
    expect(
      await run((tx) =>
        tx.auditEvent.count({
          where: { resourceType: 'care_team', resourceId: r.body.participantId, patientId: e.patientId },
        }),
      ),
    ).toBe(1);
    await as('dokterIgd').post(`/encounters/${e.encounterId}/death-certificate`, death()).expect(201);
  });

  it('dokter jaga berikutnya mengambil alih: penanggung jawab lama diakhiri beralasan', async () => {
    const e = await igd();
    const first = await as('dokterIgd').post(`/encounters/${e.encounterId}/care-team/claim`).expect(200);
    const second = await as('dokterIgd2').post(`/encounters/${e.encounterId}/care-team/claim`).expect(200);
    expect(second.body).toMatchObject({ unchanged: false, replacedUserId: userIds.dokterIgd });
    const old = await run((tx) =>
      tx.encounterParticipant.findUniqueOrThrow({ where: { id: first.body.participantId } }),
    );
    expect(old.endedAt).not.toBeNull();
    expect(old.endReason).toContain('Diambil alih');
    const active = await run((tx) =>
      tx.encounterParticipant.findMany({ where: { encounterId: e.encounterId, endedAt: null } }),
    );
    expect(active.map((a) => a.userId)).toEqual([userIds.dokterIgd2]);
  });
});

describe('sinyal SSE papan (ADR-0104)', () => {
  it('papan IGD: registrasi, triase, permintaan bed → ed.changed; papan bed: permintaan → bed.request', async () => {
    const ed = await openStream('perawatIgd', 'triage/board/events');
    const bed = await openStream('daftar', 'adt/beds/events');
    try {
      await ed.waitFor(() => ed.events.some((e) => e.event === 'ed.board'));
      await bed.waitFor(() => bed.events.some((e) => e.event === 'bed.board'));
      const e = await igd();
      await ed.waitFor(() =>
        ed.events.some(
          (x) =>
            x.event === 'ed.changed' && x.data.source === 'encounter' && x.data.encounterId === e.encounterId,
        ),
      );
      await as('perawatIgd')
        .post('/triage/assessments', {
          encounterId: e.encounterId,
          occurredAt: new Date().toISOString(),
          vitals,
          discriminators: [],
          chosenLevel: 2,
          overrideReason: null,
          revision: { kind: 'baru' },
        })
        .expect(201);
      await ed.waitFor(() => ed.events.some((x) => x.event === 'ed.changed' && x.data.source === 'triage'));
      const req = (
        await as('perawatIgd')
          .post('/adt/bed-requests', {
            encounterId: e.encounterId,
            origin: 'igd',
            careClass: 'kelas_1',
            unitId: null,
            isolation: false,
            note: 'Pantau EWS',
          })
          .expect(201)
      ).body.id as string;
      await ed.waitFor(() =>
        ed.events.some((x) => x.event === 'ed.changed' && x.data.source === 'bed_request'),
      );
      await bed.waitFor(() =>
        bed.events.some(
          (x) => x.event === 'bed.request' && x.data.requestId === req && x.data.status === 'menunggu',
        ),
      );
      // Perubahan berikutnya pada baris yang sama (alokasi) tetap terkirim: id sinyal baru per perubahan.
      const [target] = await freeBeds('ANGGREK', 1);
      await as('daftar').post(`/adt/bed-requests/${req}/allocate`, { locationId: target }).expect(200);
      await bed.waitFor(() =>
        bed.events.some(
          (x) => x.event === 'bed.request' && x.data.requestId === req && x.data.status === 'dialokasi',
        ),
      );
      await ed.waitFor(
        () => ed.events.filter((x) => x.event === 'ed.changed' && x.data.sourceId === req).length >= 2,
      );
      await as('daftar')
        .post(`/adt/bed-requests/${req}/cancel`, { reason: 'Keluarga memilih RS lain' })
        .expect(200);
      await bed.waitFor(() =>
        bed.events.some(
          (x) => x.event === 'bed.request' && x.data.requestId === req && x.data.status === 'batal',
        ),
      );
      // Muatan tanpa nama pasien.
      expect(JSON.stringify([...ed.events.filter((x) => x.event !== 'ed.board')])).not.toContain('Sulastri');
    } finally {
      ed.close();
      bed.close();
    }
  });

  it('perawat bangsal: permintaan bed tanpa unit tujuan terkirim, permintaan untuk bangsal lain tidak', async () => {
    const s = await openStream('perawatMelati', 'adt/beds/events');
    try {
      await s.waitFor(() => s.events.some((e) => e.event === 'bed.board'));
      const e1 = await igd();
      const e2 = await igd();
      const body = (encounterId: string, unitId: string | null) => ({
        encounterId,
        origin: 'igd',
        careClass: 'kelas_1',
        unitId,
        isolation: false,
        note: null,
      });
      const open = (await as('perawatIgd').post('/adt/bed-requests', body(e1.encounterId, null)).expect(201))
        .body.id as string;
      const other = (
        await as('perawatIgd')
          .post('/adt/bed-requests', body(e2.encounterId, unit.ANGGREK as string))
          .expect(201)
      ).body.id as string;
      await s.waitFor(() => s.events.some((x) => x.event === 'bed.request' && x.data.requestId === open));
      await new Promise((r) => setTimeout(r, 300));
      expect(s.events.some((x) => x.data.requestId === other)).toBe(false);
    } finally {
      s.close();
    }
  });
});

describe('admisi dari IGD satu langkah (keputusan fase 3 no. 7)', () => {
  it('permintaan → alokasi → admisi: gelang, IGD selesai, papan bed menampilkan pasien; ulangan kunci sama = hasil sama', async () => {
    const e = await igd();
    const [bedId] = await freeBeds('ANGGREK', 1);
    const req = (
      await as('perawatIgd')
        .post('/adt/bed-requests', {
          encounterId: e.encounterId,
          origin: 'igd',
          careClass: 'kelas_1',
          unitId: unit.ANGGREK,
          isolation: false,
          note: null,
        })
        .expect(201)
    ).body.id as string;
    const body = {
      bedRequestId: req,
      practitionerId: dpjpId,
      generalConsent: CONSENT,
      initialDiagnosis: null,
    };
    // Belum dialokasikan → 409.
    const early = await as('daftar').post('/registration/emergency-admissions', body);
    expect(early.status).toBe(409);
    expect(early.body.message).toContain('Alokasikan bed');

    let board = await as('daftar').get('/adt/beds').expect(200);
    expect(board.body.requests.find((r: { id: string }) => r.id === req)).toMatchObject({
      encounterClass: 'EMER',
      plannedAdmissionId: null,
      status: 'menunggu',
    });
    await as('daftar').post(`/adt/bed-requests/${req}/allocate`, { locationId: bedId }).expect(200);
    const key = newId();
    const r = await as('daftar').post('/registration/emergency-admissions', body, key).expect(201);
    expect(r.body).toMatchObject({ bedId, sourceEncounterId: e.encounterId, sepId: null });
    expect(r.body.number).toMatch(/^RI-/);
    expect(r.body.bedCode).toMatch(/^AGR-/);
    expect(r.body).not.toHaveProperty('wristbandCode');
    const again = await as('daftar').post('/registration/emergency-admissions', body, key).expect(201);
    expect(again.body).toEqual(r.body);

    const [imp, src] = await run((tx) =>
      Promise.all([
        tx.encounter.findUniqueOrThrow({ where: { id: r.body.encounterId } }),
        tx.encounter.findUniqueOrThrow({ where: { id: e.encounterId } }),
      ]),
    );
    expect(imp).toMatchObject({
      encounterClass: 'IMP',
      status: 'in_progress',
      sourceEncounterId: e.encounterId,
    });
    expect(src).toMatchObject({ status: 'finished', disposition: 'rawat_inap' });
    const coverage = await run((tx) =>
      tx.coverage.findFirstOrThrow({ where: { encounterId: imp.id }, include: { payer: true } }),
    );
    expect(coverage).toMatchObject({ careClass: 'kelas_1', status: 'active' });
    expect(coverage.payer.kind).toBe('umum');
    expect(await bedStatus(bedId)).toMatchObject({ status: 'terisi', encounterId: imp.id });

    board = await as('daftar').get('/adt/beds').expect(200);
    const unitRow = board.body.units.find((u: { code: string }) => u.code === 'ANGGREK');
    expect(unitRow.beds.find((b: { bedId: string }) => b.bedId === bedId)).toMatchObject({
      status: 'terisi',
      patientLabel: 'S. F. R.',
      encounterId: imp.id,
    });
    expect(board.body.requests.some((x: { id: string }) => x.id === req)).toBe(false);
    // Status Aplicare ruang Anggrek kelas 1: revisi naik, menunggu worker (tidak berjalan di tes ini).
    expect(board.body.aplicare.find((a: { unitId: string }) => a.unitId === unit.ANGGREK)).toMatchObject({
      careClass: 'kelas_1',
      state: 'menunggu',
    });
    // Kunjungan IGD keluar dari papan IGD.
    const ed = await as('perawatIgd').get('/triage/board').expect(200);
    expect(ed.body.items.some((i: { encounterId: string }) => i.encounterId === e.encounterId)).toBe(false);

    // Permintaan sudah ditutup → 409; perawat (tanpa encounter.write) 403.
    const closed = await as('daftar').post('/registration/emergency-admissions', body);
    expect(closed.status).toBe(409);
    await as('perawatIgd').post('/registration/emergency-admissions', body).expect(403);
  });

  it('daftar dokter untuk DPJP: aktif, nama + spesialisasi saja', async () => {
    const r = await as('daftar').get('/registration/practitioners').expect(200);
    expect(r.body.items.some((p: { id: string }) => p.id === dpjpId)).toBe(true);
    expect(Object.keys(r.body.items[0]).sort()).toEqual(['id', 'name', 'specialty']);
    await as('perawatIgd').get('/registration/practitioners').expect(403);
  });
});

describe('transfer berlawanan arah (utang 3.3)', () => {
  it('Melati → Anggrek dan Anggrek → Melati bersamaan: keduanya 201, penghitung deadlock tidak naik', async () => {
    const deadlocks = async () => {
      const [row] = await testDb().$queryRaw<Array<{ n: bigint }>>`
        SELECT deadlocks AS n FROM pg_stat_database WHERE datname = current_database()`;
      return Number(row?.n ?? 0);
    };
    const PAIRS = 3;
    for (let round = 0; round < 3; round++) {
      const m = await freeBeds('MELATI', PAIRS * 2);
      const a = await freeBeds('ANGGREK', PAIRS * 2);
      const pairs = [];
      for (let i = 0; i < PAIRS; i++) {
        pairs.push({
          p: await admitted('MELATI', 'kelas_2', m[i] as string),
          q: await admitted('ANGGREK', 'kelas_1', a[i] as string),
          toA: a[PAIRS + i] as string,
          toM: m[PAIRS + i] as string,
        });
      }
      const before = await deadlocks();
      const res = await Promise.all(
        pairs.flatMap(({ p, q, toA, toM }) => [
          as('daftar').post('/adt/transfers', { encounterId: p.imp, locationId: toA, reason: null }),
          as('daftar').post('/adt/transfers', { encounterId: q.imp, locationId: toM, reason: null }),
        ]),
      );
      expect(res.map((r) => r.status)).toEqual(Array(PAIRS * 2).fill(201));
      // Statistik Postgres dikirim asinkron; beri waktu sebelum membandingkan.
      await new Promise((r) => setTimeout(r, 600));
      expect(await deadlocks()).toBe(before);
      for (const { p, q, toA, toM } of pairs) {
        expect((await bedStatus(toA)).encounterId).toBe(p.imp);
        expect((await bedStatus(toM)).encounterId).toBe(q.imp);
        // Bersihkan: pasien pulang agar bed bisa dipakai putaran berikutnya (kotor → siap).
        for (const enc of [p.imp, q.imp]) {
          await seedSignedResume(enc, 'pulang');
          await as('daftar').post('/adt/discharges', { encounterId: enc, disposition: 'pulang' }).expect(201);
        }
      }
      for (const b of [...m, ...a]) {
        const st = await bedStatus(b);
        if (st.status === 'kotor') {
          await as('daftar')
            .patch(`/adt/beds/${b}/status`, { status: 'siap', baseVersion: st.version, note: null })
            .expect(200);
        }
      }
    }
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
