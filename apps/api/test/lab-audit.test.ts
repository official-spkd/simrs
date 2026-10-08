/**
 * S01 · Audit agen BUG atas lab 4.2: hasil yang dikoreksi setelah rilis belum boleh terbaca klinisi/CDS sebelum
 * divalidasi ulang (ResultsQueryService = hasil rilis), detail order lintas unit/tenant, dan rilis tanpa izin. Fiktif.
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
import { requestContext } from '../src/common/request-context';
import { ResultsQueryService } from '../src/modules/lab/results-query.service';
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

/** `ResultsQueryService.latest` di konteks tenant T (seperti pemanggil CDS/eGFR). */
async function latestK(patientId: string) {
  const svc = app.get(ResultsQueryService);
  return withTenant(testDb(), T.id, (tx) =>
    requestContext.run(
      {
        tenantId: T.id,
        tx,
        actor: { userId: uid.dpjp ?? null, role: 'dokter', sessionId: null, unitId: null },
        requestId: null,
        ip: null,
        userAgent: null,
        permissionScope: null,
        audit: [],
        afterCommit: [],
      },
      () => svc.latest(patientId, ['2823-3']),
    ),
  );
}

describe('audit BUG · lab 4.2', () => {
  it('koreksi setelah rilis: nilai koreksi belum tervalidasi tidak dipakai klinisi/CDS sampai dirilis ulang', async () => {
    const r = await readyOrder({ K: 4.2 });
    const id = r.detail.id;
    await http()
      .post(`/api/v1/lab/orders/${id}/validations/technical`)
      .set(as('analis'))
      .send({ qcOverrideReason: null })
      .expect(200);
    const rel = (
      await http().post(`/api/v1/lab/orders/${id}/validations/clinical`).set(as('dokterLab')).expect(200)
    ).body as LabOrderDetail;
    expect((await latestK(r.patientId)).map((x) => x.valueNumeric)).toEqual([4.2]);
    await http()
      .post(`/api/v1/lab/results/${rel.results[0]?.id}/corrections`)
      .set(as('analis'))
      .send({ valueNumeric: 4.9, valueText: null, reason: 'Salah ketik saat input manual' })
      .expect(200);
    // Sebelum validasi ulang: yang terbaca klinisi tetap nilai rilis terakhir (atau tidak ada), BUKAN 4,9 (nilai koreksi).
    expect((await latestK(r.patientId)).map((x) => x.valueNumeric)).not.toContain(4.9);
    await http()
      .post(`/api/v1/lab/orders/${id}/validations/technical`)
      .set(as('analis'))
      .send({ qcOverrideReason: null })
      .expect(200);
    await http().post(`/api/v1/lab/orders/${id}/validations/clinical`).set(as('dokterLab')).expect(200);
    expect((await latestK(r.patientId)).map((x) => x.valueNumeric)).toEqual([4.9]);
  });

  it('detail order: analis unit lain 403, tenant lain 404; rilis tanpa izin release 403', async () => {
    const r = await readyOrder({ K: 4.0 });
    await http().get(`/api/v1/lab/orders/${r.detail.id}`).set(as('analisRad')).expect(403);
    await http().get(`/api/v1/lab/orders/${r.detail.id}`).set(as('analisB')).expect(404);
    await http()
      .post(`/api/v1/lab/orders/${r.detail.id}/validations/technical`)
      .set(as('analisRad'))
      .send({ qcOverrideReason: null })
      .expect(403);
    await http().post(`/api/v1/lab/orders/${r.detail.id}/validations/clinical`).set(as('analis')).expect(403);
  });
});
