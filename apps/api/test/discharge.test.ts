/**
 * Fase 3 · potongan 3.6 · resume medis + rekonsiliasi obat + TTE, gerbang tutup kunjungan, surat keterangan kematian
 * (K13, EP 5c, keputusan K-1): isi resume = data sumber (dengan ref), 12 butir server, rekonsiliasi hanya DPJP, versi
 * ber-TTE terkunci (koreksi → 409 `RECORD_LOCKED`, addendum boleh), tutup tanpa resume → 409, penutupan poli → tiket
 * selesai (task 5), semua jalur K-1 (admisi ditolak, dokter tanpa relasi ditolak, ICD-10 wajib dari rujukan, TTE
 * dokter), staging SATUSEHAT `held` Composition + Encounter, isolasi tenant. Data fiktif.
 */
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
import {
  deathCertificateSchema,
  type DischargeDraftInput,
  dischargeSummaryViewSchema,
  newId,
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
  type Tokens,
  testDb,
} from './helpers';

let app: NestExpressApplication;
let A: { id: string; code: string };
let B: { id: string; code: string };
const tok: Record<string, Tokens> = {};
const users: Record<string, string> = {};
const unit: Record<string, string> = {};

const run = <R>(tenantId: string, fn: (tx: TenantTx) => Promise<R>) => withTenant(testDb(), tenantId, fn);
const as = (who: string) => {
  const auth = () => bearer(tok[who] as Tokens);
  const http = () => request(app.getHttpServer());
  return {
    get: (url: string) => http().get(`/api/v1${url}`).set(auth()),
    post: (url: string, body: object = {}) => http().post(`/api/v1${url}`).set(auth()).send(body),
    put: (url: string, body: object = {}) => http().put(`/api/v1${url}`).set(auth()).send(body),
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
    await seedFrontOffice(owner, t.id);
  } finally {
    await owner.$disconnect();
  }
  return t;
}

let seq = 0;
/** Kunjungan aktif + tim (DPJP utama, perawat PJ). `IMP` di bed Melati, `EMER` di IGD, `AMB` di Poli Dalam. */
async function encounter(
  cls: 'IMP' | 'EMER' | 'AMB',
  team: Array<[string, string]> = [
    ['dokter', 'dpjp_utama'],
    ['perawat', 'perawat_pj'],
  ],
  opts: { ticketStatus?: string } = {},
) {
  const p = await createTestPatient(A.id, { name: 'Pasien Resume Fiktif', birthDate: '1961-03-02' });
  seq += 1;
  return run(A.id, async (tx) => {
    const unitCode = cls === 'IMP' ? 'MELATI' : cls === 'EMER' ? 'IGD' : 'POLI-DALAM';
    const u = (await tx.unit.findFirstOrThrow({ where: { code: unitCode } })).id;
    let ticketId: string | null = null;
    if (cls === 'AMB') {
      const svc = await tx.queueService.findFirstOrThrow({ where: { code: 'PD' } });
      ticketId = newId();
      await tx.queueTicket.create({
        data: {
          id: ticketId,
          tenantId: A.id,
          serviceId: svc.id,
          serviceDate: new Date(new Date().toISOString().slice(0, 10)),
          seq: 500 + seq,
          ticketNo: `PD-${String(500 + seq).padStart(3, '0')}`,
          patientId: p.id,
          source: 'loket',
          status: opts.ticketStatus ?? 'serving',
        },
      });
    }
    const enc = await tx.encounter.create({
      data: {
        id: newId(),
        tenantId: A.id,
        number: `${cls}-2610-${String(Date.now() % 1e5).padStart(5, '0')}${seq}`,
        patientId: p.id,
        encounterClass: cls,
        status: cls === 'AMB' ? 'arrived' : 'in_progress',
        unitId: u,
        arrivedAt: new Date(Date.now() - 3 * 86_400_000),
        startedAt: cls === 'AMB' ? null : new Date(Date.now() - 3 * 86_400_000),
        plannedAt: cls === 'IMP' ? new Date(Date.now() - 3 * 86_400_000) : null,
        arrivalMode: cls === 'EMER' ? 'datang_sendiri' : null,
        queueTicketId: ticketId,
      },
    });
    if (cls === 'IMP') {
      const occupied = (
        await tx.bedAssignment.findMany({ where: { endedAt: null }, select: { locationId: true } })
      ).map((a) => a.locationId);
      const bed = await tx.location.findFirstOrThrow({
        where: { kind: 'bed', unitId: u, id: { notIn: occupied } },
        orderBy: { code: 'asc' },
      });
      await tx.bedAssignment.create({
        data: { id: newId(), tenantId: A.id, encounterId: enc.id, patientId: p.id, locationId: bed.id },
      });
    }
    for (const [who, role] of team) {
      const pid = newId();
      await tx.encounterParticipant.create({
        data: { id: pid, tenantId: A.id, encounterId: enc.id, userId: users[who] as string, role },
      });
      await tx.accessRelationship.create({
        data: {
          id: newId(),
          tenantId: A.id,
          userId: users[who] as string,
          patientId: p.id,
          kind: role === 'perawat_pj' ? 'perawat_penanggung_jawab' : role === 'dpjp_utama' ? 'dpjp' : role,
          validFrom: new Date(Date.now() - 60_000),
          sourceType: 'encounter_participant',
          sourceId: pid,
        },
      });
    }
    return { patientId: p.id, encounterId: enc.id, ticketId };
  });
}

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const baru = { kind: 'baru' } as const;

const vitals = (encounterId: string, m: number, over: object = {}) => ({
  encounterId,
  occurredAt: minutesAgo(m),
  temp: 38.9,
  hr: 112,
  rr: 28,
  sbp: 150,
  dbp: 95,
  spo2: 91,
  onOxygen: false,
  consciousness: 'A',
  weightKg: null,
  ...over,
});

/** Sumber klinis kunjungan: dua TTV (masuk/pulang), CPPT DPJP, diagnosis utama, prosedur, hasil lab. */
async function sources(encounterId: string) {
  const v1 = await as('perawat')
    .post(`/encounters/${encounterId}/observations`, vitals(encounterId, 3000))
    .expect(201);
  const v2 = await as('perawat')
    .post(
      `/encounters/${encounterId}/observations`,
      vitals(encounterId, 30, { temp: 36.8, hr: 80, rr: 18, sbp: 120, dbp: 80, spo2: 97 }),
    )
    .expect(201);
  const cppt = await as('dokter')
    .post('/cppt/entries', {
      encounterId,
      occurredAt: minutesAgo(2900),
      content: {
        format: 'soap',
        s: 'Demam 4 hari, batuk berdahak, sesak napas',
        o: 'Ronki basah paru kanan bawah',
        a: 'Pneumonia komunitas',
        p: 'Antibiotik IV, oksigen nasal',
      },
      instruction: null,
      revision: baru,
    })
    .expect(201);
  const dx = await as('dokter')
    .post('/diagnosis/conditions', {
      encounterId,
      kind: 'encounter',
      role: 'utama',
      code: 'J18.9',
      clinicalStatus: 'active',
      note: null,
      occurredAt: minutesAgo(2800),
      revision: baru,
    })
    .expect(201);
  const proc = await as('dokter')
    .post('/diagnosis/procedures', {
      encounterId,
      code: '89.52',
      note: null,
      occurredAt: minutesAgo(2700),
      revision: baru,
    })
    .expect(201);
  const lab = await as('analis')
    .post('/results/observations', {
      encounterId,
      occurredAt: minutesAgo(2600),
      category: 'lab',
      code: '1988-5',
      display: null,
      valueNumeric: 96,
      valueUnit: 'mg/L',
      valueText: null,
      interpretation: 'tinggi',
      referenceRange: '< 5',
      diagnosticReportId: null,
      revision: baru,
    })
    .expect(201);
  return {
    vitalIds: [v1.body.id as string, v2.body.id as string],
    cpptId: cppt.body.id as string,
    conditionId: dx.body.id as string,
    procedureId: proc.body.id as string,
    labId: lab.body.id as string,
  };
}

const draftBody = (over: Partial<DischargeDraftInput> = {}): DischargeDraftInput => ({
  dischargeAt: new Date().toISOString(),
  disposition: 'pulang',
  dischargeCondition: 'Membaik',
  notes: { anamnesis: null, fisik: null, penunjang: null, terapi: 'Seftriakson 2 g IV 1×24 jam H1–H5' },
  education: 'Cara minum obat dan tanda bahaya sesak dijelaskan ke pasien dan istri',
  instructions: 'Kembali ke IGD bila demam ≥ 38,5 °C atau sesak',
  followUp: 'Kontrol Poli Penyakit Dalam 7 hari',
  medications: [
    { medicationRequestId: null, name: 'Sefiksim 200 mg', sig: '2×1 PO · 4 hari', change: 'baru' },
    { medicationRequestId: null, name: 'Amlodipin 5 mg', sig: 'dihentikan sementara', change: 'dihentikan' },
  ],
  ...over,
});

beforeAll(async () => {
  app = await createTestApp();
  A = await clinicalTenant();
  B = await clinicalTenant();
  for (const u of await run(A.id, (tx) => tx.unit.findMany({ select: { id: true, code: true } })))
    unit[u.code] = u.id;
  for (const [who, t, role, unitCode] of [
    ['dokter', A, 'dokter', 'MELATI'],
    ['dokterLain', A, 'dokter', 'MELATI'],
    ['dokterPoli', A, 'dokter', 'POLI-DALAM'],
    ['dokterIgd', A, 'dokter', 'IGD'],
    ['residen', A, 'dokter_residen', 'MELATI'],
    ['perawat', A, 'perawat', 'MELATI'],
    ['analis', A, 'analis_lab', undefined],
    ['daftar', A, 'petugas_pendaftaran', undefined],
    ['dokterB', B, 'dokter', 'MELATI'],
  ] as const) {
    const unitId = unitCode
      ? (await run(t.id, (tx) => tx.unit.findFirstOrThrow({ where: { code: unitCode } }))).id
      : undefined;
    const u = await createTestUser(t.id, { roles: [{ code: role, unitId }], tenantCode: t.code });
    users[who] = u.id;
    tok[who] = await login(app, u);
  }
});

afterAll(async () => {
  await app?.close();
});

describe('resume medis rawat inap (K13)', () => {
  it('draf dihimpun dari sumber dengan ref; 12 butir server; rekonsiliasi DPJP; TTE terkunci; addendum; tutup', async () => {
    const e = await encounter('IMP', [
      ['dokter', 'dpjp_utama'],
      ['residen', 'rawat_bersama'],
      ['perawat', 'perawat_pj'],
    ]);
    const src = await sources(e.encounterId);

    // Tutup tanpa resume → 409 (rawat inap: disposisi + resume final).
    const blocked = await as('dokter').post(`/encounters/${e.encounterId}/close`, { disposition: 'pulang' });
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('DISCHARGE_BLOCKED');
    expect(JSON.stringify(blocked.body.details)).toContain('Resume medis');

    // Pratinjau sebelum draf.
    const pre = await as('dokter').get(`/encounters/${e.encounterId}/discharge-summary`).expect(200);
    expect(dischargeSummaryViewSchema.parse(pre.body).state).toBe('belum');

    const created = await as('dokter')
      .post('/discharge/summaries', { encounterId: e.encounterId })
      .expect(201);
    const view = dischargeSummaryViewSchema.parse(created.body);
    expect(view.state).toBe('draf');
    expect(view.kind).toBe('rawat_inap');
    // Isi = data sumber, tiap bagian dengan ref sumbernya.
    const sec = (id: string) => view.summary.sections.find((s) => s.id === id);
    expect(sec('anamnesis')?.body).toBe('Demam 4 hari, batuk berdahak, sesak napas');
    expect(sec('fisik')?.body).toContain('TD 150/95 mmHg');
    expect(sec('fisik')?.body).toContain('TD 120/80 mmHg');
    expect(sec('penunjang')?.body).toContain('96 mg/L (tinggi)');
    expect(view.sectionRefs.anamnesis).toEqual([{ type: 'cppt_entries', id: src.cpptId }]);
    expect(view.sectionRefs.fisik).toEqual(
      expect.arrayContaining([
        { type: 'observations', id: src.vitalIds[0] },
        { type: 'observations', id: src.vitalIds[1] },
      ]),
    );
    expect(view.sectionRefs.penunjang).toEqual([{ type: 'observations', id: src.labId }]);
    expect(view.sectionRefs.diagnosis).toEqual([{ type: 'conditions', id: src.conditionId }]);
    expect(view.summary.codes).toEqual([
      expect.objectContaining({ system: 'ICD-10', code: 'J18.9', primary: true }),
      expect.objectContaining({ system: 'ICD-9-CM', code: '89.52', primary: false }),
    ]);

    // Belum lengkap → 422 RESUME_INCOMPLETE (daftar butir yang kurang).
    const incomplete = await as('dokter')
      .post(`/discharge/summaries/${e.encounterId}/finalize`, { revision: baru })
      .expect(422);
    expect(incomplete.body.code).toBe('RESUME_INCOMPLETE');
    expect(incomplete.body.details.missing).toEqual(
      expect.arrayContaining(['terapi', 'rekonsiliasi', 'edukasi', 'instruksi', 'kondisi']),
    );

    await as('dokter').put(`/discharge/summaries/${e.encounterId}/draft`, draftBody()).expect(200);
    // Rekonsiliasi: residen (tanpa clinical.sign) dan dokter di luar tim ditolak; DPJP boleh.
    await as('residen')
      .post(`/discharge/summaries/${e.encounterId}/reconciliation`, { confirmed: true })
      .expect(403);
    await as('dokterLain')
      .post(`/discharge/summaries/${e.encounterId}/reconciliation`, { confirmed: true })
      .expect(403);
    const recon = await as('dokter')
      .post(`/discharge/summaries/${e.encounterId}/reconciliation`, { confirmed: true })
      .expect(200);
    expect(recon.body.reconciliation).not.toBeNull();
    // Mengubah daftar obat membatalkan konfirmasi.
    const changed = await as('dokter')
      .put(
        `/discharge/summaries/${e.encounterId}/draft`,
        draftBody({
          medications: [
            { medicationRequestId: null, name: 'Sefiksim 200 mg', sig: '2×1 PO · 5 hari', change: 'baru' },
          ],
        }),
      )
      .expect(200);
    expect(changed.body.reconciliation).toBeNull();
    await as('dokter')
      .post(`/discharge/summaries/${e.encounterId}/reconciliation`, { confirmed: true })
      .expect(200);
    // Draf generik tidak bisa menulis jenis `resume` (konfirmasi rekonsiliasi tidak bisa dipalsukan).
    await as('dokter')
      .put(`/drafts/${e.encounterId}/resume`, { content: { reconciliation: { confirmedAt: 'x' } } })
      .expect(422);
    // Residen tidak bisa memfinalkan (TTE hanya clinical.sign).
    await as('residen')
      .post(`/discharge/summaries/${e.encounterId}/finalize`, { revision: baru })
      .expect(403);

    const fin = await as('dokter')
      .post(`/discharge/summaries/${e.encounterId}/finalize`, { revision: baru })
      .expect(201);
    const final = dischargeSummaryViewSchema.parse(fin.body);
    expect(final.state).toBe('final');
    expect(final.final?.locked).toBe(true);
    expect(final.final?.document?.signatureStatus).toBe('pending');
    expect(final.summary.signedAt).not.toBeNull();
    expect(final.summary.checklist.every((c) => c.done)).toBe(true);
    expect(final.summary.sections.find((s) => s.id === 'anamnesis')?.body).toBe(
      'Demam 4 hari, batuk berdahak, sesak napas',
    );
    expect(final.summary.sections.find((s) => s.id === 'terapi')?.body).toContain(
      'Catatan DPJP: Seftriakson',
    );
    expect(final.medications).toEqual([
      { medicationRequestId: null, name: 'Sefiksim 200 mg', sig: '2×1 PO · 5 hari', change: 'baru' },
    ]);

    const summaryId = final.final?.id as string;
    const row = await run(A.id, (tx) =>
      tx.dischargeSummary.findUniqueOrThrow({
        where: { id: summaryId },
        include: { sources: true, medications: true },
      }),
    );
    expect(row).toMatchObject({ kind: 'rawat_inap', disposition: 'pulang', reconciliationConfirmed: true });
    expect(row.sources.map((s) => `${s.section}:${s.sourceType}:${s.sourceId}`)).toEqual(
      expect.arrayContaining([
        `anamnesis:cppt_entries:${src.cpptId}`,
        `fisik:observations:${src.vitalIds[0]}`,
        `penunjang:observations:${src.labId}`,
        `diagnosis:conditions:${src.conditionId}`,
        `prosedur:procedures:${src.procedureId}`,
      ]),
    );
    // Staging SATUSEHAT `held` Composition + event discharge.signed + draf dibersihkan.
    const held = await run(A.id, (tx) =>
      tx.outboxMessage.findFirst({
        where: { idempotencyKey: `satusehat.composition.upsert:${summaryId}:1` },
      }),
    );
    expect(held?.status).toBe('held');
    expect(
      await run(A.id, (tx) =>
        tx.domainEvent.count({
          where: { name: 'discharge.signed', payload: { path: ['dischargeSummaryId'], equals: summaryId } },
        }),
      ),
    ).toBe(1);
    expect(
      await run(A.id, (tx) =>
        tx.clinicalDraft.count({ where: { encounterId: e.encounterId, kind: 'resume' } }),
      ),
    ).toBe(0);

    // Menggantikan resume ber-TTE → 409 RECORD_LOCKED; addendum boleh.
    await as('dokter').post('/discharge/summaries', { encounterId: e.encounterId }).expect(409);
    const locked = await as('dokter')
      .post(`/discharge/summaries/${e.encounterId}/finalize`, {
        revision: {
          kind: 'koreksi',
          supersedesId: summaryId,
          correctionReason: 'Salah tulis kondisi pulang',
        },
      })
      .expect(409);
    expect(locked.body.code).toBe('RECORD_LOCKED');
    const add = await as('dokter')
      .post(`/discharge/summaries/${summaryId}/addenda`, {
        text: 'Hasil kultur sputum: S. pneumoniae sensitif seftriakson (keluar setelah pulang)',
      })
      .expect(201);
    const withAdd = dischargeSummaryViewSchema.parse(add.body);
    expect(withAdd.addenda).toHaveLength(1);
    expect(withAdd.addenda[0]?.document?.signatureStatus).toBe('pending');
    expect(withAdd.final?.id).toBe(summaryId);

    // Disposisi berbeda dengan resume → 409; rujuk tanpa surat rujukan → 409.
    const rujuk = await as('dokter').post(`/encounters/${e.encounterId}/close`, { disposition: 'rujuk' });
    expect(rujuk.status).toBe(409);
    expect(JSON.stringify(rujuk.body.details)).toContain('rujukan keluar');
    // Tutup dengan disposisi resume → bed kotor, kunjungan selesai, staging Encounter held.
    const closed = await as('dokter')
      .post(`/encounters/${e.encounterId}/close`, { disposition: 'pulang' })
      .expect(200);
    expect(closed.body).toMatchObject({ encounterId: e.encounterId, disposition: 'pulang' });
    const enc = await run(A.id, (tx) => tx.encounter.findUniqueOrThrow({ where: { id: e.encounterId } }));
    expect(enc).toMatchObject({ status: 'finished', disposition: 'pulang' });
    expect(
      await run(A.id, (tx) =>
        tx.outboxMessage.count({
          where: {
            operation: 'satusehat.encounter.upsert',
            status: 'held',
            payload: { path: ['sourceId'], equals: e.encounterId },
          },
        }),
      ),
    ).toBeGreaterThan(0);
  });

  it('izin + isolasi: perawat tidak bisa TTE; dokter tenant lain 404; IGD tanpa resume', async () => {
    const e = await encounter('IMP');
    await as('perawat').post('/discharge/summaries', { encounterId: e.encounterId }).expect(201);
    await as('perawat')
      .post(`/discharge/summaries/${e.encounterId}/finalize`, { revision: baru })
      .expect(403);
    await as('dokterB').get(`/encounters/${e.encounterId}/discharge-summary`).expect(404);
    await as('dokterB').post('/discharge/summaries', { encounterId: e.encounterId }).expect(404);
    const igd = await encounter('EMER', [['dokterIgd', 'dpjp_utama']]);
    await as('dokterIgd').post('/discharge/summaries', { encounterId: igd.encounterId }).expect(422);
  });
});

describe('resume rawat jalan + penutupan poli (K13, task 5)', () => {
  it('resume RJ ringkas ber-TTE → tutup poli: kunjungan selesai, tiket poli selesai, event task 5', async () => {
    const e = await encounter('AMB', [['dokterPoli', 'dpjp_utama']], { ticketStatus: 'called' });
    await as('dokterPoli')
      .post(`/encounters/${e.encounterId}/observations`, vitals(e.encounterId, 20))
      .expect(201);
    await as('dokterPoli')
      .post('/cppt/entries', {
        encounterId: e.encounterId,
        occurredAt: minutesAgo(15),
        content: {
          format: 'soap',
          s: 'Pusing, tengkuk berat',
          o: 'TD tinggi',
          a: 'Hipertensi',
          p: 'Amlodipin',
        },
        instruction: null,
        revision: baru,
      })
      .expect(201);
    // Tutup tanpa resume → 409.
    const blocked = await as('dokterPoli').post(`/encounters/${e.encounterId}/close`, {
      disposition: 'pulang',
    });
    expect(blocked.status).toBe(409);
    const created = await as('dokterPoli')
      .post('/discharge/summaries', { encounterId: e.encounterId })
      .expect(201);
    expect(created.body.kind).toBe('rawat_jalan');
    expect(created.body.requiredChecks).not.toContain('rekonsiliasi');
    // Diagnosis belum ada → butir diagnosis kurang.
    const inc = await as('dokterPoli')
      .post(`/discharge/summaries/${e.encounterId}/finalize`, { revision: baru })
      .expect(422);
    expect(inc.body.details.missing).toContain('diagnosis');
    await as('dokterPoli')
      .post('/diagnosis/conditions', {
        encounterId: e.encounterId,
        kind: 'encounter',
        role: 'utama',
        code: 'I10',
        clinicalStatus: 'active',
        note: null,
        occurredAt: minutesAgo(10),
        revision: baru,
      })
      .expect(201);
    await as('dokterPoli')
      .put(
        `/discharge/summaries/${e.encounterId}/draft`,
        draftBody({ medications: [], education: null, instructions: null, followUp: 'Kontrol 2 minggu' }),
      )
      .expect(200);
    const fin = await as('dokterPoli')
      .post(`/discharge/summaries/${e.encounterId}/finalize`, { revision: baru })
      .expect(201);
    expect(fin.body.state).toBe('final');
    const closed = await as('dokterPoli')
      .post(`/encounters/${e.encounterId}/close`, { disposition: 'pulang' })
      .expect(200);
    expect(closed.body.queueTicketId).toBe(e.ticketId);
    const ticket = await run(A.id, (tx) =>
      tx.queueTicket.findUniqueOrThrow({ where: { id: e.ticketId as string } }),
    );
    expect(ticket.status).toBe('done');
    const names = (
      await run(A.id, (tx) =>
        tx.domainEvent.findMany({
          where: { payload: { path: ['ticketId'], equals: e.ticketId } },
          select: { name: true },
        }),
      )
    ).map((x) => x.name);
    expect(names).toEqual(expect.arrayContaining(['queue.ticket_started', 'queue.ticket_finished']));
    const enc = await run(A.id, (tx) => tx.encounter.findUniqueOrThrow({ where: { id: e.encounterId } }));
    expect(enc).toMatchObject({ status: 'finished', disposition: 'pulang' });
    await as('dokterPoli').post(`/encounters/${e.encounterId}/close`, { disposition: 'pulang' }).expect(409);
  });
});

describe('disposisi meninggal (keputusan K-1)', () => {
  const death = (over: object = {}) => ({
    revision: baru,
    diedAt: minutesAgo(30),
    cause: { code: 'J18.9', display: 'Pneumonia' },
    note: 'Gagal napas akibat pneumonia berat',
    ...over,
  });

  it('admisi ditolak; dokter tanpa relasi ditolak; ICD-10 wajib dari rujukan; TTE dokter; lalu dokter menutup', async () => {
    const e = await encounter('EMER', [['dokterIgd', 'dpjp_utama']]);
    // Admisi tidak bisa menyelesaikan disposisi meninggal (403), juga lewat ADT.
    const adm = await as('daftar').post('/adt/discharges', {
      encounterId: e.encounterId,
      disposition: 'meninggal',
    });
    expect(adm.status).toBe(403);
    await as('daftar').post(`/encounters/${e.encounterId}/death-certificate`, death()).expect(403);
    // Dokter tanpa relasi dengan pasien (unit lain) ditolak.
    await as('dokter').post(`/encounters/${e.encounterId}/death-certificate`, death()).expect(403);
    // Tanpa surat kematian → 409.
    const noCert = await as('dokterIgd').post(`/encounters/${e.encounterId}/close`, {
      disposition: 'meninggal',
    });
    expect(noCert.status).toBe(409);
    expect(JSON.stringify(noCert.body.details)).toContain('Surat keterangan kematian');
    // Sebab kematian wajib kode ICD-10 dari data rujukan; jam kematian tidak di masa depan.
    await as('dokterIgd')
      .post(
        `/encounters/${e.encounterId}/death-certificate`,
        death({ cause: { code: 'U99.9', display: 'X' } }),
      )
      .expect(422);
    await as('dokterIgd')
      .post(
        `/encounters/${e.encounterId}/death-certificate`,
        death({ diedAt: new Date(Date.now() + 3_600_000).toISOString() }),
      )
      .expect(422);
    await as('dokterIgd')
      .post(`/encounters/${e.encounterId}/death-certificate`, { ...death(), cause: undefined })
      .expect(400);
    const cert = await as('dokterIgd')
      .post(`/encounters/${e.encounterId}/death-certificate`, death())
      .expect(201);
    const parsed = deathCertificateSchema.parse(cert.body);
    expect(parsed).toMatchObject({
      cause: { code: 'J18.9' },
      locked: true,
      author: { userId: users.dokterIgd },
    });
    expect(parsed.document?.signatureStatus).toBe('pending');
    // Satu per kunjungan; versi ber-TTE tidak bisa dikoreksi.
    await as('dokterIgd').post(`/encounters/${e.encounterId}/death-certificate`, death()).expect(409);
    const locked = await as('dokterIgd')
      .post(
        `/encounters/${e.encounterId}/death-certificate`,
        death({
          revision: {
            kind: 'koreksi',
            supersedesId: parsed.id,
            correctionReason: 'Jam kematian salah tulis',
          },
        }),
      )
      .expect(409);
    expect(locked.body.code).toBe('RECORD_LOCKED');
    // Admisi tetap ditolak walau surat sudah terbit; dokter yang merawat menutup.
    expect(
      (await as('daftar').post('/adt/discharges', { encounterId: e.encounterId, disposition: 'meninggal' }))
        .status,
    ).toBe(403);
    await as('dokterIgd')
      .post(`/encounters/${e.encounterId}/close`, { disposition: 'meninggal' })
      .expect(200);
    const enc = await run(A.id, (tx) => tx.encounter.findUniqueOrThrow({ where: { id: e.encounterId } }));
    expect(enc).toMatchObject({ status: 'finished', disposition: 'meninggal' });
    await as('dokterIgd').get(`/encounters/${e.encounterId}/death-certificate`).expect(200);
    await as('dokterB').get(`/encounters/${e.encounterId}/death-certificate`).expect(404);
  });

  it('dokter jaga dengan akses darurat boleh menerbitkan; rawat inap meninggal tetap butuh resume', async () => {
    const e = await encounter('IMP', [['dokter', 'dpjp_utama']]);
    await run(A.id, (tx) =>
      tx.breakGlassGrant.create({
        data: {
          id: newId(),
          tenantId: A.id,
          userId: users.dokterLain as string,
          patientId: e.patientId,
          reason: 'Dokter jaga malam: pasien henti jantung',
          grantedAt: new Date(Date.now() - 60_000),
          expiresAt: new Date(Date.now() + 3_600_000),
        },
      }),
    );
    await as('dokterLain').post(`/encounters/${e.encounterId}/death-certificate`, death()).expect(201);
    const r = await as('dokter').post(`/encounters/${e.encounterId}/close`, { disposition: 'meninggal' });
    expect(r.status).toBe(409);
    expect(JSON.stringify(r.body.details)).toContain('Resume medis');
    expect(JSON.stringify(r.body.details)).not.toContain('Surat keterangan kematian');
  });
});
