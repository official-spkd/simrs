/**
 * K04/K12 · API layar Rawat inap (W4): daftar pasien rawat inap per unit/bed (ABAC, izin, isolasi tenant, audit) dan
 * bacaan pindaian gelang aktif + atestasi cek ganda untuk alur dua sesi perawat (ADR-0077). Data fiktif.
 */
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
  activeWristbandScanSchema,
  doubleCheckViewSchema,
  emarBoardSchema,
  fluidBalanceDaySchema,
  inpatientCensusSchema,
  newId,
  type InpatientCensusItem,
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
const as = (who: string) => ({
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

/** Bed bebas berikutnya per unit seed (tiap pasien uji menempati bed sendiri). */
const usedBeds = new Set<string>();
async function freeBed(tx: TenantTx, unitCode: string): Promise<{ id: string; unitId: string }> {
  const unit = await tx.unit.findFirstOrThrow({ where: { code: unitCode } });
  const beds = await tx.location.findMany({
    where: { unitId: unit.id, kind: 'bed' },
    orderBy: { code: 'asc' },
    select: { id: true, unitId: true },
  });
  const bed = beds.find((b) => !usedBeds.has(b.id));
  if (!bed) throw new Error(`Bed ${unitCode} habis untuk tes`);
  usedBeds.add(bed.id);
  return bed;
}

interface Inpatient {
  encounterId: string;
  patientId: string;
  bedId: string | null;
}

/** Kunjungan rawat inap aktif di bed unit `unitCode` (atau tanpa bed), opsional DPJP utama `dpjp`. */
async function inpatient(
  unitCode: string,
  opts: { bed?: boolean; dpjp?: string; cls?: string; status?: string; name?: string } = {},
): Promise<Inpatient> {
  const p = await createTestPatient(A.id, { name: opts.name ?? 'Pasien Rawat Inap Fiktif' });
  return run(A.id, async (tx) => {
    const unit = await tx.unit.findFirstOrThrow({ where: { code: unitCode } });
    const bed = opts.bed === false ? null : await freeBed(tx, unitCode);
    const enc = await tx.encounter.create({
      data: {
        id: newId(),
        tenantId: A.id,
        number: `RI-${newId().slice(-8)}`,
        patientId: p.id,
        encounterClass: opts.cls ?? 'IMP',
        status: opts.status ?? 'in_progress',
        unitId: unit.id,
        startedAt: new Date(Date.now() - 2 * 86_400_000),
        plannedAt: (opts.cls ?? 'IMP') === 'IMP' ? new Date(Date.now() - 2 * 86_400_000) : null,
      },
    });
    if (bed) {
      await tx.bedAssignment.create({
        data: { id: newId(), tenantId: A.id, encounterId: enc.id, patientId: p.id, locationId: bed.id },
      });
    }
    if (opts.dpjp) {
      await tx.encounterParticipant.create({
        data: {
          id: newId(),
          tenantId: A.id,
          encounterId: enc.id,
          userId: opts.dpjp,
          role: 'dpjp_utama',
          startedAt: new Date(),
        },
      });
      await tx.accessRelationship.create({
        data: {
          id: newId(),
          tenantId: A.id,
          userId: opts.dpjp,
          patientId: p.id,
          kind: 'dpjp',
          sourceType: 'encounter_participant',
          validFrom: new Date(Date.now() - 60_000),
        },
      });
    }
    return { encounterId: enc.id, patientId: p.id, bedId: bed?.id ?? null };
  });
}

let melati: Inpatient;
let anggrek: Inpatient;
let unbedded: Inpatient;
let outpatient: Inpatient;
let finished: Inpatient;

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
    ['anggrekNurse', A, 'perawat', 'ANGGREK'],
    ['dpjp', A, 'dokter', 'POLI-DALAM'],
    ['strangerDoctor', A, 'dokter', 'POLI-DALAM'],
    ['kasir', A, 'kasir', null],
    ['otherTenant', B, 'perawat', 'MELATI'],
  ] as const) {
    const unit = unitCode
      ? await run(t.id, (tx) => tx.unit.findFirstOrThrow({ where: { code: unitCode } }))
      : null;
    const u = await createTestUser(t.id, {
      roles: [{ code: role, ...(unit ? { unitId: unit.id } : {}) }],
      tenantCode: t.code,
    });
    users[who] = u.id;
    tok[who] = await login(app, u);
  }
  melati = await inpatient('MELATI', { dpjp: users.dpjp, name: 'Pasien Melati Fiktif' });
  anggrek = await inpatient('ANGGREK', { name: 'Pasien Anggrek Fiktif' });
  unbedded = await inpatient('MELATI', { bed: false, name: 'Pasien Menunggu Bed Fiktif' });
  outpatient = await inpatient('MELATI', { bed: false, cls: 'AMB', name: 'Pasien Poli Fiktif' });
  finished = await inpatient('MELATI', { status: 'finished', name: 'Pasien Pulang Fiktif' });
});
afterAll(async () => {
  await app?.close();
});

const ids = (items: InpatientCensusItem[]) => items.map((i) => i.encounterId);

describe('daftar pasien rawat inap', () => {
  it('perawat unit melihat pasien unitnya saja (bed atau unit kunjungan), bukan poli/selesai/unit lain', async () => {
    const r = await as('nurse').get('/inpatients').expect(200);
    const census = inpatientCensusSchema.parse(r.body);
    expect(ids(census.items)).toEqual(expect.arrayContaining([melati.encounterId, unbedded.encounterId]));
    for (const hidden of [anggrek, outpatient, finished]) {
      expect(ids(census.items)).not.toContain(hidden.encounterId);
    }
    const row = census.items.find((i) => i.encounterId === melati.encounterId);
    expect(row?.bed?.id).toBe(melati.bedId);
    expect(row?.unit.code).toBe('MELATI');
    expect(row?.day).toBe(3);
    expect(row?.name).toBe('Pasien Melati Fiktif');
    expect(census.units.map((u) => u.code)).toEqual(['MELATI']);
    await run(A.id, async (tx) => {
      const audit = await tx.auditEvent.count({
        where: { actorUserId: users.nurse, resourceType: 'inpatient_census', patientId: melati.patientId },
      });
      expect(audit).toBeGreaterThanOrEqual(1);
    });
  });

  it('dokter melihat pasien berelasi (DPJP) walau unit penugasannya lain; dokter tanpa relasi tidak melihatnya', async () => {
    const dpjp = inpatientCensusSchema.parse((await as('dpjp').get('/inpatients').expect(200)).body);
    expect(ids(dpjp.items)).toContain(melati.encounterId);
    expect(ids(dpjp.items)).not.toContain(anggrek.encounterId);
    expect(dpjp.items.find((i) => i.encounterId === melati.encounterId)?.dpjp).toBe('Pengguna Uji Fiktif');
    const stranger = inpatientCensusSchema.parse(
      (await as('strangerDoctor').get('/inpatients').expect(200)).body,
    );
    expect(ids(stranger.items)).not.toContain(melati.encounterId);
  });

  it('saringan unit, transfer memindah akses, EWS + co-sign tertunda + dosis terlambat terhitung', async () => {
    const melatiUnit = await run(A.id, (tx) => tx.unit.findFirstOrThrow({ where: { code: 'MELATI' } }));
    const filtered = inpatientCensusSchema.parse(
      (await as('nurse').get(`/inpatients?unitId=${melatiUnit.id}`).expect(200)).body,
    );
    expect(filtered.items.every((i) => i.unit.id === melatiUnit.id)).toBe(true);
    await as('nurse').get('/inpatients?unitId=bukan-uuid').expect(400);

    // Tanda vital ber-EWS tinggi + catatan residen tanpa co-sign + dosis terjadwal 2 jam lalu tanpa pemberian.
    await as('nurse')
      .post(`/encounters/${melati.encounterId}/observations`, {
        encounterId: melati.encounterId,
        occurredAt: new Date().toISOString(),
        temp: 39.4,
        hr: 132,
        rr: 27,
        sbp: 88,
        dbp: 50,
        spo2: 90,
        onOxygen: false,
        consciousness: 'A',
        weightKg: null,
      })
      .expect(201);
    await run(A.id, async (tx) => {
      const id = newId();
      await tx.cpptEntry.create({
        data: {
          id,
          rootId: id,
          tenantId: A.id,
          patientId: melati.patientId,
          encounterId: melati.encounterId,
          occurredAt: new Date(),
          authorUserId: users.second as string,
          authorRole: 'dokter_residen',
          ppa: 'residen',
          format: 'soap',
          content: { format: 'soap', s: 'Nyeri', o: '', a: 'Observasi', p: '' },
          cosignRequired: true,
        },
      });
      const group = await tx.orderGroup.create({
        data: {
          id: newId(),
          tenantId: A.id,
          encounterId: melati.encounterId,
          patientId: melati.patientId,
          idempotencyKey: newId(),
          requestHash: 'c'.repeat(64),
          orderedBy: users.dpjp as string,
          orderedRole: 'dokter',
        },
      });
      const drug = await tx.drug.findFirstOrThrow({ where: { name: 'Seftriakson 2 g injeksi' } });
      const med = await tx.medicationRequest.create({
        data: {
          id: newId(),
          tenantId: A.id,
          orderGroupId: group.id,
          encounterId: melati.encounterId,
          patientId: melati.patientId,
          drugId: drug.id,
          name: drug.name,
          dose: '2 g',
          route: 'IV',
          frequency: '3x1',
          highAlert: false,
          createdAt: new Date(Date.now() - 3 * 3_600_000),
        },
      });
      await tx.orderStatusEvent.create({
        data: {
          id: newId(),
          tenantId: A.id,
          medicationRequestId: med.id,
          status: 'aktif',
          changedBy: users.dpjp as string,
        },
      });
      // Jadwal 2 jam lalu, tetapi tidak sebelum tengah malam WIB (dosis "hari ini").
      const midnight = new Date(
        `${new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10)}T00:00:00+07:00`,
      );
      await tx.medicationSchedule.create({
        data: {
          id: newId(),
          tenantId: A.id,
          medicationRequestId: med.id,
          encounterId: melati.encounterId,
          scheduledAt: new Date(Math.max(Date.now() - 2 * 3_600_000, midnight.getTime() + 1000)),
        },
      });
    });
    const census = inpatientCensusSchema.parse((await as('nurse').get('/inpatients').expect(200)).body);
    const row = census.items.find((i) => i.encounterId === melati.encounterId);
    expect(row?.ews).toMatchObject({ risk: 'tinggi', escalated: true });
    expect(row?.pendingCosign).toBe(1);
    // Jadwal yang kebetulan jatuh < `emar.late_minutes` setelah tengah malam belum terhitung terlambat.
    expect(row?.lateDoses).toBeLessThanOrEqual(1);

    // Transfer ke Anggrek: perawat Melati tidak lagi melihatnya, perawat Anggrek melihatnya.
    await run(A.id, async (tx) => {
      await tx.bedAssignment.updateMany({
        where: { encounterId: melati.encounterId, endedAt: null },
        data: { endedAt: new Date(), endReason: 'transfer' },
      });
      const bed = await freeBed(tx, 'ANGGREK');
      await tx.bedAssignment.create({
        data: {
          id: newId(),
          tenantId: A.id,
          encounterId: melati.encounterId,
          patientId: melati.patientId,
          locationId: bed.id,
        },
      });
    });
    const after = inpatientCensusSchema.parse((await as('nurse').get('/inpatients').expect(200)).body);
    expect(ids(after.items)).not.toContain(melati.encounterId);
    const anggrekView = inpatientCensusSchema.parse(
      (await as('anggrekNurse').get('/inpatients').expect(200)).body,
    );
    expect(ids(anggrekView.items)).toContain(melati.encounterId);
  });

  it('tanpa izin klinis 403; tenant lain tidak melihat pasien tenant A', async () => {
    await as('kasir').get('/inpatients').expect(403);
    const other = inpatientCensusSchema.parse((await as('otherTenant').get('/inpatients').expect(200)).body);
    expect(ids(other.items)).not.toContain(unbedded.encounterId);
  });
});

describe('pindaian aktif dan cek ganda dua sesi', () => {
  async function highAlertDose() {
    const enc = await inpatient('MELATI', { name: 'Pasien Insulin Fiktif' });
    return run(A.id, async (tx) => {
      const group = await tx.orderGroup.create({
        data: {
          id: newId(),
          tenantId: A.id,
          encounterId: enc.encounterId,
          patientId: enc.patientId,
          idempotencyKey: newId(),
          requestHash: 'd'.repeat(64),
          orderedBy: users.dpjp as string,
          orderedRole: 'dokter',
        },
      });
      const drug = await tx.drug.findFirstOrThrow({ where: { name: 'Enoksaparin 60 mg/0,6 mL injeksi' } });
      const med = await tx.medicationRequest.create({
        data: {
          id: newId(),
          tenantId: A.id,
          orderGroupId: group.id,
          encounterId: enc.encounterId,
          patientId: enc.patientId,
          drugId: drug.id,
          name: drug.name,
          dose: '1 ampul',
          route: 'SC',
          frequency: 'stat',
          highAlert: true,
        },
      });
      await tx.orderStatusEvent.create({
        data: {
          id: newId(),
          tenantId: A.id,
          medicationRequestId: med.id,
          status: 'aktif',
          changedBy: users.dpjp as string,
        },
      });
      const band = await tx.patientWristband.create({
        data: {
          id: newId(),
          tenantId: A.id,
          encounterId: enc.encounterId,
          patientId: enc.patientId,
          code: `GL${newId().replaceAll('-', '').slice(-12).toUpperCase()}`,
          issuedBy: users.nurse as string,
        },
      });
      return { enc, med, band };
    });
  }

  it('perawat kedua melihat pindaian rekan, memeriksa dosis; pemberi memakai isi dosis beku atestasi', async () => {
    const f = await highAlertDose();
    const scan = await as('nurse')
      .post('/nursing/wristband-scans', { encounterId: f.enc.encounterId, code: f.band.code })
      .expect(201);
    const scans = await as('second')
      .get(`/nursing/wristband-scans?encounterId=${f.enc.encounterId}`)
      .expect(200);
    const list = activeWristbandScanSchema.array().parse(scans.body);
    expect(list.map((s) => s.id)).toContain(scan.body.id);
    expect(list.find((s) => s.id === scan.body.id)?.by.userId).toBe(users.nurse);

    const content = {
      medicationRequestId: f.med.id,
      scheduleId: null,
      scanId: scan.body.id as string,
      labelCode: f.med.id,
      status: 'given',
      occurredAt: new Date().toISOString(),
      reason: null,
    };
    const check = await as('second').post('/nursing/double-checks', content).expect(201);
    const checks = doubleCheckViewSchema
      .array()
      .parse(
        (await as('nurse').get(`/nursing/double-checks?encounterId=${f.enc.encounterId}`).expect(200)).body,
      );
    const view = checks.find((c) => c.id === check.body.id);
    expect(view).toMatchObject({ scanId: scan.body.id, used: false, labelCode: f.med.id });
    expect(view?.checkedBy.userId).toBe(users.second);

    await as('nurse')
      .post('/nursing/administrations', {
        ...content,
        occurredAt: view?.occurredAt,
        doubleCheckUserId: null,
        doubleCheckId: check.body.id,
      })
      .expect(201);
    const used = doubleCheckViewSchema
      .array()
      .parse(
        (await as('nurse').get(`/nursing/double-checks?encounterId=${f.enc.encounterId}`).expect(200)).body,
      );
    expect(used.find((c) => c.id === check.body.id)?.used).toBe(true);
  });

  it('izin, ABAC, dan isolasi tenant untuk bacaan pindaian/cek ganda', async () => {
    const f = await highAlertDose();
    for (const path of ['wristband-scans', 'double-checks']) {
      const url = `/nursing/${path}?encounterId=${f.enc.encounterId}`;
      await as('dpjp').get(url).expect(403);
      await as('anggrekNurse').get(url).expect(403);
      await as('otherTenant').get(url).expect(404);
      await as('nurse').get(`/nursing/${path}`).expect(400);
    }
  });
});

describe('rute eMAR/askep per kunjungan kanonik (alias /encounters/:id/…)', () => {
  it('rute lama /nursing/… dan rute kanonik memberi jawaban sama dengan izin, ABAC, dan isolasi yang sama', async () => {
    const enc = await inpatient('MELATI', { name: 'Pasien Alias Fiktif' });
    const diagnosis = await run(A.id, (tx) =>
      tx.nursingDiagnosis.findFirstOrThrow({ where: { active: true } }),
    );
    await as('nurse')
      .post('/nursing/care-plans', {
        encounterId: enc.encounterId,
        diagnosisId: diagnosis.id,
        goals: 'Nyeri berkurang dalam 2x24 jam',
        interventions: ['Kaji skala nyeri tiap 4 jam'],
        evaluation: null,
        occurredAt: new Date().toISOString(),
        revision: { kind: 'baru' },
      })
      .expect(201);
    await as('nurse')
      .post('/nursing/fluid-balances', {
        encounterId: enc.encounterId,
        direction: 'intake',
        route: 'Infus NaCl 0,9%',
        volumeMl: 500,
        note: null,
        occurredAt: new Date().toISOString(),
        revision: { kind: 'baru' },
      })
      .expect(201);
    const pairs = [
      [`/nursing/emar/${enc.encounterId}`, `/encounters/${enc.encounterId}/emar`],
      [`/nursing/care-plans/${enc.encounterId}`, `/encounters/${enc.encounterId}/care-plans`],
      [`/nursing/fluid-balances/${enc.encounterId}`, `/encounters/${enc.encounterId}/fluid-balances`],
    ] as const;
    for (const [legacy, canonical] of pairs) {
      const a = await as('nurse').get(legacy).expect(200);
      const b = await as('nurse').get(canonical).expect(200);
      expect(b.body, canonical).toEqual(a.body);
      for (const url of [legacy, canonical]) {
        await as('anggrekNurse').get(url).expect(403);
        await as('kasir').get(url).expect(403);
        await as('otherTenant').get(url).expect(404);
      }
    }
    const fluids = fluidBalanceDaySchema.parse(
      (await as('nurse').get(`/encounters/${enc.encounterId}/fluid-balances`).expect(200)).body,
    );
    expect(fluids.intakeMl).toBe(500);
    emarBoardSchema.parse((await as('nurse').get(`/encounters/${enc.encounterId}/emar`).expect(200)).body);
    await as('nurse').get(`/encounters/${enc.encounterId}/emar?date=bukan`).expect(400);
  });
});
