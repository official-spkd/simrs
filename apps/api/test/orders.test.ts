/**
 * Fase 3 · potongan 3.4 · CPOE + CDS + resep (K09): katalog dan order set, pratinjau CDS server dengan KB per RS,
 * kirim order (Idempotency-Key), resep alergi diblokir (DoD) lalu override beralasan tercatat, order residen
 * menunggu tinjauan DPJP, batal beralasan, staging biaya + SATUSEHAT `held`, event domain, resep PDF ber-TTE, laporan
 * override untuk auditor mutu, ABAC dan isolasi tenant. Data fiktif.
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
const drugs: Record<string, Record<string, string>> = {};
const orderables: Record<string, Record<string, string>> = {};
const substances: Record<string, Record<string, string>> = {};

const run = <R>(tenantId: string, fn: (tx: TenantTx) => Promise<R>) => withTenant(testDb(), tenantId, fn);
const asOwner = async <R>(tenantId: string, fn: (tx: TenantTx) => Promise<R>) => {
  const owner = createPrismaClient({ connectionString: testDbUrls().migrator, max: 1 });
  try {
    return await withTenant(owner, tenantId, fn);
  } finally {
    await owner.$disconnect();
  }
};
const as = (who: string) => {
  const auth = () => bearer(tok[who] as Tokens);
  const http = () => request(app.getHttpServer());
  return {
    get: (url: string) => http().get(`/api/v1${url}`).set(auth()),
    post: (url: string, body: object = {}, key?: string) => {
      const req = http().post(`/api/v1${url}`).set(auth());
      return (key ? req.set('Idempotency-Key', key) : req).send(body);
    },
  };
};

async function clinicalTenant() {
  const t = await createTestTenant();
  await asOwner(t.id, async (tx) => {
    await seedHospitalStructure(tx, t.id);
    await seedClinicalMasters(tx, t.id);
  });
  drugs[t.id] = {};
  orderables[t.id] = {};
  substances[t.id] = {};
  await run(t.id, async (tx) => {
    for (const d of await tx.drug.findMany({ select: { id: true, name: true } })) {
      (drugs[t.id] as Record<string, string>)[d.name] = d.id;
    }
    for (const o of await tx.orderable.findMany({ select: { id: true, name: true } })) {
      (orderables[t.id] as Record<string, string>)[o.name] = o.id;
    }
    for (const s of await tx.drugSubstance.findMany({ select: { id: true, code: true } })) {
      (substances[t.id] as Record<string, string>)[s.code] = s.id;
    }
  });
  return t;
}

const drug = (t: { id: string }, name: string) => drugs[t.id]?.[name] as string;
const orderable = (t: { id: string }, name: string) => orderables[t.id]?.[name] as string;

let seq = 0;
/** Pasien rawat inap aktif di bed pertama yang kosong pada unit `unitCode`, opsional beralergi zat `allergy`. */
async function inpatient(
  t: { id: string },
  opts: { unitCode?: string; allergy?: string; condition?: string } = {},
) {
  const p = await createTestPatient(t.id, { name: 'Pasien Order Fiktif' });
  seq += 1;
  return run(t.id, async (tx) => {
    const unit = await tx.unit.findFirstOrThrow({ where: { code: opts.unitCode ?? 'MELATI' } });
    const occupied = (
      await tx.bedAssignment.findMany({ where: { endedAt: null }, select: { locationId: true } })
    ).map((a) => a.locationId);
    const bed = await tx.location.findFirstOrThrow({
      where: { kind: 'bed', unitId: unit.id, id: { notIn: occupied } },
      orderBy: { code: 'asc' },
    });
    const enc = await tx.encounter.create({
      data: {
        id: newId(),
        tenantId: t.id,
        number: `RI-2610-${String(Date.now() % 1e5).padStart(5, '0')}${seq}`,
        patientId: p.id,
        encounterClass: 'IMP',
        status: 'in_progress',
        unitId: unit.id,
        plannedAt: new Date(),
      },
    });
    await tx.bedAssignment.create({
      data: {
        id: newId(),
        tenantId: t.id,
        encounterId: enc.id,
        patientId: p.id,
        locationId: bed.id,
        startedAt: new Date(),
      },
    });
    const author = (t.id === B.id ? users.dokterB : users.dokter) as string;
    const versioned = () => {
      const id = newId();
      return {
        id,
        rootId: id,
        tenantId: t.id,
        patientId: p.id,
        encounterId: enc.id,
        occurredAt: new Date(Date.now() - 60_000),
        authorUserId: author,
        authorRole: 'dokter',
      };
    };
    if (opts.allergy) {
      await tx.allergyIntolerance.create({
        data: {
          ...versioned(),
          kind: 'alergi',
          substanceId: substances[t.id]?.[opts.allergy] as string,
          category: 'obat',
          criticality: 'tinggi',
          reaction: 'Ruam',
        },
      });
    }
    if (opts.condition) {
      await tx.condition.create({
        data: {
          ...versioned(),
          kind: 'problem_list',
          code: opts.condition,
          display: 'Penyakit ginjal kronik stadium 3',
          clinicalStatus: 'active',
        },
      });
    }
    return { patientId: p.id, encounterId: enc.id };
  });
}

const med = (drugId: string, override: string | null = null, over: object = {}) => ({
  type: 'obat',
  drugId,
  compound: null,
  dose: '500 mg',
  route: 'oral',
  frequency: '3x1',
  customTimes: null,
  durationDays: 5,
  instructions: null,
  override,
  ...over,
});
const svc = (orderableId: string, override: string | null = null) => ({
  type: 'layanan',
  orderableId,
  priority: 'rutin',
  instructions: null,
  override,
});
const body = (encounterId: string, items: object[]) => ({ encounterId, orderSetId: null, items });

beforeAll(async () => {
  app = await createTestApp();
  A = await clinicalTenant();
  B = await clinicalTenant();
  // Komite farmasi (apoteker) mengelola order set institusi di RS A (izin diberikan lewat matriks, seperti layar Akses).
  await asOwner(A.id, async (tx) => {
    const apoteker = await tx.role.findFirstOrThrow({ where: { code: 'apoteker' } });
    await tx.rolePermission.create({
      data: { tenantId: A.id, roleId: apoteker.id, resource: 'order', action: 'manage', scope: 'all' },
    });
  });
  for (const [who, t, role, unitCode] of [
    ['dokter', A, 'dokter', 'MELATI'],
    ['residen', A, 'dokter_residen', 'MELATI'],
    ['dokterAnggrek', A, 'dokter', 'ANGGREK'],
    ['perawat', A, 'perawat', 'MELATI'],
    ['auditor', A, 'auditor_mutu', undefined],
    ['apoteker', A, 'apoteker', undefined],
    ['dokterB', B, 'dokter', 'MELATI'],
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

describe('katalog dan order set', () => {
  it('katalog obat + penunjang dari master RS (tarif null sampai U01), cari per kata kunci dan jenis', async () => {
    const r = await as('dokter').get('/orders/catalog?q=sefadroksil').expect(200);
    expect(r.body).toEqual([
      expect.objectContaining({
        id: drug(A, 'Sefadroksil 500 mg kapsul'),
        kind: 'obat',
        substance: 'sefadroksil',
        classes: ['sefalosporin-1'],
        tariff: null,
        highAlert: false,
      }),
    ]);
    const lab = await as('dokter').get('/orders/catalog?q=hemo&kind=lab').expect(200);
    expect(lab.body).toEqual([
      expect.objectContaining({ name: 'Hemoglobin', kind: 'lab', code: { system: 'LOINC', code: '718-7' } }),
    ]);
    await as('perawat').get('/orders/catalog').expect(200);
  });

  it('order set institusi: dibaca klinisi; dibuat hanya pemegang order.manage; kode ganda 409', async () => {
    const list = await as('dokter').get('/orders/order-sets').expect(200);
    expect(list.body.map((s: { code: string }) => s.code)).toContain('ska-awal');
    const input = {
      code: 'pneumonia-awal',
      name: 'Pneumonia komunitas · order awal',
      items: [{ orderableId: orderable(A, 'Darah lengkap') }, { drugId: drug(A, 'Seftriakson 2 g injeksi') }],
    };
    await as('dokter').post('/orders/order-sets', input).expect(403);
    const created = await as('apoteker').post('/orders/order-sets', input).expect(201);
    expect(created.body).toMatchObject({
      code: 'pneumonia-awal',
      items: [
        { type: 'layanan', kind: 'lab', name: 'Darah lengkap' },
        { type: 'obat', kind: 'obat', name: 'Seftriakson 2 g injeksi' },
      ],
    });
    await as('apoteker').post('/orders/order-sets', input).expect(409);
    await as('apoteker')
      .post('/orders/order-sets', { ...input, code: 'isi-asing', items: [{ drugId: newId() }] })
      .expect(422);
  });
});

describe('CDS dan kirim order', () => {
  it('DoD: resep sefadroksil untuk pasien alergi amoksisilin diblokir (422, tercatat diblokir); dengan alasan → 201 + override tercatat + audit', async () => {
    const e = await inpatient(A, { allergy: 'amoksisilin' });
    const items = [med(drug(A, 'Sefadroksil 500 mg kapsul'))];

    const preview = await as('dokter').post('/orders/evaluate', body(e.encounterId, items)).expect(200);
    expect(preview.body).toMatchObject({
      blocked: true,
      lines: [
        {
          index: 0,
          blocked: true,
          top: { level: 'block', rule: 'alergi-silang' },
          findings: [expect.objectContaining({ ruleCode: 'alergi-silang-penisilin-sefalosporin-1' })],
        },
      ],
    });

    const key1 = newId();
    const blocked = await as('dokter').post('/orders/submit', body(e.encounterId, items), key1).expect(422);
    expect(blocked.body.code).toBe('CDS_BLOCKED');
    expect(blocked.body.details.lines[0].blocked).toBe(true);
    const afterBlock = await run(A.id, async (tx) => ({
      groups: await tx.orderGroup.count({ where: { encounterId: e.encounterId } }),
      // Pola commit-lalu-422: tidak ada sisa data order apa pun selain cds_alerts + audit penolakan.
      leftovers: {
        medications: await tx.medicationRequest.count({ where: { encounterId: e.encounterId } }),
        services: await tx.serviceRequest.count({ where: { encounterId: e.encounterId } }),
        billable: await tx.billableEvent.count({ where: { encounterId: e.encounterId } }),
        documents: await tx.document.count({ where: { patientId: e.patientId } }),
      },
      alerts: await tx.cdsAlert.findMany({ where: { encounterId: e.encounterId } }),
      audit: await tx.auditEvent.findFirst({
        where: { resourceType: 'order_group', patientId: e.patientId, outcome: 'denied' },
      }),
    }));
    expect(afterBlock.groups).toBe(0);
    expect(afterBlock.leftovers).toEqual({ medications: 0, services: 0, billable: 0, documents: 0 });
    expect(afterBlock.alerts).toEqual([
      expect.objectContaining({
        decision: 'diblokir',
        level: 'block',
        orderGroupId: null,
        ruleCode: 'alergi-silang-penisilin-sefalosporin-1',
        ruleVersion: 1,
        decidedBy: users.dokter,
      }),
    ]);
    expect(afterBlock.audit?.details).toMatchObject({ reason: 'CDS_BLOCKED', blockedLines: [0] });

    const reason = 'Riwayat sefadroksil sebelumnya tanpa reaksi; manfaat lebih besar';
    const ok = await as('dokter')
      .post(
        '/orders/submit',
        body(e.encounterId, [med(drug(A, 'Sefadroksil 500 mg kapsul'), reason)]),
        newId(),
      )
      .expect(201);
    expect(ok.body).toMatchObject({
      encounterId: e.encounterId,
      needsReview: false,
      orderedBy: { userId: users.dokter, peran: 'dokter' },
      medicationRequests: [{ name: 'Sefadroksil 500 mg kapsul', status: 'aktif', frequency: '3x1' }],
      cdsAlerts: [{ decision: 'override', overrideReason: reason, level: 'block', orderLineIndex: 0 }],
      prescription: { signatureStatus: 'pending' },
    });
    const audit = await run(A.id, (tx) =>
      tx.auditEvent.findFirstOrThrow({
        where: { resourceType: 'order_group', resourceId: ok.body.id, action: 'create' },
      }),
    );
    expect(audit).toMatchObject({ patientId: e.patientId, outcome: 'success', details: { overrides: 1 } });
  });

  it('Idempotency-Key: ulang isi sama → kiriman yang sama (200); isi lain → 409; tanpa kunci → 400; serentak → satu kiriman', async () => {
    const e = await inpatient(A);
    const items = [svc(orderable(A, 'Kalium'))];
    const key = newId();
    const first = await as('dokter').post('/orders/submit', body(e.encounterId, items), key).expect(201);
    const again = await as('dokter').post('/orders/submit', body(e.encounterId, items), key).expect(200);
    expect(again.body.id).toBe(first.body.id);
    const other = await as('dokter')
      .post('/orders/submit', body(e.encounterId, [svc(orderable(A, 'Natrium'))]), key)
      .expect(409);
    expect(other.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
    const none = await as('dokter').post('/orders/submit', body(e.encounterId, items)).expect(400);
    expect(none.body.code).toBe('IDEMPOTENCY_KEY_REQUIRED');

    const k2 = newId();
    const both = await Promise.all(
      [0, 1].map(() =>
        as('dokter').post('/orders/submit', body(e.encounterId, [svc(orderable(A, 'Ureum'))]), k2),
      ),
    );
    expect(both.map((r) => r.status).sort()).toEqual([200, 201]);
    expect(both[0]?.body.id).toBe(both[1]?.body.id);
    expect(await run(A.id, (tx) => tx.orderGroup.count({ where: { encounterId: e.encounterId } }))).toBe(2);
  });

  it('kirim: order beku + status aktif, biaya tanpa harga untuk penunjang, SATUSEHAT held, event order.activated, duplikasi diperingatkan', async () => {
    const e = await inpatient(A);
    const r = await as('dokter')
      .post(
        '/orders/submit',
        body(e.encounterId, [svc(orderable(A, 'Hemoglobin')), med(drug(A, 'Parasetamol 500 mg tablet'))]),
        newId(),
      )
      .expect(201);
    const [sr] = r.body.serviceRequests;
    const [mr] = r.body.medicationRequests;
    expect(sr).toMatchObject({
      name: 'Hemoglobin',
      code: { system: 'LOINC', code: '718-7' },
      status: 'aktif',
    });
    const staged = await run(A.id, async (tx) => ({
      billable: await tx.billableEvent.findMany({ where: { encounterId: e.encounterId } }),
      held: await tx.outboxMessage.findMany({
        where: { status: 'held', target: 'satusehat' },
        select: { operation: true, payload: true },
      }),
      event: await tx.domainEvent.findFirst({
        where: { name: 'order.activated' },
        orderBy: { occurredAt: 'desc' },
      }),
    }));
    expect(staged.billable).toEqual([
      expect.objectContaining({ sourceType: 'service_requests', sourceId: sr.id, kind: 'lab', quantity: 1 }),
    ]);
    const ops = staged.held
      .filter((m) => [sr.id, mr.id].includes((m.payload as { sourceId: string }).sourceId))
      .map((m) => m.operation)
      .sort();
    expect(ops).toEqual(['satusehat.medicationrequest.upsert', 'satusehat.servicerequest.upsert']);
    expect(staged.event?.payload).toMatchObject({
      orderGroupId: r.body.id,
      serviceRequestIds: [sr.id],
      medicationRequestIds: [mr.id],
      needsReview: false,
    });

    // Lab yang sama dalam 24 jam: peringatan duplikasi dari KB contoh (diterima, tidak memblokir).
    const dup = await as('dokter')
      .post('/orders/submit', body(e.encounterId, [svc(orderable(A, 'Hemoglobin'))]), newId())
      .expect(201);
    expect(dup.body.cdsAlerts).toEqual([
      expect.objectContaining({ rule: 'duplikasi', level: 'warn', decision: 'diterima' }),
    ]);
  });

  it('order residen langsung aktif, menunggu tinjauan DPJP; tinjauan DPJP menerbitkan resep ber-TTE peninjau', async () => {
    const e = await inpatient(A);
    const r = await as('residen')
      .post('/orders/submit', body(e.encounterId, [med(drug(A, 'Amlodipin 5 mg tablet'))]), newId())
      .expect(201);
    expect(r.body).toMatchObject({
      needsReview: true,
      orderedBy: { peran: 'dokter_residen' },
      medicationRequests: [{ status: 'aktif' }],
      prescription: null,
    });
    // Tinjauan DPJP (izin `clinical.sign`, relasi DPJP): atestasi review_order + resep ber-TTE peninjau.
    await as('residen').post(`/orders/${r.body.id}/review`).expect(403);
    // Relasi akses (ABAC lingkup relasi `clinical.sign`) untuk dua dokter; hanya satu yang DPJP utama kunjungan ini.
    await run(A.id, async (tx) => {
      for (const who of ['dokter', 'dokterAnggrek']) {
        await tx.accessRelationship.create({
          data: {
            id: newId(),
            tenantId: A.id,
            userId: users[who] as string,
            patientId: e.patientId,
            kind: 'dpjp',
          },
        });
      }
      await tx.encounterParticipant.create({
        data: {
          id: newId(),
          tenantId: A.id,
          encounterId: e.encounterId,
          userId: users.dokter as string,
          role: 'dpjp_utama',
        },
      });
    });
    const notTeam = await as('dokterAnggrek').post(`/orders/${r.body.id}/review`).expect(403);
    expect(notTeam.body.code).toBe('COSIGN_NOT_ALLOWED');
    const reviewed = await as('dokter').post(`/orders/${r.body.id}/review`).expect(200);
    expect(reviewed.body).toMatchObject({
      needsReview: false,
      review: { by: { userId: users.dokter, peran: 'dokter' } },
      prescription: { signatureStatus: 'pending' },
    });
    const sig = await run(A.id, (tx) =>
      tx.documentSignature.findUniqueOrThrow({ where: { id: reviewed.body.prescription.signatureId } }),
    );
    expect(sig.signerUserId).toBe(users.dokter);
    expect((await as('dokter').post(`/orders/${r.body.id}/review`).expect(409)).body.message).toMatch(
      /tidak memerlukan|sudah ditinjau/,
    );
    const own = await as('dokter')
      .post('/orders/submit', body(e.encounterId, [svc(orderable(A, 'Kalium'))]), newId())
      .expect(201);
    expect(own.body).toMatchObject({ needsReview: false, review: null });
    await as('dokter').post(`/orders/${own.body.id}/review`).expect(409);
    // Perawat tidak berizin order.write.
    await as('perawat')
      .post('/orders/submit', body(e.encounterId, [med(drug(A, 'Amlodipin 5 mg tablet'))]), newId())
      .expect(403);
  });

  it('resep dokter: PDF klinis ber-TTE pending (sumber kiriman order) + outbox tte.sign', async () => {
    const e = await inpatient(A);
    const r = await as('dokter')
      .post(
        '/orders/submit',
        body(e.encounterId, [
          med(drug(A, 'Metformin 500 mg tablet'), null, { frequency: '2x1', instructions: 'Sesudah makan' }),
          med(null as unknown as string, null, {
            drugId: null,
            compound: {
              name: 'Puyer batuk',
              dosageForm: 'puyer',
              quantity: 10,
              components: [
                { drugId: drug(A, 'Parasetamol 500 mg tablet'), amount: '250 mg' },
                { drugId: drug(A, 'Azitromisin 500 mg tablet'), amount: '100 mg' },
              ],
            },
            dose: '1 bungkus',
          }),
        ]),
        newId(),
      )
      .expect(201);
    expect(r.body.medicationRequests[1]).toMatchObject({
      drugId: null,
      name: 'Puyer batuk',
      compound: {
        components: [{ name: 'Parasetamol 500 mg tablet' }, { name: 'Azitromisin 500 mg tablet' }],
      },
    });
    const { documentId, signatureId } = r.body.prescription;
    const rows = await run(A.id, async (tx) => ({
      doc: await tx.document.findUniqueOrThrow({ where: { id: documentId } }),
      sig: await tx.documentSignature.findUniqueOrThrow({ where: { id: signatureId } }),
      msg: await tx.outboxMessage.findFirst({ where: { idempotencyKey: `tte-sign:${signatureId}` } }),
    }));
    expect(rows.doc).toMatchObject({
      sourceType: 'order_groups',
      sourceId: r.body.id,
      mimeType: 'application/pdf',
    });
    expect(rows.sig).toMatchObject({ signerUserId: users.dokter, status: 'pending' });
    expect(rows.msg?.status).toBe('pending');
  });

  it('batal beralasan: status dibatalkan + SATUSEHAT revisi 2 + event; batal ulang 409; alasan pendek 400', async () => {
    const e = await inpatient(A);
    const r = await as('dokter')
      .post('/orders/submit', body(e.encounterId, [svc(orderable(A, 'CRP'))]), newId())
      .expect(201);
    const id = r.body.serviceRequests[0].id;
    await as('dokter').post(`/orders/${id}/cancel`, { reason: 'salah' }).expect(400);
    const c = await as('dokter')
      .post(`/orders/${id}/cancel`, { reason: 'Pasien dipindah, pemeriksaan tidak diperlukan' })
      .expect(200);
    expect(c.body.serviceRequests[0]).toMatchObject({
      status: 'dibatalkan',
      statusReason: 'Pasien dipindah, pemeriksaan tidak diperlukan',
    });
    await as('dokter').post(`/orders/${id}/cancel`, { reason: 'Pembatalan kedua kali' }).expect(409);
    const rows = await run(A.id, async (tx) => ({
      held: await tx.outboxMessage.findFirst({
        where: {
          idempotencyKey: { contains: id },
          operation: 'satusehat.servicerequest.upsert',
          payload: { path: ['revision'], equals: 2 },
        },
      }),
      event: await tx.domainEvent.findFirst({
        where: { name: 'order.cancelled' },
        orderBy: { occurredAt: 'desc' },
      }),
    }));
    expect(rows.held?.status).toBe('held');
    expect(rows.event?.payload).toMatchObject({
      orderId: id,
      orderType: 'service',
      encounterId: e.encounterId,
    });
    const list = await as('dokter').get(`/encounters/${e.encounterId}/orders`).expect(200);
    expect(list.body).toHaveLength(1);
  });

  it('KB per RS: aturan dinonaktifkan di RS B (versi 2) tidak berlaku di RS B, tetap di RS A; flag diagnosis ICD-10', async () => {
    await asOwner(B.id, async (tx) => {
      const v1 = await tx.cdsRule.findFirstOrThrow({
        where: { code: 'alergi-silang-penisilin-sefalosporin-1' },
      });
      await tx.cdsRule.create({
        data: {
          id: newId(),
          tenantId: B.id,
          code: v1.code,
          version: 2,
          status: 'nonaktif',
          definition: v1.definition as object,
        },
      });
      await tx.cdsRule.create({
        data: {
          id: newId(),
          tenantId: B.id,
          code: 'riwayat-ckd-biguanid',
          version: 1,
          definition: {
            kind: 'history',
            flag: 'icd10-n18',
            itemClass: 'biguanid',
            level: 'warn',
            message: 'Pasien PGK: tinjau dosis metformin terhadap eGFR terbaru.',
          },
        },
      });
    });
    const items = (t: { id: string }) => [med(drug(t, 'Sefadroksil 500 mg kapsul'))];
    const eA = await inpatient(A, { allergy: 'amoksisilin' });
    const eB = await inpatient(B, { allergy: 'amoksisilin', condition: 'N18.3' });
    const a = await as('dokter')
      .post('/orders/evaluate', body(eA.encounterId, items(A)))
      .expect(200);
    const b = await as('dokterB')
      .post('/orders/evaluate', body(eB.encounterId, items(B)))
      .expect(200);
    expect(a.body.blocked).toBe(true);
    expect(b.body.blocked).toBe(false);
    const ckd = await as('dokterB')
      .post('/orders/evaluate', body(eB.encounterId, [med(drug(B, 'Metformin 500 mg tablet'))]))
      .expect(200);
    expect(ckd.body.lines[0].findings).toEqual([
      expect.objectContaining({ rule: 'riwayat', ruleCode: 'riwayat-ckd-biguanid', level: 'warn' }),
    ]);
    // Aturan seed `riwayat-ckd-ains` memakai token diagnosis `icd10-n18` (bukan flag `ckd` mode presentasi).
    const ains = await as('dokterB')
      .post('/orders/evaluate', body(eB.encounterId, [med(drug(B, 'Ibuprofen 400 mg tablet'))]))
      .expect(200);
    expect(ains.body.lines[0].findings).toEqual([
      expect.objectContaining({ rule: 'riwayat', ruleCode: 'riwayat-ckd-ains', level: 'warn' }),
    ]);
  });

  it('ABAC dan isolasi: dokter unit lain 403; kunjungan RS lain 404; kunjungan belum dimulai 409', async () => {
    const e = await inpatient(A);
    const items = [svc(orderable(A, 'Kalium'))];
    await as('dokterAnggrek').post('/orders/evaluate', body(e.encounterId, items)).expect(403);
    await as('dokterB').post('/orders/submit', body(e.encounterId, items), newId()).expect(404);
    await run(A.id, (tx) =>
      tx.encounter.update({ where: { id: e.encounterId }, data: { status: 'planned' } }),
    );
    await as('dokter').post('/orders/submit', body(e.encounterId, items), newId()).expect(409);
  });
});

describe('laporan override CDS', () => {
  it('auditor mutu (lingkup RS) melihat override beralasan dengan RM, bukan nama; dokter berlingkup unit 403', async () => {
    const r = await as('auditor').get('/cds/overrides').expect(200);
    expect(r.body.items.length).toBeGreaterThan(0);
    const item = r.body.items[0];
    expect(item).toMatchObject({ decision: 'override', level: 'block', overrideReason: expect.any(String) });
    expect(item.mrn).toMatch(/^\d{2}-\d{2}-\d{2}-\d{2}$/);
    expect(JSON.stringify(r.body)).not.toContain('Pasien Order Fiktif');
    const blocked = await as('auditor').get('/cds/overrides?decision=diblokir&limit=1').expect(200);
    expect(blocked.body.items[0]).toMatchObject({ decision: 'diblokir', orderGroupId: null });
    await as('dokter').get('/cds/overrides').expect(403);
  });
});
