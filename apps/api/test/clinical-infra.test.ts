/**
 * Fase 3 · potongan 3.1 · infrastruktur API klinis: pola entri berversi lewat `ClinicalRecordService` (koreksi serentak
 * [201, 409], penulis dari sesi, penulis asli saja, salah entri, addendum, kunci TTE, entri terlambat), draf hanya
 * penulis, ABAC lingkup unit tingkat bed (perawat Melati → pasien di bed Anggrek 403 + audit; transfer memindah akses),
 * tim perawatan → relasi akses, staging SATUSEHAT `held` tidak diklaim + biaya tanpa harga, temuan "akses pasien
 * rahasia", aliran SSE papan bed dan eskalasi EWS (tanpa bocor antar-tenant). Data fiktif.
 */
import type { AddressInfo } from 'node:net';
import { Body, Controller, Module, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  claimDueOutbox,
  createPrismaClient,
  seedClinicalMasters,
  seedHospitalStructure,
  type TenantTx,
  withTenant,
} from '@simrs/db';
import { testDbUrls } from '@simrs/db/testing';
import {
  type CpptCreateInput,
  cpptCreateInputSchema,
  clinicalEnteredInErrorInputSchema,
  newId,
} from '@simrs/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequirePermission } from '../src/common/require-permission.decorator';
import { TenantScoped } from '../src/common/tenant-scoped.decorator';
import { ZodValidationPipe } from '../src/common/zod-validation.pipe';
import { type CareTeamRole, CareTeamService } from '../src/infra/clinical/care-team.service';
import { ClinicalRecordService } from '../src/infra/clinical/clinical-record.service';
import { ClinicalSigningService } from '../src/infra/clinical/clinical-signing.service';
import { BillableRecorder, SatusehatRecorder } from '../src/infra/clinical/staging';
import { TenantDb } from '../src/infra/tenant-db';
import { AuthzModule } from '../src/modules/authz/authz.module';
import { PatientAccessService } from '../src/modules/authz/patient-access.service';
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

const uuid = new ParseUUIDPipe();

/** Modul klinis tiruan di atas infrastruktur 3.1 (modul sungguhan dibangun potongan 3.2–3.8). */
@TenantScoped()
@Controller('test-clinical')
class ClinicalTestController {
  constructor(
    private readonly records: ClinicalRecordService,
    private readonly satusehat: SatusehatRecorder,
    private readonly billable: BillableRecorder,
    private readonly careTeam: CareTeamService,
    private readonly signing: ClinicalSigningService,
    private readonly access: PatientAccessService,
    private readonly db: TenantDb,
  ) {}

  @RequirePermission('clinical', 'write')
  @Post('cppt')
  async create(@Body(new ZodValidationPipe(cpptCreateInputSchema)) body: CpptCreateInput) {
    const tx = this.db.tx();
    const enc = await tx.encounter.findUniqueOrThrow({ where: { id: body.encounterId } });
    await this.access.assert(enc.patientId);
    const f = await this.records.prepare('cppt_entries', {
      patientId: enc.patientId,
      encounterId: enc.id,
      occurredAt: body.occurredAt,
      revision: body.revision,
    });
    await this.records.insert(() =>
      tx.cpptEntry.create({
        data: {
          ...f,
          ppa: 'dpjp',
          format: body.content.format,
          content: body.content,
          instruction: body.instruction,
        },
      }),
    );
    await this.billable.record({
      encounterId: enc.id,
      patientId: enc.patientId,
      sourceType: 'cppt_entries',
      sourceId: f.rootId,
      kind: 'visite',
      occurredAt: f.occurredAt,
    });
    await this.satusehat.record('Composition', f.id, f.version);
    const row = await tx.cpptEntry.findUniqueOrThrow({ where: { id: f.id } });
    return (await this.records.meta('cppt_entries', [row])).get(row.id);
  }

  @RequirePermission('clinical', 'correct')
  @Post('cppt/:id/entered-in-error')
  enteredInError(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(clinicalEnteredInErrorInputSchema)) body: { reason: string },
  ) {
    return this.records.enteredInError('cppt_entries', id, body.reason);
  }

  /** TTE lewat `ClinicalSigningService` (PDF ADR-0029) di bawah kunci versi; izin uji `clinical.write` (lingkup unit). */
  @RequirePermission('clinical', 'write')
  @Post('cppt/:id/sign')
  async sign(@Param('id', uuid) id: string) {
    const row = await this.db.tx().cpptEntry.findUniqueOrThrow({ where: { id } });
    const issued = await this.signing.issueSigned('cppt_entries', id, {
      patientId: row.patientId,
      kind: 'lainnya',
      title: 'Catatan perkembangan pasien terintegrasi',
      fileName: 'cppt',
      issuedAt: row.recordedAt,
      sections: [{ title: 'Asesmen', blocks: [{ kind: 'paragraph', text: 'Pneumonia membaik.' }] }],
      tte: { role: 'Dokter penanggung jawab pelayanan (DPJP)', caption: null },
    });
    return { documentId: issued.document.id, signatureId: issued.signatureId };
  }

  @RequirePermission('clinical', 'write')
  @Post('care-team')
  addMember(@Body() body: { encounterId: string; userId: string; role: CareTeamRole }) {
    return this.careTeam.add(body);
  }

  @RequirePermission('clinical', 'write')
  @Post('care-team/:id/end')
  async endMember(@Param('id', uuid) id: string) {
    await this.careTeam.end(id, 'Alih rawat ke DPJP lain');
    return { ok: true };
  }
}

@Module({ imports: [AuthzModule], controllers: [ClinicalTestController] })
class ClinicalTestModule {}

let app: NestExpressApplication;
let port: number;
let A: { id: string; code: string };
let B: { id: string; code: string };
const tok: Record<string, Tokens> = {};
const users: Record<string, string> = {};
const unit: Record<string, string> = {};
const beds: Record<string, string[]> = {};

const run = <R>(tenantId: string, fn: (tx: TenantTx) => Promise<R>) => withTenant(testDb(), tenantId, fn);
const as = (who: string) => {
  const auth = () => bearer(tok[who] as Tokens);
  const http = () => request(app.getHttpServer());
  return {
    get: (url: string) => http().get(`/api/v1${url}`).set(auth()),
    post: (url: string, body: object = {}) => http().post(`/api/v1${url}`).set(auth()).send(body),
    put: (url: string, body: object) => http().put(`/api/v1${url}`).set(auth()).send(body),
    del: (url: string) => http().delete(`/api/v1${url}`).set(auth()),
  };
};

async function clinicalTenant() {
  const t = await createTestTenant();
  const owner = createPrismaClient({ connectionString: testDbUrls().migrator, max: 1 });
  try {
    await withTenant(owner, t.id, async (tx) => {
      await seedHospitalStructure(tx, t.id);
      await seedClinicalMasters(tx, t.id);
    });
  } finally {
    await owner.$disconnect();
  }
  return t;
}

let seq = 0;
/** Pasien rawat inap aktif di unit `unitCode`, menempati bed ke-`bedIndex` unit itu. */
async function inpatient(tenantId: string, unitCode = 'MELATI', bedIndex = 0) {
  const p = await createTestPatient(tenantId, { name: 'Pasien Klinis Fiktif' });
  seq += 1;
  return run(tenantId, async (tx) => {
    const units = await tx.unit.findMany({ select: { id: true, code: true } });
    const u = units.find((x) => x.code === unitCode)?.id as string;
    // Bed kosong pertama di unit itu (EXCLUDE hunian ganda); `bedIndex` = lewati sejumlah bed kosong.
    const occupied = (
      await tx.bedAssignment.findMany({ where: { endedAt: null }, select: { locationId: true } })
    ).map((a) => a.locationId);
    const bed = (
      await tx.location.findMany({
        where: { kind: 'bed', unitId: u, id: { notIn: occupied } },
        orderBy: { code: 'asc' },
      })
    )[bedIndex];
    const enc = await tx.encounter.create({
      data: {
        id: newId(),
        tenantId,
        number: `RI-2610-${String(Date.now() % 1e5).padStart(5, '0')}${seq}`,
        patientId: p.id,
        encounterClass: 'IMP',
        status: 'in_progress',
        unitId: u,
        plannedAt: new Date(),
      },
    });
    const assignment = await tx.bedAssignment.create({
      data: {
        id: newId(),
        tenantId,
        encounterId: enc.id,
        patientId: p.id,
        locationId: bed?.id as string,
        startedAt: new Date(),
      },
    });
    return { patientId: p.id, encounterId: enc.id, assignmentId: assignment.id };
  });
}

const cpptBody = (encounterId: string, revision: object = { kind: 'baru' }, over: object = {}) => ({
  encounterId,
  occurredAt: new Date(Date.now() - 60_000).toISOString(),
  content: {
    format: 'soap',
    s: 'Sesak berkurang',
    o: 'SpO2 96%',
    a: 'Pneumonia membaik',
    p: 'Lanjut terapi',
  },
  instruction: null,
  revision,
  ...over,
});

beforeAll(async () => {
  app = await createTestApp({}, { imports: [ClinicalTestModule] });
  await app.listen(0, '127.0.0.1');
  port = (app.getHttpServer().address() as AddressInfo).port;
  A = await clinicalTenant();
  B = await clinicalTenant();
  for (const u of await run(A.id, (tx) => tx.unit.findMany({ select: { id: true, code: true } })))
    unit[u.code] = u.id;
  for (const code of ['MELATI', 'ANGGREK']) {
    beds[code] = (
      await run(A.id, (tx) =>
        tx.location.findMany({ where: { kind: 'bed', unitId: unit[code] }, orderBy: { code: 'asc' } }),
      )
    ).map((b) => b.id);
  }
  for (const [who, t, role, unitCode] of [
    ['dokter', A, 'dokter', 'MELATI'],
    ['dokter2', A, 'dokter', 'MELATI'],
    ['dokterLuar', A, 'dokter', undefined],
    ['perawatMelati', A, 'perawat', 'MELATI'],
    ['perawatAnggrek', A, 'perawat', 'ANGGREK'],
    ['daftar', A, 'petugas_pendaftaran', undefined],
    ['privasi', A, 'petugas_privasi', undefined],
    ['daftarB', B, 'petugas_pendaftaran', undefined],
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

describe('ClinicalRecordService · pola entri berversi', () => {
  it('versi 1: penulis + waktu catat dari server; field penulis di body ditolak', async () => {
    const e = await inpatient(A.id);
    const r = await as('dokter').post('/test-clinical/cppt', cpptBody(e.encounterId)).expect(201);
    expect(r.body).toMatchObject({
      version: 1,
      status: 'final',
      lateEntry: false,
      locked: false,
      author: { userId: users.dokter, peran: 'dokter' },
    });
    for (const extra of [
      { author: 'dr. Palsu' },
      { authorUserId: users.dokter2 },
      { recordedAt: new Date() },
    ]) {
      const bad = await as('dokter').post('/test-clinical/cppt', cpptBody(e.encounterId, undefined, extra));
      expect(bad.status, Object.keys(extra)[0]).toBe(400);
    }
    // Kejadian di masa depan ditolak; 30 jam lalu = entri terlambat (`clinical.late_entry_hours` 24).
    const future = await as('dokter').post(
      '/test-clinical/cppt',
      cpptBody(e.encounterId, undefined, { occurredAt: new Date(Date.now() + 3_600_000).toISOString() }),
    );
    expect(future.status).toBe(422);
    const late = await as('dokter')
      .post(
        '/test-clinical/cppt',
        cpptBody(e.encounterId, undefined, {
          occurredAt: new Date(Date.now() - 30 * 3_600_000).toISOString(),
        }),
      )
      .expect(201);
    expect(late.body.lateEntry).toBe(true);
  });

  it('koreksi serentak atas versi yang sama → [201, 409 RECORD_SUPERSEDED]', async () => {
    const e = await inpatient(A.id);
    const v1 = await as('dokter').post('/test-clinical/cppt', cpptBody(e.encounterId)).expect(201);
    const correction = {
      kind: 'koreksi',
      supersedesId: v1.body.id,
      correctionReason: 'Salah tulis SpO2 pasien',
    };
    const results = await Promise.all(
      [0, 1].map(() => as('dokter').post('/test-clinical/cppt', cpptBody(e.encounterId, correction))),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const conflict = results.find((r) => r.status === 409);
    expect(conflict?.body.code).toBe('RECORD_SUPERSEDED');
    const ok = results.find((r) => r.status === 201);
    expect(ok?.body).toMatchObject({ version: 2, supersedesId: v1.body.id, rootId: v1.body.id });
  });

  it('koreksi hanya oleh penulis asli (403); PPA lain menambah addendum; addendum atas versi lama ditolak', async () => {
    const e = await inpatient(A.id);
    const v1 = await as('dokter').post('/test-clinical/cppt', cpptBody(e.encounterId)).expect(201);
    const byOther = await as('dokter2').post(
      '/test-clinical/cppt',
      cpptBody(e.encounterId, {
        kind: 'koreksi',
        supersedesId: v1.body.id,
        correctionReason: 'Bukan penulisnya',
      }),
    );
    expect(byOther.status).toBe(403);
    expect(byOther.body.code).toBe('RECORD_NOT_AUTHOR');
    const add = await as('perawatMelati')
      .post('/test-clinical/cppt', cpptBody(e.encounterId, { kind: 'addendum', addendumOf: v1.body.id }))
      .expect(201);
    expect(add.body).toMatchObject({ addendumOf: v1.body.id, version: 1, author: { peran: 'perawat' } });
    await as('dokter')
      .post(
        '/test-clinical/cppt',
        cpptBody(e.encounterId, {
          kind: 'koreksi',
          supersedesId: v1.body.id,
          correctionReason: 'Tambah hasil EKG',
        }),
      )
      .expect(201);
    const stale = await as('perawatMelati').post(
      '/test-clinical/cppt',
      cpptBody(e.encounterId, { kind: 'addendum', addendumOf: v1.body.id }),
    );
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('RECORD_NOT_FINAL');
  });

  it('salah entri: versi baru berisi sama berstatus entered_in_error; versi lama tidak bisa dikoreksi lagi', async () => {
    const e = await inpatient(A.id);
    const v1 = await as('dokter').post('/test-clinical/cppt', cpptBody(e.encounterId)).expect(201);
    const err = await as('dokter')
      .post(`/test-clinical/cppt/${v1.body.id}/entered-in-error`, {
        reason: 'Dicatat pada pasien yang salah',
      })
      .expect(201);
    const rows = await run(A.id, (tx) =>
      tx.cpptEntry.findMany({ where: { rootId: v1.body.id }, orderBy: { version: 'asc' } }),
    );
    expect(rows.map((r) => [r.version, r.status])).toEqual([
      [1, 'final'],
      [2, 'entered_in_error'],
    ]);
    expect(rows[1]?.id).toBe(err.body.id);
    expect(rows[1]?.content).toEqual(rows[0]?.content);
    const again = await as('dokter').post(`/test-clinical/cppt/${v1.body.id}/entered-in-error`, {
      reason: 'Ditandai dua kali',
    });
    expect(again.status).toBe(409);
  });

  it('versi ber-TTE terkunci: koreksi → 409 RECORD_LOCKED, addendum boleh; versi tergantikan tidak bisa di-TTE', async () => {
    const e = await inpatient(A.id);
    const v1 = await as('dokter').post('/test-clinical/cppt', cpptBody(e.encounterId)).expect(201);
    const signed = await as('dokter').post(`/test-clinical/cppt/${v1.body.id}/sign`).expect(201);
    expect(signed.body.signatureId).toEqual(expect.any(String));
    const doc = await run(A.id, (tx) =>
      tx.document.findUniqueOrThrow({ where: { id: signed.body.documentId } }),
    );
    expect(doc).toMatchObject({
      sourceType: 'cppt_entries',
      sourceId: v1.body.id,
      mimeType: 'application/pdf',
    });
    const locked = await as('dokter').post(
      '/test-clinical/cppt',
      cpptBody(e.encounterId, {
        kind: 'koreksi',
        supersedesId: v1.body.id,
        correctionReason: 'Setelah TTE diminta',
      }),
    );
    expect(locked.status).toBe(409);
    expect(locked.body.code).toBe('RECORD_LOCKED');
    await as('perawatMelati')
      .post('/test-clinical/cppt', cpptBody(e.encounterId, { kind: 'addendum', addendumOf: v1.body.id }))
      .expect(201);

    const v2src = await as('dokter').post('/test-clinical/cppt', cpptBody(e.encounterId)).expect(201);
    await as('dokter')
      .post(
        '/test-clinical/cppt',
        cpptBody(e.encounterId, {
          kind: 'koreksi',
          supersedesId: v2src.body.id,
          correctionReason: 'Revisi rencana',
        }),
      )
      .expect(201);
    const signOld = await as('dokter').post(`/test-clinical/cppt/${v2src.body.id}/sign`);
    expect(signOld.status).toBe(409);
    expect(signOld.body.code).toBe('RECORD_SUPERSEDED');
  });

  it('staging: SATUSEHAT `held` tidak diklaim dispatcher; biaya tanpa harga idempoten per sumber', async () => {
    const e = await inpatient(A.id);
    const v1 = await as('dokter').post('/test-clinical/cppt', cpptBody(e.encounterId)).expect(201);
    const msgs = await run(A.id, (tx) =>
      tx.outboxMessage.findMany({
        where: { idempotencyKey: `satusehat.composition.upsert:${v1.body.id}:1` },
      }),
    );
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({
      status: 'held',
      target: 'satusehat',
      payload: { sourceId: v1.body.id, revision: 1 },
    });
    const claimed = await run(A.id, (tx) => claimDueOutbox(tx, 1000, new Date(Date.now() + 86_400_000)));
    expect(claimed.map((m) => m.id)).not.toContain(msgs[0]?.id);
    await as('dokter')
      .post(
        '/test-clinical/cppt',
        cpptBody(e.encounterId, {
          kind: 'koreksi',
          supersedesId: v1.body.id,
          correctionReason: 'Koreksi kecil isi',
        }),
      )
      .expect(201);
    const billable = await run(A.id, (tx) =>
      tx.billableEvent.findMany({ where: { sourceType: 'cppt_entries', sourceId: v1.body.id } }),
    );
    expect(billable).toHaveLength(1);
    expect(billable[0]).toMatchObject({ kind: 'visite', quantity: 1 });
  });
});

describe('draf klinis', () => {
  it('PUT/GET/DELETE hanya milik penulis sesi', async () => {
    const e = await inpatient(A.id);
    const url = `/drafts/${e.encounterId}/cppt`;
    await as('dokter')
      .put(url, { content: { s: 'draf sementara' } })
      .expect(200);
    const mine = await as('dokter').get(url).expect(200);
    expect(mine.body).toMatchObject({
      encounterId: e.encounterId,
      kind: 'cppt',
      content: { s: 'draf sementara' },
    });
    await as('dokter2').get(url).expect(404);
    await as('dokter2').del(url).expect(204);
    await as('dokter').get(url).expect(200);
    await as('dokter').del(url).expect(204);
    await as('dokter').get(url).expect(404);
    expect((await as('dokter').put(`/drafts/${e.encounterId}/BUKAN JENIS`, { content: {} })).status).toBe(
      400,
    );
    expect((await as('daftar').put(url, { content: {} })).status).toBe(403);
  });
});

describe('ABAC lingkup unit tingkat bed (ADR-0031)', () => {
  it('perawat Melati → pasien di bed Anggrek 403 + audit; transfer memindah akses', async () => {
    const e = await inpatient(A.id, 'MELATI');
    const url = `/drafts/${e.encounterId}/asesmen:awal`;
    await as('perawatMelati')
      .put(url, { content: { a: 1 } })
      .expect(200);
    expect((await as('perawatAnggrek').put(url, { content: { a: 1 } })).status).toBe(403);

    // Transfer: penempatan Melati ditutup, bed Anggrek mulai. Kunjungan tetap tercatat di unit Melati.
    const at = new Date();
    await run(A.id, async (tx) => {
      await tx.bedAssignment.update({
        where: { id: e.assignmentId },
        data: { endedAt: at, endReason: 'transfer', endedBy: users.perawatMelati },
      });
      await tx.bedAssignment.create({
        data: {
          id: newId(),
          tenantId: A.id,
          encounterId: e.encounterId,
          patientId: e.patientId,
          locationId: beds.ANGGREK?.[7] as string,
          startedAt: at,
        },
      });
    });
    const denied = await as('perawatMelati').put(url, { content: { a: 2 } });
    expect(denied.status).toBe(403);
    expect(denied.body.details).toMatchObject({ breakGlassAvailable: true });
    await as('perawatAnggrek')
      .put(url, { content: { a: 3 } })
      .expect(200);
    const audit = await run(A.id, (tx) =>
      tx.auditEvent.findMany({
        where: { action: 'access_denied', patientId: e.patientId, actorUserId: users.perawatMelati },
      }),
    );
    expect(audit.length).toBeGreaterThanOrEqual(1);
  });

  it('tim perawatan: DPJP tanpa unit mendapat akses lewat relasi; berakhir = relasi sampai akhir hari berikutnya', async () => {
    const e = await inpatient(A.id, 'ANGGREK');
    const url = `/drafts/${e.encounterId}/cppt`;
    expect((await as('dokterLuar').get(url)).status).toBe(403);
    const member = await as('dokter')
      .post('/test-clinical/care-team', {
        encounterId: e.encounterId,
        userId: users.dokterLuar,
        role: 'dpjp_utama',
      })
      .expect(201);
    expect((await as('dokterLuar').get(url)).status).toBe(404);
    const dup = await as('dokter').post('/test-clinical/care-team', {
      encounterId: e.encounterId,
      userId: users.dokter2,
      role: 'dpjp_utama',
    });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('PRIMARY_DPJP_EXISTS');
    await as('dokter').post(`/test-clinical/care-team/${member.body.id}/end`).expect(201);
    const rel = await run(A.id, (tx) =>
      tx.accessRelationship.findFirstOrThrow({
        where: { sourceType: 'encounter_participant', sourceId: member.body.id },
      }),
    );
    expect(rel.kind).toBe('dpjp');
    expect(rel.validUntil?.getTime()).toBeGreaterThan(Date.now() + 86_400_000 - 1);
    expect((await as('dokterLuar').get(url)).status).toBe(404);
  });
});

describe('temuan audit pasien rahasia (EP 10c)', () => {
  it('akses rekam medis pasien rahasia muncul sebagai temuan `confidential`', async () => {
    const e = await inpatient(A.id, 'ANGGREK');
    await run(A.id, (tx) => tx.patient.update({ where: { id: e.patientId }, data: { confidential: true } }));
    const url = `/drafts/${e.encounterId}/cppt`;
    await as('perawatAnggrek')
      .put(url, { content: { s: 'x' } })
      .expect(200);
    await as('perawatAnggrek').get(url).expect(200);
    const r = await as('privasi').get('/audit/anomalies?days=1').expect(200);
    const finding = (
      r.body.findings as Array<{ kind: string; actor: { id: string } | null; severity: string }>
    ).find((f) => f.kind === 'confidential' && f.actor?.id === users.perawatAnggrek);
    expect(finding).toMatchObject({ severity: 'tinggi' });
  });
});

/** Klien SSE minimal (fetch + frame `\n\n`). */
async function openStream(who: string, path: string) {
  const controller = new AbortController();
  const res = await fetch(`http://127.0.0.1:${port}/api/v1/clinical/streams/${path}`, {
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

const settle = () => new Promise((r) => setTimeout(r, 300));

describe('aliran SSE klinis', () => {
  it('papan bed: perubahan status bed RS ini terkirim, RS lain tidak', async () => {
    const s = await openStream('daftar', 'bed-board');
    try {
      expect(s.status).toBe(200);
      await settle();
      const [mine, other] = await Promise.all([
        run(A.id, (tx) => tx.bedStatus.findFirstOrThrow({ where: { locationId: beds.MELATI?.[8] } })),
        run(B.id, (tx) => tx.bedStatus.findFirstOrThrow({ where: { location: { kind: 'bed' } } })),
      ]);
      await run(B.id, (tx) =>
        tx.bedStatus.update({
          where: { id: other.id },
          data: { status: 'kotor', version: other.version + 1 },
        }),
      );
      await run(A.id, (tx) =>
        tx.bedStatus.update({ where: { id: mine.id }, data: { status: 'rusak', version: mine.version + 1 } }),
      );
      await s.waitFor(() => s.events.some((e) => e.data.bedId === mine.locationId));
      expect(s.events.find((e) => e.data.bedId === mine.locationId)).toMatchObject({
        event: 'bed.status',
        data: { status: 'rusak', unitId: unit.MELATI },
      });
      expect(s.events.some((e) => e.data.bedId === other.locationId)).toBe(false);
    } finally {
      s.close();
    }
  });

  it('eskalasi EWS: hanya di atas ambang, hanya unit penugasan (dokter Melati)', async () => {
    const inMelati = await inpatient(A.id, 'MELATI');
    const inAnggrek = await inpatient(A.id, 'ANGGREK');
    const s = await openStream('dokter', 'ews');
    try {
      expect(s.status).toBe(200);
      await settle();
      const vital = (e: { patientId: string; encounterId: string }, ewsScore: number, ewsMaxParam: number) =>
        run(A.id, (tx) => {
          const id = newId();
          return tx.observation.create({
            data: {
              id,
              rootId: id,
              tenantId: A.id,
              patientId: e.patientId,
              encounterId: e.encounterId,
              occurredAt: new Date(),
              authorUserId: users.perawatMelati as string,
              authorRole: 'perawat',
              category: 'vital',
              display: 'Tanda vital',
              ewsScore,
              ewsMaxParam,
            },
          });
        });
      const low = await vital(inMelati, 2, 1);
      const otherUnit = await vital(inAnggrek, 8, 3);
      const high = await vital(inMelati, 7, 3);
      await s.waitFor(() => s.events.some((e) => e.data.observationId === high.id));
      expect(s.events.find((e) => e.data.observationId === high.id)).toMatchObject({
        event: 'ews.escalation',
        data: { score: 7, risk: 'tinggi', unitId: unit.MELATI, encounterId: inMelati.encounterId },
      });
      expect(s.events.some((e) => e.data.observationId === low.id)).toBe(false);
      expect(s.events.some((e) => e.data.observationId === otherUnit.id)).toBe(false);
    } finally {
      s.close();
    }
  });

  it('papan IGD butuh clinical.read; tanpa izin 403', async () => {
    const s = await openStream('privasi', 'ed-board');
    s.close();
    expect(s.status).toBe(403);
  });
});
