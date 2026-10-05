/**
 * F03 · IGD + admisi rawat inap + ABAC lingkup unit lewat API (fase 2 potongan 7, ADR-0031): pasien IGD tanpa
 * identitas ("Tn. X") yang kemudian dikenali lewat MPI, Idempotency-Key, satu IGD/admisi aktif per pasien, admisi
 * `planned` dari kunjungan asal / SPRI dengan persetujuan umum per admisi, batal, daftar kunjungan, staf berlingkup
 * unit (unit sendiri 200, unit lain 403 + audit, kunjungan selesai/batal menutup akses), izin, isolasi tenant.
 * Data fiktif.
 */
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createPrismaClient, seedFrontOffice, seedHospitalStructure, withTenant } from '@simrs/db';
import { testDbUrls } from '@simrs/db/testing';
import { isoDateJakarta, newId } from '@simrs/shared';
import request from 'supertest';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
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
const http = () => request(app.getHttpServer());
let A: { id: string; code: string };
let B: { id: string; code: string };
const tok: Record<string, Tokens> = {};
const unit: Record<string, string> = {};
let dpjpId: string;
let dpjpUserId: string;

let digitSeed = 0;
const uniqueDigits = (n: number) => {
  digitSeed += 1;
  return `${Date.now() % 1e7}${digitSeed}`.padStart(n, '0').slice(-n);
};

const run = <R>(tenantId: string, fn: Parameters<typeof withTenant<R>>[2]) =>
  withTenant(testDb(), tenantId, fn);

async function seededTenant() {
  const t = await createTestTenant();
  const owner = createPrismaClient({ connectionString: testDbUrls().migrator, max: 1 });
  try {
    await withTenant(owner, t.id, (tx) => seedHospitalStructure(tx, t.id));
    await seedFrontOffice(owner, t.id);
  } finally {
    await owner.$disconnect();
  }
  return t;
}

const as = (who: string) => {
  const auth = () => bearer(tok[who] as Tokens);
  return {
    get: (url: string) => http().get(`/api/v1${url}`).set(auth()),
    post: (url: string, body: object = {}, key?: string) => {
      const r = http().post(`/api/v1${url}`).set(auth());
      return (key === undefined ? r : r.set('Idempotency-Key', key)).send(body);
    },
    patch: (url: string, body: object) => http().patch(`/api/v1${url}`).set(auth()).send(body),
  };
};
const emergency = (who: string, body: object, key: string = newId()) =>
  as(who).post('/registration/emergency', body, key);
const admit = (who: string, body: object, key: string = newId()) =>
  as(who).post('/registration/admissions', body, key);

const CONSENT = { confirmedByStaff: true, signer: 'pasien' } as const;
const tomorrowAt = () => new Date(Date.now() + 86_400_000).toISOString();

async function makePatient(tenantId: string, opts: { jkn?: boolean } = {}) {
  return createTestPatient(tenantId, {
    name: 'Pasien IGD Fiktif',
    identifiers:
      opts.jkn === false
        ? { nik: `99990101900${uniqueDigits(5)}` }
        : { nik: `99990101900${uniqueDigits(5)}`, bpjs: `0000${uniqueDigits(8)}1` },
  });
}

const unidentified = (extra: Record<string, unknown> = {}) => ({
  patient: {
    kind: 'unidentified',
    sex: 'male',
    estimatedAgeYears: 40,
    description: 'Laki-laki, kaos biru, tanpa dompet',
  },
  unitId: unit.IGD,
  arrivalMode: 'ambulans',
  ...extra,
});

beforeAll(async () => {
  app = await createTestApp();
  A = await seededTenant();
  B = await seededTenant();
  const units = await run(A.id, (tx) => tx.unit.findMany({ select: { id: true, code: true } }));
  for (const u of units) unit[u.code] = u.id;
  // Matriks RS A diatur seperti layar Akses: perawat membaca kunjungan + pasien di unit penugasannya (ADR-0031).
  // Diatur sebelum login pertama (cache matriks per tenant × peran).
  const owner = createPrismaClient({ connectionString: testDbUrls().migrator, max: 1 });
  try {
    await withTenant(owner, A.id, async (tx) => {
      const perawat = await tx.role.findFirstOrThrow({ where: { code: 'perawat' } });
      for (const resource of ['encounter', 'patient']) {
        await tx.rolePermission.update({
          where: { roleId_resource_action: { roleId: perawat.id, resource, action: 'read' } },
          data: { scope: 'unit' },
        });
      }
      // Bidan RS A diberi hak mendaftarkan kunjungan berlingkup unit (RS boleh mengubah lingkup, ADR-0031 §5).
      const bidan = await tx.role.findFirstOrThrow({ where: { code: 'bidan' } });
      for (const [resource, action] of [
        ['encounter', 'write'],
        ['encounter', 'read'],
        ['patient', 'read'],
      ] as const) {
        await tx.rolePermission.upsert({
          where: { roleId_resource_action: { roleId: bidan.id, resource, action } },
          create: { tenantId: A.id, roleId: bidan.id, resource, action, scope: 'unit' },
          update: { scope: 'unit' },
        });
      }
    });
  } finally {
    await owner.$disconnect();
  }
  for (const [who, t, role, unitCode] of [
    ['daftar', A, 'petugas_pendaftaran', undefined],
    ['rm', A, 'petugas_rm', undefined],
    ['kasir', A, 'kasir', undefined],
    ['perawatIgd', A, 'perawat', 'IGD'],
    ['perawatMelati', A, 'perawat', 'MELATI'],
    ['dokterLain', A, 'dokter', undefined],
    ['bidanIgd', A, 'bidan', 'IGD'],
    ['rsB', B, 'petugas_pendaftaran', undefined],
  ] as const) {
    tok[who] = await login(
      app,
      await createTestUser(t.id, {
        roles: [{ code: role, unitId: unitCode ? unit[unitCode] : undefined }],
        tenantCode: t.code,
      }),
    );
  }
  const dokter = await createTestUser(A.id, { roles: [{ code: 'dokter' }], tenantCode: A.code });
  dpjpUserId = dokter.id;
  tok.dpjp = await login(app, dokter);
  const owner2 = createPrismaClient({ connectionString: testDbUrls().migrator, max: 1 });
  try {
    dpjpId = await withTenant(owner2, A.id, async (tx) => {
      const p = await tx.practitioner.findFirstOrThrow({ where: { name: 'dr. Andini Prameswari, Sp.PD' } });
      await tx.practitioner.update({ where: { id: p.id }, data: { userId: dokter.id } });
      return p.id;
    });
  } finally {
    await owner2.$disconnect();
  }
});

afterAll(async () => {
  await app?.close();
});

describe('IGD', () => {
  it('pasien tanpa identitas: rekam medis "Tn. X" unidentified + kunjungan EMER arrived; ulang Idempotency-Key = hasil sama', async () => {
    const key = newId();
    const [r1, r2] = await Promise.all([
      emergency('daftar', unidentified(), key),
      emergency('daftar', unidentified(), key),
    ]);
    expect([r1.status, r2.status]).toEqual([201, 201]);
    expect(r1.body.encounter.id).toBe(r2.body.encounter.id);
    const r = r1.body;
    expect(r.encounter).toMatchObject({
      class: 'EMER',
      status: 'arrived',
      unitId: unit.IGD,
      arrivalMode: 'ambulans',
      identificationNote: 'Laki-laki, kaos biru, tanpa dompet',
      practitionerId: null,
      serviceId: null,
      plannedAt: null,
    });
    expect(r.encounter.number).toMatch(/^IGD-\d{4}-\d{6}$/);
    expect(r).toMatchObject({ coverage: null, sep: null, queueTicket: null, appointment: null });
    const patient = await run(A.id, (tx) =>
      tx.patient.findUniqueOrThrow({ where: { id: r.encounter.patientId }, include: { identifiers: true } }),
    );
    expect(patient).toMatchObject({
      name: 'Tn. X',
      unidentified: true,
      sex: 'male',
      birthDateEstimated: true,
    });
    expect(patient.identifiers).toHaveLength(0);
    expect(patient.birthDate?.toISOString().slice(0, 4)).toBe(
      String(Number(isoDateJakarta().slice(0, 4)) - 40),
    );
    // Satu rekam medis, satu kunjungan (ulangan tidak membuat pasien kedua).
    expect(await run(A.id, (tx) => tx.encounter.count({ where: { patientId: patient.id } }))).toBe(1);
    const audit = await run(A.id, (tx) =>
      tx.auditEvent.findMany({ where: { patientId: patient.id, action: 'create' } }),
    );
    expect(audit.map((a) => a.resourceType).sort()).toEqual(['encounter', 'patient']);
    const events = await run(A.id, (tx) =>
      tx.domainEvent.findMany({
        where: { name: 'encounter.registered', payload: { path: ['encounterId'], equals: r.encounter.id } },
      }),
    );
    expect(events[0]?.payload).toMatchObject({ encounterClass: 'emer', appointmentId: null, payer: null });

    // Dikenali keluarga: identitas diisi di MPI → kandidat duplikat dengan rekam medis lamanya → digabung lewat MPI.
    const known = await createTestPatient(A.id, {
      name: 'Bambang Fiktif Wibowo',
      sex: 'male',
      birthDate: '1980-02-03',
      identifiers: { nik: `99990101900${uniqueDigits(5)}` },
    });
    await as('rm')
      .patch(`/patients/${patient.id}`, {
        name: 'Bambang Fiktif Wibowo',
        birthDate: '1980-02-03',
        birthDateEstimated: false,
        unidentified: false,
      })
      .expect(200);
    const list = await as('rm').get('/mpi/candidates?status=open').expect(200);
    const pair = list.body.items.find(
      (c: { a: { id: string }; b: { id: string } }) =>
        [c.a.id, c.b.id].sort().join() === [known.id, patient.id].sort().join(),
    );
    expect(pair).toBeTruthy();
  });

  it('pasien dikenal + BPJS (tanpa rujukan, SEP menyusul); IGD kedua 409; unit bukan IGD 422; tanpa identitas + BPJS 422', async () => {
    const p = await makePatient(A.id);
    const r = await emergency('daftar', {
      patient: { kind: 'known', patientId: p.id },
      unitId: unit.IGD,
      arrivalMode: 'datang_sendiri',
      coverage: { payer: 'bpjs' },
      guarantor: { name: 'Keluarga Fiktif', relation: 'anak', phone: '0812-1111-2222' },
    }).expect(201);
    expect(r.body.coverage).toMatchObject({ payerKind: 'bpjs', locked: false });
    expect(r.body.sep).toBeNull();
    expect(await run(A.id, (tx) => tx.sep.count({ where: { encounterId: r.body.encounter.id } }))).toBe(0);
    const dup = await emergency('daftar', {
      patient: { kind: 'known', patientId: p.id },
      unitId: unit.IGD,
      arrivalMode: 'datang_sendiri',
    }).expect(409);
    expect(dup.body.code).toBe('ENCOUNTER_DUPLICATE');
    expect(
      (await emergency('daftar', { ...unidentified(), unitId: unit['POLI-DALAM'] }).expect(422)).body.code,
    ).toBe('VALIDATION_FAILED');
    expect(
      (await emergency('daftar', unidentified({ coverage: { payer: 'bpjs' } })).expect(422)).body.message,
    ).toMatch(/kartu BPJS/);
    // BPJS IGD tidak menerima isian rujukan (kontrak IGD).
    await emergency(
      'daftar',
      unidentified({ coverage: { payer: 'bpjs', visitKind: 'rujukan_fktp' } }),
    ).expect(400);
    // Database menjamin satu IGD aktif per pasien walau pengecekan dilewati.
    await expect(
      run(A.id, (tx) =>
        tx.encounter.create({
          data: {
            id: newId(),
            tenantId: A.id,
            number: `IGD-2610-${uniqueDigits(6)}`,
            patientId: p.id,
            encounterClass: 'EMER',
            status: 'arrived',
            unitId: unit.IGD as string,
            arrivalMode: 'lainnya',
          },
        }),
      ),
    ).rejects.toThrow();
  });
});

describe('admisi rawat inap', () => {
  it('dari IGD: planned + persetujuan umum per admisi + DPJP berelasi; admisi kedua 409; batal → admisi baru boleh', async () => {
    const p = await makePatient(A.id, { jkn: false });
    const igd = (
      await emergency('daftar', {
        patient: { kind: 'known', patientId: p.id },
        unitId: unit.IGD,
        arrivalMode: 'datang_sendiri',
      }).expect(201)
    ).body;
    const body = {
      patientId: p.id,
      sourceEncounterId: igd.encounter.id,
      unitId: unit.MELATI,
      practitionerId: dpjpId,
      careClass: 'kelas_2',
      plannedAt: tomorrowAt(),
      coverage: { payer: 'umum' },
      generalConsent: { confirmedByStaff: true, signer: 'wali', signerName: 'Wali Fiktif' },
    };
    const key = newId();
    const res = await admit('daftar', body, key).expect(201);
    expect(res.body.encounter).toMatchObject({
      class: 'IMP',
      status: 'planned',
      unitId: unit.MELATI,
      practitionerId: dpjpId,
      sourceEncounterId: igd.encounter.id,
      arrivedAt: null,
      arrivalMode: null,
    });
    expect(res.body.encounter.number).toMatch(/^RI-\d{4}-\d{6}$/);
    expect(res.body.encounter.plannedAt).toBe(body.plannedAt);
    expect(res.body.coverage).toMatchObject({ payerKind: 'umum', careClass: 'kelas_2' });
    expect(res.body.sep).toBeNull();
    expect((await admit('daftar', body, key).expect(201)).body.encounter.id).toBe(res.body.encounter.id);
    const consents = await run(A.id, (tx) =>
      tx.privacyConsent.findMany({ where: { patientId: p.id, kind: 'umum', revokedAt: null } }),
    );
    expect(consents.map((c) => c.encounterId)).toEqual([res.body.encounter.id]);
    expect(consents[0]?.note).toMatch(/rawat inap, ditandatangani wali/);
    const rel = await run(A.id, (tx) =>
      tx.accessRelationship.findMany({ where: { patientId: p.id, userId: dpjpUserId } }),
    );
    expect(rel).toEqual([expect.objectContaining({ kind: 'dpjp', sourceId: res.body.encounter.id })]);
    await as('dpjp').get(`/registration/encounters/${res.body.encounter.id}`).expect(200);

    expect((await admit('daftar', body).expect(409)).body.code).toBe('ENCOUNTER_DUPLICATE');
    const cancelled = await as('daftar')
      .post(`/registration/encounters/${res.body.encounter.id}/cancel`, { reason: 'Pasien menolak dirawat' })
      .expect(200);
    expect(cancelled.body.encounter).toMatchObject({
      status: 'cancelled',
      cancelReason: 'Pasien menolak dirawat',
    });
    const history = await run(A.id, (tx) =>
      tx.encounterStatusHistory.findMany({
        where: { encounterId: res.body.encounter.id },
        orderBy: { changedAt: 'asc' },
      }),
    );
    expect(history.map((h) => [h.fromStatus, h.toStatus])).toEqual([
      [null, 'planned'],
      ['planned', 'cancelled'],
    ]);
    await as('daftar')
      .post(`/registration/encounters/${res.body.encounter.id}/cancel`, { reason: 'Batal kedua kali' })
      .expect(409);
    await admit('daftar', { ...body, generalConsent: CONSENT }).expect(201);
  });

  it('BPJS: wajib SPRI/kunjungan asal (400); SPRI aktif milik pasien dipakai sekali; SPRI pending/milik lain ditolak', async () => {
    const p = await makePatient(A.id);
    const base = {
      patientId: p.id,
      unitId: unit.MAWAR,
      practitionerId: dpjpId,
      careClass: 'kelas_1',
      plannedAt: tomorrowAt(),
      coverage: {
        payer: 'bpjs',
        visitKind: 'kontrol',
        referenceNumber: '0301R0011026K000001',
        initialDiagnosis: { code: 'I10', display: 'Hipertensi esensial (primer)' },
      },
      generalConsent: CONSENT,
    };
    await admit('daftar', base).expect(400);
    const spri = (status: 'active' | 'pending', patientId = p.id) =>
      run(A.id, async (tx) => {
        const id = newId();
        await tx.referral.create({
          data: {
            id,
            tenantId: A.id,
            patientId,
            kind: 'spri',
            number: status === 'active' ? `0301R0011026K${uniqueDigits(6)}` : null,
            facilityName: 'Bangsal Mawar',
            targetUnitId: unit.MAWAR,
            issuedOn: new Date(`${isoDateJakarta()}T00:00:00.000Z`),
            status,
            syncStatus: status === 'active' ? 'sent' : 'pending',
            syncedAt: status === 'active' ? new Date() : null,
          },
        });
        return id;
      });
    const pending = await spri('pending');
    expect((await admit('daftar', { ...base, spriReferralId: pending }).expect(409)).body.code).toBe(
      'REFERRAL_STATE_INVALID',
    );
    const other = await makePatient(A.id);
    await admit('daftar', { ...base, spriReferralId: await spri('active', other.id) }).expect(422);
    const ok = await spri('active');
    const res = await admit('daftar', { ...base, spriReferralId: ok }).expect(201);
    expect(res.body.encounter.referralId).toBe(ok);
    expect(res.body.coverage).toMatchObject({ payerKind: 'bpjs', careClass: 'kelas_1' });
    // Unit bukan rawat inap, DPJP tak dikenal.
    await admit('daftar', { ...base, spriReferralId: ok, unitId: unit.IGD }).expect(422);
    await admit('daftar', { ...base, spriReferralId: ok, practitionerId: newId() }).expect(422);
  });
});

describe('ABAC lingkup unit (ADR-0031), izin, isolasi', () => {
  it('perawat IGD membuka pasien IGD aktif; perawat bangsal 403 + audit; selesai/batal menutup akses; admisi membuka akses bangsal', async () => {
    const r = (await emergency('daftar', unidentified()).expect(201)).body;
    const encId = r.encounter.id as string;
    const patientId = r.encounter.patientId as string;
    await as('perawatIgd').get(`/registration/encounters/${encId}`).expect(200);
    await as('perawatIgd').get(`/patients/${patientId}`).expect(200);
    const access = await as('perawatIgd').get(`/authz/patients/${patientId}/access`).expect(200);
    expect(access.body).toEqual({ allowed: true, basis: 'unit' });
    const denied = await as('perawatMelati').get(`/registration/encounters/${encId}`).expect(403);
    expect(denied.body.details).toMatchObject({ breakGlassAvailable: true });
    expect(denied.body.message).toMatch(/unit Anda/);
    await as('perawatMelati').get(`/patients/${patientId}`).expect(403);
    const audits = await run(A.id, (tx) =>
      tx.auditEvent.findMany({ where: { patientId, action: 'access_denied' } }),
    );
    expect(audits.length).toBeGreaterThanOrEqual(2);
    expect(audits.every((a) => (a.details as { scope?: string }).scope === 'unit')).toBe(true);

    // Pencarian MPI (lingkup unit) hanya menemukan pasien di unitnya.
    const mrn = (await run(A.id, (tx) => tx.patient.findUniqueOrThrow({ where: { id: patientId } }))).mrn;
    const q = encodeURIComponent(mrn.replaceAll('-', ''));
    const found = await as('perawatIgd').get(`/patients?q=${q}`).expect(200);
    expect(found.body.items.map((i: { id: string }) => i.id)).toEqual([patientId]);
    expect((await as('perawatMelati').get(`/patients?q=${q}`).expect(200)).body.items).toEqual([]);

    // Daftar: perawat IGD hanya unitnya; unit lain 403; pendaftaran melihat semua.
    const listIgd = await as('perawatIgd').get('/registration/encounters?class=EMER&limit=200').expect(200);
    expect(
      listIgd.body.items.every((i: { encounter: { unitId: string } }) => i.encounter.unitId === unit.IGD),
    ).toBe(true);
    expect(listIgd.body.items.map((i: { encounter: { id: string } }) => i.encounter.id)).toContain(encId);
    const item = listIgd.body.items.find((i: { encounter: { id: string } }) => i.encounter.id === encId);
    expect(item.patient).toMatchObject({ id: patientId, name: 'Tn. X', unidentified: true });
    await as('perawatIgd').get(`/registration/encounters?unitId=${unit.MELATI}`).expect(403);
    expect(
      (await as('perawatMelati').get('/registration/encounters?limit=200').expect(200)).body.items.map(
        (i: { encounter: { id: string } }) => i.encounter.id,
      ),
    ).not.toContain(encId);
    // Dokter berlingkup relasi: hanya pasien berelasi (bukan pasien IGD ini).
    expect(
      (await as('dokterLain').get('/registration/encounters?limit=200').expect(200)).body.items.map(
        (i: { encounter: { id: string } }) => i.encounter.id,
      ),
    ).not.toContain(encId);

    // Admisi ke Melati: perawat Melati kini berhak (kunjungan planned di unitnya).
    await admit('daftar', {
      patientId,
      sourceEncounterId: encId,
      unitId: unit.MELATI,
      practitionerId: dpjpId,
      careClass: 'kelas_3',
      plannedAt: tomorrowAt(),
      coverage: { payer: 'umum' },
      generalConsent: { confirmedByStaff: true, signer: 'wali', signerName: 'Keluarga Fiktif' },
    }).expect(201);
    await as('perawatMelati').get(`/registration/encounters/${encId}`).expect(200);

    // Kunjungan IGD dibatalkan → perawat IGD kehilangan akses, juga dari daftar unitnya (hanya kunjungan aktif).
    await as('daftar')
      .post(`/registration/encounters/${encId}/cancel`, { reason: 'Salah daftar unit' })
      .expect(200);
    await as('perawatIgd').get(`/registration/encounters/${encId}`).expect(403);
    const afterCancel = await as('perawatIgd').get('/registration/encounters?limit=200').expect(200);
    expect(afterCancel.body.items.map((i: { encounter: { id: string } }) => i.encounter.id)).not.toContain(
      encId,
    );
    expect(
      afterCancel.body.items.every((i: { encounter: { status: string } }) =>
        ['planned', 'arrived', 'in_progress'].includes(i.encounter.status),
      ),
    ).toBe(true);
  });

  it('izin: perawat tidak boleh mendaftarkan IGD/admisi (403 + audit); kasir tidak boleh membatalkan', async () => {
    await emergency('perawatIgd', unidentified()).expect(403);
    const r = (await emergency('daftar', unidentified()).expect(201)).body;
    await as('kasir')
      .post(`/registration/encounters/${r.encounter.id}/cancel`, { reason: 'Coba batal' })
      .expect(403);
    await admit('perawatMelati', {
      patientId: r.encounter.patientId,
      unitId: unit.MELATI,
      practitionerId: dpjpId,
      careClass: 'kelas_3',
      plannedAt: tomorrowAt(),
      coverage: { payer: 'umum' },
      generalConsent: CONSENT,
    }).expect(403);
    const denied = await run(A.id, (tx) =>
      tx.auditEvent.findMany({ where: { action: 'access_denied', resourceType: 'encounter' } }),
    );
    expect(denied.length).toBeGreaterThanOrEqual(3);
  });

  it('isolasi tenant: RS B tidak melihat/membatalkan kunjungan RS A dan tidak bisa memakai unit IGD RS A', async () => {
    const r = (await emergency('daftar', unidentified()).expect(201)).body;
    await as('rsB').get(`/registration/encounters/${r.encounter.id}`).expect(404);
    await as('rsB')
      .post(`/registration/encounters/${r.encounter.id}/cancel`, { reason: 'Batal dari RS B' })
      .expect(404);
    expect(
      (await as('rsB').get('/registration/encounters?limit=200').expect(200)).body.items.map(
        (i: { encounter: { id: string } }) => i.encounter.id,
      ),
    ).not.toContain(r.encounter.id);
    // Unit IGD RS A tidak terlihat dari RS B; pasien RS A tidak bisa didaftarkan ke IGD RS B.
    await emergency('rsB', unidentified()).expect(422);
    const igdB = await run(B.id, (tx) => tx.unit.findFirstOrThrow({ where: { code: 'IGD' } }));
    const pa = await makePatient(A.id, { jkn: false });
    await emergency('rsB', {
      patient: { kind: 'known', patientId: pa.id },
      unitId: igdB.id,
      arrivalMode: 'datang_sendiri',
    }).expect(404);
    const rows = await run(B.id, (tx) => tx.encounter.count({ where: { id: r.encounter.id } }));
    expect(rows).toBe(0);
  });
});

describe('encounter.write berlingkup unit (bukan all)', () => {
  it('hanya ke unit penugasan; pasien yang ada harus bisa diakses; Tn. X baru boleh; pelanggaran 403 + audit', async () => {
    // Pasien tanpa identitas baru ke IGD (unit penugasannya) → boleh.
    const created = await emergency('bidanIgd', unidentified()).expect(201);
    expect(created.body.encounter.unitId).toBe(unit.IGD);

    // Admisi ke bangsal (unit lain) → 403 tercatat.
    const p = await makePatient(A.id, { jkn: false });
    const wrongUnit = await admit('bidanIgd', {
      patientId: p.id,
      unitId: unit.MELATI,
      practitionerId: dpjpId,
      careClass: 'kelas_3',
      plannedAt: tomorrowAt(),
      coverage: { payer: 'umum' },
      generalConsent: CONSENT,
    }).expect(403);
    expect(wrongUnit.body.message).toMatch(/unit penugasan/);

    // Pasien yang sudah ada tanpa relasi/kunjungan di unitnya → 403 (akses pasien), tidak ada kunjungan dibuat.
    const known = {
      patient: { kind: 'known', patientId: p.id },
      unitId: unit.IGD,
      arrivalMode: 'datang_sendiri',
    };
    await emergency('bidanIgd', known).expect(403);
    expect(await run(A.id, (tx) => tx.encounter.count({ where: { patientId: p.id } }))).toBe(0);
    const denied = await run(A.id, (tx) =>
      tx.auditEvent.findMany({
        where: { action: 'access_denied', patientId: p.id },
        orderBy: { seq: 'asc' },
      }),
    );
    expect(denied.map((d) => d.resourceType)).toEqual(['encounter', 'patient']);
    expect(denied[0]?.details).toMatchObject({ scope: 'unit', unitId: unit.MELATI });

    // Setelah punya relasi dengan pasien → boleh mendaftarkannya ke IGD.
    const bidanId = await run(A.id, async (tx) => {
      const a = await tx.staffAssignment.findFirstOrThrow({
        where: { role: { code: 'bidan' }, unitId: unit.IGD },
        select: { userId: true },
      });
      return a.userId;
    });
    await run(A.id, (tx) =>
      tx.accessRelationship.create({
        data: { id: newId(), tenantId: A.id, userId: bidanId, patientId: p.id, kind: 'petugas_unit' },
      }),
    );
    await emergency('bidanIgd', known).expect(201);

    // Pendaftar berlingkup semua tetap boleh ke unit mana pun.
    await admit('daftar', {
      patientId: p.id,
      unitId: unit.MELATI,
      practitionerId: dpjpId,
      careClass: 'kelas_3',
      plannedAt: tomorrowAt(),
      coverage: { payer: 'umum' },
      generalConsent: CONSENT,
    }).expect(201);
  });
});
