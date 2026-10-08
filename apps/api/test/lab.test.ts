/**
 * Fase 4 §4.2 · S01 laboratorium inti lewat API: worklist order CPOE per unit lab, terima order (Idempotency-Key,
 * nomor lab, spesimen per jenis tabung, order panel), spesimen ambil/terima/tolak (+ sampel ulang), input hasil (flag
 * per JK/umur, delta, nilai kritis), validasi teknis (diblokir nilai kritis terbuka / QC ditolak) lalu klinis = rilis
 * ber-TTE (dokter di unit lab), hasil masuk muara `observations`, koreksi → validasi ulang, cetak, audit, isolasi.
 * Tenant fiktif baru; data pasien fiktif.
 */
import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  createPrismaClient,
  type PrismaClient,
  seedClinicalMasters,
  seedHospitalStructure,
  seedSupportMasters,
  type TenantTx,
  withTenant,
} from '@simrs/db';
import { testDbUrls } from '@simrs/db/testing';
import { type LabOrderDetail, newId } from '@simrs/shared';
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
let owner: PrismaClient;
let T: { id: string; code: string };
let B: { id: string; code: string };
const unit: Record<string, string> = {};
const tok: Record<string, Tokens> = {};
const uid: Record<string, string> = {};

const http = () => request(app.getHttpServer());
const run = <R>(tenantId: string, fn: (tx: TenantTx) => Promise<R>) => withTenant(testDb(), tenantId, fn);
const as = (who: string) => bearer(tok[who] as Tokens);

async function staff(who: string, t: { id: string; code: string }, role: string, unitCode?: string) {
  const u = await createTestUser(t.id, {
    roles: [{ code: role, unitId: unitCode ? unit[unitCode] : undefined }],
    tenantCode: t.code,
  });
  tok[who] = await login(app, u);
  uid[who] = u.id;
}

/** Kunjungan rawat inap + kiriman CPOE berisi order lab (nama orderable seed), DPJP = dokter Melati. */
async function cpoe(
  names: string[],
  opts: { sex?: 'male' | 'female'; patientId?: string; encounterId?: string; cito?: boolean } = {},
) {
  const patientId =
    opts.patientId ??
    (await createTestPatient(T.id, { name: 'Tn. Uji Lab', sex: opts.sex ?? 'male', birthDate: '1970-05-01' }))
      .id;
  return run(T.id, async (tx) => {
    const encounterId = opts.encounterId ?? newId();
    if (!opts.encounterId)
      await tx.encounter.create({
        data: {
          id: encounterId,
          tenantId: T.id,
          number: `RI-LB-${newId().slice(-8)}`,
          patientId,
          encounterClass: 'IMP',
          status: 'in_progress',
          unitId: unit.MELATI as string,
          plannedAt: new Date(),
        },
      });
    if (!opts.encounterId) {
      await tx.encounterParticipant.create({
        data: { id: newId(), tenantId: T.id, encounterId, userId: uid.dpjp as string, role: 'dpjp_utama' },
      });
    }
    const groupId = newId();
    await tx.orderGroup.create({
      data: {
        id: groupId,
        tenantId: T.id,
        encounterId,
        patientId,
        idempotencyKey: newId(),
        requestHash: 'a'.repeat(64),
        orderedBy: uid.dpjp as string,
        orderedRole: 'dokter',
      },
    });
    const ids: string[] = [];
    for (const name of names) {
      const o = await tx.orderable.findFirstOrThrow({ where: { kind: 'lab', name } });
      const id = newId();
      ids.push(id);
      await tx.serviceRequest.create({
        data: {
          id,
          tenantId: T.id,
          orderGroupId: groupId,
          encounterId,
          patientId,
          orderableId: o.id,
          name: o.name,
          codeSystem: o.codeSystem,
          code: o.code,
          priority: opts.cito ? 'cito' : 'rutin',
        },
      });
    }
    return { patientId, encounterId, groupId, serviceRequestIds: ids };
  });
}

const accept = (who: string, serviceRequestIds: string[], key: string = newId()) =>
  http().post('/api/v1/lab/orders').set(as(who)).set('Idempotency-Key', key).send({ serviceRequestIds });

const receiveAll = async (d: LabOrderDetail) => {
  for (const s of d.specimens.filter((x) => x.status === 'menunggu')) {
    await http().post(`/api/v1/lab/specimens/${s.id}/receive`).set(as('analis')).expect(200);
  }
};

const testId = (d: LabOrderDetail, code: string) =>
  d.tests.find((t) => t.code === code)?.testDefinitionId as string;

/** Order lengkap sampai siap validasi: terima, terima spesimen, isi hasil. */
async function readyOrder(values: Record<string, number>, names = ['Kalium'], cpoeOpts = {}) {
  const c = await cpoe(names, cpoeOpts);
  const d = (await accept('analis', c.serviceRequestIds).expect(201)).body as LabOrderDetail;
  await receiveAll(d);
  const res = await http()
    .post(`/api/v1/lab/orders/${d.id}/results`)
    .set(as('analis'))
    .send({
      items: Object.entries(values).map(([code, v]) => ({
        testDefinitionId: testId(d, code),
        valueNumeric: v,
        valueText: null,
      })),
    })
    .expect(200);
  return { ...c, detail: res.body as LabOrderDetail };
}

beforeAll(async () => {
  owner = createPrismaClient({ connectionString: testDbUrls().migrator, max: 2 });
  app = await createTestApp();
  T = await createTestTenant();
  B = await createTestTenant();
  for (const t of [T, B]) {
    await withTenant(owner, t.id, (tx) => seedHospitalStructure(tx, t.id));
    await run(t.id, async (tx) => {
      await seedClinicalMasters(tx, t.id);
      await seedSupportMasters(tx, t.id);
    });
  }
  await run(T.id, async (tx) => {
    for (const u of await tx.unit.findMany({ select: { id: true, code: true } })) unit[u.code] = u.id;
  });
  await staff('analis', T, 'analis_lab', 'LAB');
  await staff('analisRad', T, 'analis_lab', 'RAD');
  await staff('dokterLab', T, 'dokter', 'LAB');
  await staff('dpjp', T, 'dokter', 'MELATI');
  await staff('kasir', T, 'kasir');
  const lab = await run(B.id, (tx) => tx.unit.findFirstOrThrow({ where: { code: 'LAB' } }));
  const ub = await createTestUser(B.id, {
    roles: [{ code: 'analis_lab', unitId: lab.id }],
    tenantCode: B.code,
  });
  tok.analisB = await login(app, ub);
}, 180_000);

afterAll(async () => {
  await app?.close();
  await owner?.$disconnect();
});

describe('worklist dan terima order', () => {
  it('order CPOE baru tampil di unit lab tujuan saja (bukan unit lain/tenant lain); kasir 403; dimuat = audit search', async () => {
    const c = await cpoe(['Kalium', 'Darah lengkap'], { cito: true });
    const wl = await http().get('/api/v1/lab/worklist').set(as('analis')).expect(200);
    const item = wl.body.find(
      (i: { orders: Array<{ orderGroupId: string }> }) => i.orders[0]?.orderGroupId === c.groupId,
    );
    expect(item).toMatchObject({ labOrderId: null, status: null, priority: 'cito', criticalOpen: false });
    expect(item.orders).toHaveLength(2);
    expect(item.patient.id).toBe(c.patientId);
    const rad = await http().get('/api/v1/lab/worklist').set(as('analisRad')).expect(200);
    expect(rad.body).toEqual([]);
    const other = await http()
      .get('/api/v1/lab/worklist')
      .set(bearer(tok.analisB as Tokens))
      .expect(200);
    expect(JSON.stringify(other.body)).not.toContain(c.patientId);
    await http().get('/api/v1/lab/worklist').set(as('kasir')).expect(403);
    const audit = await run(T.id, (tx) =>
      tx.auditEvent.count({ where: { action: 'search', patientId: c.patientId, actorUserId: uid.analis } }),
    );
    expect(audit).toBeGreaterThan(0);
  });

  it('terima order: wajib Idempotency-Key; nomor lab harian, satu spesimen per tabung, order panel → tes panel; ulangan = sama', async () => {
    const c = await cpoe(['Kalium', 'Darah lengkap']);
    await http()
      .post('/api/v1/lab/orders')
      .set(as('analis'))
      .send({ serviceRequestIds: c.serviceRequestIds })
      .expect(400);
    const key = newId();
    const res = await accept('analis', c.serviceRequestIds, key).expect(201);
    const d = res.body as LabOrderDetail;
    expect(d.labNo).toMatch(/^L\d{10}$/);
    expect(d.status).toBe('diterima');
    expect(d.tests.map((t) => t.code).sort()).toEqual(['HB', 'K', 'LEU', 'TROM']);
    expect(d.specimens.map((s) => s.specimenType).sort()).toEqual(['darah_edta', 'serum']);
    expect(d.specimens.every((s) => s.barcode.startsWith(`${d.labNo}-`) && s.status === 'menunggu')).toBe(
      true,
    );
    const again = await accept('analis', c.serviceRequestIds, key).expect(201);
    expect(again.body.id).toBe(d.id);
    await accept('analis', c.serviceRequestIds).expect(409);
    await accept('analisRad', (await cpoe(['Kalium'])).serviceRequestIds).expect(403);
    const ev = await run(T.id, (tx) => tx.domainEvent.count({ where: { name: 'lab.order_accepted' } }));
    expect(ev).toBeGreaterThan(0);
  });
});

describe('spesimen dan hasil', () => {
  it('hasil sebelum spesimen diterima → 409; tolak spesimen = tabung baru + notifikasi ruangan tanpa PHI', async () => {
    const c = await cpoe(['Kalium']);
    const d = (await accept('analis', c.serviceRequestIds).expect(201)).body as LabOrderDetail;
    await http()
      .post(`/api/v1/lab/orders/${d.id}/results`)
      .set(as('analis'))
      .send({ items: [{ testDefinitionId: testId(d, 'K'), valueNumeric: 4.1, valueText: null }] })
      .expect(409);
    const s = d.specimens[0] as LabOrderDetail['specimens'][number];
    await http()
      .post(`/api/v1/lab/specimens/${s.id}/collect`)
      .set(as('analis'))
      .send({ occurredAt: new Date().toISOString() })
      .expect(200);
    await http()
      .post(`/api/v1/lab/specimens/${s.id}/reject`)
      .set(as('analis'))
      .send({ reason: 'lainnya' })
      .expect(400);
    const rej = await http()
      .post(`/api/v1/lab/specimens/${s.id}/reject`)
      .set(as('analis'))
      .send({ reason: 'hemolisis' })
      .expect(200);
    const after = rej.body as LabOrderDetail;
    expect(after.specimens.map((x) => x.status).sort()).toEqual(['ditolak', 'menunggu']);
    const note = await run(T.id, (tx) =>
      tx.notification.findFirstOrThrow({
        where: { kind: 'lab.specimen_rejected', recipientUserId: uid.dpjp },
      }),
    );
    expect(JSON.stringify(note)).not.toMatch(/Uji Lab|Kalium/);
  });

  it('flag per jenis kelamin, nilai kritis memunculkan S09 + gerbang validasi teknis; read-back membuka gerbang', async () => {
    const r = await readyOrder({ K: 6.8, HB: 12.0, LEU: 7, TROM: 250 }, ['Kalium', 'Darah lengkap']);
    const d = r.detail;
    expect(d.status).toBe('hasil');
    const byCode = (code: string) => d.results.find((x) => x.testDefinitionId === testId(d, code));
    expect(byCode('K')).toMatchObject({ flag: 'KRITIS', resultStatus: 'preliminary', source: 'manual' });
    // Laki-laki: Hb 12,0 < 13,2 → L (perempuan 11,7–15,5 akan N).
    expect(byCode('HB')?.flag).toBe('L');
    expect(d.criticalResultIds).toHaveLength(1);
    const blocked = await http()
      .post(`/api/v1/lab/orders/${d.id}/validations/technical`)
      .set(as('analis'))
      .send({ qcOverrideReason: null })
      .expect(409);
    expect(blocked.body.code).toBe('CRITICAL_OPEN');
    await run(T.id, (tx) =>
      tx.criticalResultReport.create({
        data: {
          id: newId(),
          tenantId: T.id,
          criticalResultId: d.criticalResultIds[0] as string,
          recipientUserId: uid.dpjp as string,
          channel: 'telepon',
          readBackText: 'Kalium enam koma delapan',
          readBackConfirmed: true,
          reportedBy: uid.analis as string,
        },
      }),
    );
    const ok = await http()
      .post(`/api/v1/lab/orders/${d.id}/validations/technical`)
      .set(as('analis'))
      .send({ qcOverrideReason: null })
      .expect(200);
    expect(ok.body.status).toBe('validasi_teknis');
  });

  it('delta check terhadap hasil rilis sebelumnya di kelompok RM', async () => {
    const first = await readyOrder({ KREA: 1.0 }, ['Kreatinin']);
    await http()
      .post(`/api/v1/lab/orders/${first.detail.id}/validations/technical`)
      .set(as('analis'))
      .send({ qcOverrideReason: null })
      .expect(200);
    await http()
      .post(`/api/v1/lab/orders/${first.detail.id}/validations/clinical`)
      .set(as('dokterLab'))
      .expect(200);
    const second = await readyOrder({ KREA: 2.4 }, ['Kreatinin'], {
      patientId: first.patientId,
      encounterId: first.encounterId,
    });
    const r = second.detail.results[0];
    expect(r?.delta).toBe(true);
    expect(second.detail.previous['2160-0']?.map((p) => p.valueNumeric)).toEqual([1]);
  });
});

describe('validasi klinis (rilis), koreksi, QC, cetak', () => {
  it('analis tidak bisa rilis; dokter di luar unit lab 403; dokter lab rilis → TTE, observasi, event, notifikasi DPJP', async () => {
    const r = await readyOrder({ K: 4.2 });
    const id = r.detail.id;
    await http().post(`/api/v1/lab/orders/${id}/validations/clinical`).set(as('dokterLab')).expect(409);
    await http()
      .post(`/api/v1/lab/orders/${id}/validations/technical`)
      .set(as('analis'))
      .send({ qcOverrideReason: null })
      .expect(200);
    await http().post(`/api/v1/lab/orders/${id}/validations/clinical`).set(as('analis')).expect(403);
    await http().post(`/api/v1/lab/orders/${id}/validations/clinical`).set(as('dpjp')).expect(403);
    const rel = await http()
      .post(`/api/v1/lab/orders/${id}/validations/clinical`)
      .set(as('dokterLab'))
      .expect(200);
    const d = rel.body as LabOrderDetail;
    expect(d.status).toBe('selesai');
    expect(d.releasedAt).not.toBeNull();
    expect(d.results[0]?.resultStatus).toBe('final');
    expect(d.validations.map((v) => [v.level, v.signatureStatus])).toEqual([
      ['teknis', null],
      ['klinis', 'pending'],
    ]);
    const obs = await run(T.id, (tx) =>
      tx.observation.findMany({ where: { serviceRequestId: { in: r.serviceRequestIds }, category: 'lab' } }),
    );
    expect(obs).toHaveLength(1);
    expect(obs[0]).toMatchObject({ code: '2823-3', interpretation: 'normal' });
    expect(Number(obs[0]?.valueNumeric)).toBe(4.2);
    const note = await run(T.id, (tx) =>
      tx.notification.findFirst({ where: { kind: 'lab.result_released', recipientUserId: uid.dpjp } }),
    );
    expect(note).not.toBeNull();

    // Koreksi setelah rilis → status hasil (validasi ulang), event `released`, observasi versi baru setelah rilis ulang.
    const corr = await http()
      .post(`/api/v1/lab/results/${d.results[0]?.id}/corrections`)
      .set(as('analis'))
      .send({ valueNumeric: 4.6, valueText: null, reason: 'Salah ketik saat input manual' })
      .expect(200);
    expect(corr.body).toMatchObject({ status: 'hasil', round: 2 });
    expect(corr.body.results[0]).toMatchObject({ version: 2, resultStatus: 'preliminary' });
    await http()
      .post(`/api/v1/lab/orders/${id}/validations/technical`)
      .set(as('analis'))
      .send({ qcOverrideReason: null })
      .expect(200);
    await http().post(`/api/v1/lab/orders/${id}/validations/clinical`).set(as('dokterLab')).expect(200);
    const obs2 = await run(T.id, (tx) =>
      tx.observation.findMany({
        where: { serviceRequestId: { in: r.serviceRequestIds }, category: 'lab' },
        orderBy: { version: 'asc' },
      }),
    );
    expect(obs2.map((o) => [o.version, Number(o.valueNumeric)])).toEqual([
      [1, 4.2],
      [2, 4.6],
    ]);
    const corrected = await run(T.id, (tx) =>
      tx.domainEvent.findMany({ where: { name: 'lab.result_corrected' }, select: { payload: true } }),
    );
    expect(
      corrected.some((e) => (e.payload as { released: boolean; labOrderId: string }).labOrderId === id),
    ).toBe(true);
  });

  it('QC ditolak (Westgard 1-3s) memblokir validasi teknis kecuali override beralasan', async () => {
    const r = await readyOrder({ GDS: 110 }, ['Glukosa sewaktu']);
    const qc = await http()
      .post('/api/v1/lab/qc')
      .set(as('analis'))
      .send({
        analyzerId: null,
        testDefinitionId: testId(r.detail, 'GDS'),
        controlLevel: 1,
        value: 140,
        mean: 100,
        sd: 10,
      })
      .expect(201);
    expect(qc.body).toMatchObject({ outcome: 'reject', violations: ['1-3s'] });
    const blocked = await http()
      .post(`/api/v1/lab/orders/${r.detail.id}/validations/technical`)
      .set(as('analis'))
      .send({ qcOverrideReason: null })
      .expect(409);
    expect(blocked.body.code).toBe('QC_REJECTED');
    await http()
      .post(`/api/v1/lab/orders/${r.detail.id}/validations/technical`)
      .set(as('analis'))
      .send({ qcOverrideReason: 'Kontrol diulang, hasil kontrol kedua dalam rentang' })
      .expect(200);
    const list = await http().get('/api/v1/lab/qc').set(as('analis')).expect(200);
    expect(list.body[0]).toMatchObject({ outcome: 'reject' });
  });

  it('detail = audit read; cetak HTML sementara + audit print; tenant lain 404', async () => {
    const r = await readyOrder({ K: 4.0 });
    await http().get(`/api/v1/lab/orders/${r.detail.id}`).set(as('analis')).expect(200);
    const html = await http().get(`/api/v1/lab/orders/${r.detail.id}/print`).set(as('analis')).expect(200);
    expect(html.headers['content-type']).toContain('text/html');
    expect(html.text).toContain('HASIL SEMENTARA');
    const audits = await run(T.id, (tx) =>
      tx.auditEvent.findMany({ where: { resourceId: r.detail.id, action: { in: ['read', 'print'] } } }),
    );
    expect(audits.map((a) => a.action).sort()).toEqual(['print', 'read']);
    await http()
      .get(`/api/v1/lab/orders/${r.detail.id}`)
      .set(bearer(tok.analisB as Tokens))
      .expect(404);
  });
});
