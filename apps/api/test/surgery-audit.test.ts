/**
 * S06 · Audit agen BUG atas gerbang keselamatan kamar operasi (4.7): konfirmasi time out dan insisi serentak (tepat
 * satu, tanpa 500) dan override insisi sebelum time out hanya oleh operator/anestesi tim aktif (ADR-0130). Data fiktif.
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

/**
 * Syarat sign in: persetujuan tindakan final `setuju` (3.7) dan asesmen pra-anestesi final (formulir P07, 4.7b) untuk
 * kunjungan ini; isinya cukup untuk trigger klinis dan gerbang service.
 */
async function consent(e: { patientId: string; encounterId: string }) {
  const id = newId();
  await run(A.id, async (tx) => {
    const def = await tx.formDefinition.findFirstOrThrow({
      where: { code: 'asesmen_pra_anestesi', status: 'published' },
    });
    const pre = newId();
    await tx.formResponse.create({
      data: {
        id: pre,
        rootId: pre,
        tenantId: A.id,
        patientId: e.patientId,
        encounterId: e.encounterId,
        definitionId: def.id,
        formCode: 'asesmen_pra_anestesi',
        answers: {
          asa: 'asa_2',
          darurat: 'ya',
          mallampati: 'm1',
          teknik: 'umum',
          rencana: 'Anestesi umum',
          persetujuan_anestesi: 'ya',
        },
        createdBy: users.dokterOp as string,
      },
    });
  });
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
    ['dokterDpjp', A, 'dokter', 'MELATI'],
    ['dokterAsisten', A, 'dokter', 'OK'],
    ['dokterAnestesi', A, 'dokter', 'OK'],
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

const noServerErrors = (statuses: number[]) => expect(statuses.filter((s) => s >= 500)).toEqual([]);

describe('audit BUG · gerbang kamar operasi', () => {
  it('override insisi sebelum time out hanya operator/anestesi tim aktif: DPJP bangsal berelasi dan asisten → 403; anestesi → 201', async () => {
    const c = await scheduleCase(rooms[1]);
    await consent(c);
    await run(A.id, (tx) =>
      tx.accessRelationship.create({
        data: {
          id: newId(),
          tenantId: A.id,
          userId: users.dokterDpjp as string,
          patientId: c.patientId,
          kind: 'dpjp',
          validFrom: new Date(Date.now() - 60_000),
          sourceType: 'encounter',
          sourceId: c.encounterId,
        },
      }),
    );
    await checkAll(c.caseId, 'sign-in');
    await confirm(c.caseId, 'sign-in').expect(200);
    const res = await event(
      c.caseId,
      'insisi',
      'Perdarahan aktif, tidak bisa menunggu time out',
      'dokterDpjp',
    );
    expect(res.status).toBe(403);
    const incisions = await run(A.id, (tx) =>
      tx.surgeryEvent.count({ where: { surgeryCaseId: c.caseId, kind: 'insisi' } }),
    );
    expect(incisions).toBe(0);
  });

  it('time out dikonfirmasi serentak dan insisi dicatat serentak: masing-masing tepat satu, tanpa 500', async () => {
    const c = await scheduleCase(rooms[2]);
    await consent(c);
    await checkAll(c.caseId, 'sign-in');
    await confirm(c.caseId, 'sign-in').expect(200);
    await event(c.caseId, 'induksi').expect(201);
    await checkAll(c.caseId, 'time-out');
    const timeOut = await Promise.all([confirm(c.caseId, 'time-out'), confirm(c.caseId, 'time-out')]);
    noServerErrors(timeOut.map((r) => r.status));
    expect(timeOut.filter((r) => r.status === 200)).toHaveLength(1);
    const cut = await Promise.all([
      event(c.caseId, 'insisi'),
      event(c.caseId, 'insisi'),
      event(c.caseId, 'insisi'),
    ]);
    noServerErrors(cut.map((r) => r.status));
    expect(cut.filter((r) => r.status === 201)).toHaveLength(1);
    expect(
      await run(A.id, (tx) => tx.surgeryEvent.count({ where: { surgeryCaseId: c.caseId, kind: 'insisi' } })),
    ).toBe(1);
  });
});
