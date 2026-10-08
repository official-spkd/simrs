/**
 * Fase 4 §4.1a · Infrastruktur penunjang:
 * - analyzer lab sebagai prinsipal perangkat (`lab_analyzer`): pendaftaran gateway (`/devices/lis/enrol`) memberi token
 *   `dv1` + kunci HMAC (tersimpan terenkripsi); kode analyzer tidak berlaku di jalur peramban dan sebaliknya,
 * - ingest `POST /devices/lis/hl7`: HMAC `timestamp.body` ≤ 5 menit, idempotensi MSH-10, PID/NK1 diredaksi, ACK AA,
 *   batas ukuran/tipe konten, perangkat vs staf saling ditolak 403, tanda tangan salah → 401 tanpa menyimpan,
 * - `CriticalResultsService.raise()` + gerbang `hasOpenCritical`, `ResultsQueryService` (eGFR),
 * - SSE penunjang tanpa PHI, tidak bocor antar-tenant maupun antar-unit.
 * Tenant fiktif baru; data pasien fiktif.
 */
import type { AddressInfo } from 'node:net';
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
import { buildOru, newId } from '@simrs/shared';
import { decryptField, fieldKeysFromEnv, lisSignature } from '@simrs/shared/node';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { requestContext, type TenantRequestContext } from '../src/common/request-context';
import { CriticalResultsService } from '../src/modules/critical-results/critical-results.service';
import { ResultsQueryService } from '../src/modules/lab/results-query.service';
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
let owner: PrismaClient;
let T: { id: string; code: string };
let B: { id: string; code: string };
const unit: Record<string, string> = {};
const unitB: Record<string, string> = {};
const tok: Record<string, Tokens> = {};
const userId: Record<string, string> = {};
let analyzer: { id: string; token: string; hmacKey: string };
let kioskToken: string;

const http = () => request(app.getHttpServer());
const run = <R>(tenantId: string, fn: (tx: TenantTx) => Promise<R>) => withTenant(testDb(), tenantId, fn);
const HL7 = 'application/hl7-v2; charset=utf-8';
const nowSec = () => String(Math.floor(Date.now() / 1000));

function oru(controlId: string, barcode = 'L2610070001-01', pid = true): string {
  const msg = buildOru({
    controlId,
    sendingApplication: 'ANALYZER-UJI',
    sendingFacility: 'LAB',
    sentAt: '20261007100000',
    specimenBarcode: barcode,
    observations: [
      { code: '2823-3', text: 'Kalium', value: '6.8', unit: 'mmol/L', referenceRange: '3.5-5.0' },
    ],
  });
  if (!pid) return msg;
  // Analyzer nyata sering mengirim PID/NK1: wajib diredaksi sebelum disimpan.
  const [msh, ...rest] = msg.split('\r');
  return [msh, 'PID|1||RM00123^^^RS||Rahmawati^Siti||19850314|F', 'NK1|1|Rahmawati^Budi|SPO', ...rest].join(
    '\r',
  );
}

function ingest(body: string, opts: { token?: string; key?: string; ts?: string; type?: string } = {}) {
  const ts = opts.ts ?? nowSec();
  return http()
    .post('/api/v1/devices/lis/hl7')
    .set('Authorization', `Bearer ${opts.token ?? analyzer.token}`)
    .set('Content-Type', opts.type ?? HL7)
    .set('X-Device-Timestamp', ts)
    .set('X-Device-Signature', lisSignature(ts, body, opts.key ?? analyzer.hmacKey))
    .buffer(true)
    .parse((res, cb) => {
      let data = '';
      res.on('data', (c: Buffer) => (data += c.toString('utf8')));
      res.on('end', () => cb(null, data));
    })
    .send(body);
}

const inboundCount = (tenantId: string, key?: string) =>
  run(tenantId, (tx) =>
    tx.inboundEvent.count({ where: { source: 'lis-hl7', ...(key ? { idempotencyKey: key } : {}) } }),
  );

async function createDevice(kind: 'lab_analyzer' | 'kiosk', unitId: string) {
  const res = await http()
    .post('/api/v1/iam/devices')
    .set(bearer(tok.admin as Tokens))
    .send({ kind, name: kind === 'kiosk' ? 'Anjungan uji' : 'Analyzer kimia uji', unitId })
    .expect(201);
  return { id: res.body.id as string, code: res.body.enrolmentCode as string };
}

async function staff(who: string, tenant: { id: string; code: string }, role: string, unitId?: string) {
  const u = await createTestUser(tenant.id, { roles: [{ code: role, unitId }], tenantCode: tenant.code });
  tok[who] = await login(app, u);
  userId[who] = u.id;
}

beforeAll(async () => {
  owner = createPrismaClient({ connectionString: testDbUrls().migrator, max: 2 });
  app = await createTestApp();
  await app.listen(0, '127.0.0.1');
  port = (app.getHttpServer().address() as AddressInfo).port;
  T = await createTestTenant();
  B = await createTestTenant();
  for (const [t, map] of [
    [T, unit],
    [B, unitB],
  ] as const) {
    await withTenant(owner, t.id, (tx) => seedHospitalStructure(tx, t.id));
    await run(t.id, async (tx) => {
      await seedClinicalMasters(tx, t.id);
      await seedSupportMasters(tx, t.id);
      for (const u of await tx.unit.findMany({ select: { id: true, code: true } })) map[u.code] = u.id;
    });
  }
  await staff('admin', T, 'admin_tenant');
  await staff('analisLab', T, 'analis_lab', unit.LAB);
  await staff('analisRad', T, 'analis_lab', unit.RAD);
  await staff('kasir', T, 'kasir');
  await staff('analisB', B, 'analis_lab', unitB.LAB);

  const dev = await createDevice('lab_analyzer', unit.LAB as string);
  const enrolled = await http()
    .post('/api/v1/devices/lis/enrol')
    .send({ tenantCode: T.code, code: dev.code })
    .expect(200);
  analyzer = { id: dev.id, token: enrolled.body.token, hmacKey: enrolled.body.hmacKey };
  const kiosk = await createDevice('kiosk', unit.LAB as string);
  kioskToken = (
    await http().post('/api/v1/devices/enrol').send({ tenantCode: T.code, code: kiosk.code }).expect(200)
  ).body.token;
}, 120_000);

afterAll(async () => {
  await app?.close();
  await owner?.$disconnect();
});

describe('pendaftaran analyzer lab (ADR-0027 + kunci HMAC)', () => {
  it('jalur gateway memberi token dv1 + kunci HMAC sekali; tersimpan terenkripsi, bukan teks asli', async () => {
    expect(analyzer.token).toMatch(/^dv1\./);
    expect(analyzer.hmacKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const row = await run(T.id, (tx) =>
      tx.registeredDevice.findUniqueOrThrow({
        where: { id: analyzer.id },
        select: { hmacKeyEnc: true, kind: true },
      }),
    );
    expect(row.kind).toBe('lab_analyzer');
    expect(row.hmacKeyEnc).toMatch(/^v\d+\./);
    expect(row.hmacKeyEnc).not.toContain(analyzer.hmacKey);
    const keys = fieldKeysFromEnv(process.env);
    expect(
      decryptField(row.hmacKeyEnc as string, { ring: keys.enc, tenantId: T.id, purpose: 'device_hmac' }),
    ).toBe(analyzer.hmacKey);
  });

  it('kode analyzer tidak berlaku di halaman peramban (tidak terpakai), kode anjungan tidak berlaku di gateway', async () => {
    const dev = await createDevice('lab_analyzer', unit.LAB as string);
    await http().post('/api/v1/devices/enrol').send({ tenantCode: T.code, code: dev.code }).expect(401);
    const ok = await http()
      .post('/api/v1/devices/lis/enrol')
      .send({ tenantCode: T.code, code: dev.code })
      .expect(200);
    expect(ok.body.ingestPath).toBe('/api/v1/devices/lis/hl7');
    expect(ok.body.permissions).toEqual(['lab.analyzer.ingest']);
    await http().post('/api/v1/devices/lis/enrol').send({ tenantCode: T.code, code: dev.code }).expect(401);
    const kiosk = await createDevice('kiosk', unit.LAB as string);
    await http().post('/api/v1/devices/lis/enrol').send({ tenantCode: T.code, code: kiosk.code }).expect(401);
  });

  it('kunci HMAC tidak bisa diganti diam-diam (penjaga DB): hanya ID kunci yang berganti boleh', async () => {
    const stored = await run(T.id, (tx) =>
      tx.registeredDevice.findUniqueOrThrow({ where: { id: analyzer.id }, select: { hmacKeyEnc: true } }),
    );
    const sameKeyId = `${String(stored.hmacKeyEnc).split('.')[0]}.AAAA.BBBB.CCCC`;
    const err = await run(T.id, (tx) =>
      tx.registeredDevice.update({ where: { id: analyzer.id }, data: { hmacKeyEnc: sameKeyId } }),
    ).catch((e: Error) => e.message);
    expect(String(err)).toMatch(/DEVICE_IMMUTABLE/);
  });
});

describe('ingest HL7 analyzer', () => {
  it('ORU sah → 200 + ACK AA; PID/NK1 diredaksi; tanpa token/tanda tangan di header tersimpan; audit atas nama perangkat', async () => {
    const ctrl = `UJI${newId().slice(-12)}`;
    const res = await ingest(oru(ctrl)).expect(200);
    expect(res.headers['content-type']).toContain('application/hl7-v2');
    expect(res.body).toContain(`MSA|AA|${ctrl}`);
    const ev = await run(T.id, (tx) =>
      tx.inboundEvent.findFirstOrThrow({ where: { source: 'lis-hl7', idempotencyKey: ctrl } }),
    );
    expect(ev.status).toBe('received');
    expect(ev.deviceId).toBe(analyzer.id);
    expect(ev.rawBody).toContain('PID|1');
    expect(ev.rawBody).toContain('NK1|1');
    expect(ev.rawBody).not.toMatch(/Rahmawati|RM00123|19850314/);
    expect(JSON.stringify(ev.headers)).not.toMatch(/dv1|signature|authorization/i);
    const audit = await run(T.id, (tx) =>
      tx.auditEvent.findFirstOrThrow({ where: { resourceType: 'inbound_event', resourceId: ev.id } }),
    );
    expect(audit.action).toBe('create');
    expect(audit.actorUserId).toBeNull();
    expect(JSON.stringify(audit.details)).toContain(analyzer.id);
  });

  it('kiriman ulang MSH-10 sama → ACK AA lagi, tetap satu event; isi berbeda → 409 + ACK AR', async () => {
    const ctrl = `DUP${newId().slice(-12)}`;
    const body = oru(ctrl);
    await ingest(body).expect(200);
    const again = await ingest(body).expect(200);
    expect(again.body).toContain(`MSA|AA|${ctrl}`);
    expect(await inboundCount(T.id, ctrl)).toBe(1);
    const other = await ingest(oru(ctrl, 'L2610070002-01')).expect(409);
    expect(other.body).toContain(`MSA|AR|${ctrl}`);
    expect(await inboundCount(T.id, ctrl)).toBe(1);
  });

  it('tanda tangan salah / cap waktu > 5 menit / tanpa tanda tangan → 401 tanpa menyimpan; penolakan diaudit', async () => {
    const before = await inboundCount(T.id);
    const ctrl = `BAD${newId().slice(-12)}`;
    const bad = await ingest(oru(ctrl), { key: `${analyzer.hmacKey}x` }).expect(401);
    expect(String(bad.body)).toContain('Tanda tangan perangkat tidak sah');
    const old = String(Math.floor(Date.now() / 1000) - 6 * 60);
    await ingest(oru(ctrl), { ts: old }).expect(401);
    await http()
      .post('/api/v1/devices/lis/hl7')
      .set('Authorization', `Bearer ${analyzer.token}`)
      .set('Content-Type', HL7)
      .send(oru(ctrl))
      .expect(401);
    expect(await inboundCount(T.id)).toBe(before);
    const denied = await run(T.id, (tx) =>
      tx.auditEvent.count({ where: { action: 'access_denied', resourceType: 'inbound_event' } }),
    );
    expect(denied).toBeGreaterThanOrEqual(3);
  });

  it('bukan ORU^R01 → 400 + ACK AR; tipe konten bukan HL7 → 415; > 256 KB → 413', async () => {
    const adt = 'MSH|^~\\&|X|Y|||20261007||ADT^A01|C1|P|2.5';
    const res = await ingest(adt).expect(400);
    expect(res.body).toContain('MSA|AR');
    await ingest(oru(`TYP${newId().slice(-8)}`), { type: 'text/xml' }).expect(415);
    const big = `${oru(`BIG${newId().slice(-8)}`)}\rNTE|1||${'x'.repeat(260 * 1024)}`;
    await ingest(big).expect(413);
  });

  it('token staf di endpoint ingest → 403; token analyzer di endpoint staf → 403; anjungan tanpa izin ingest → 403', async () => {
    const body = oru(`STF${newId().slice(-8)}`);
    await http()
      .post('/api/v1/devices/lis/hl7')
      .set(bearer(tok.analisLab as Tokens))
      .set('Content-Type', HL7)
      .send(body)
      .expect(403);
    await http().get('/api/v1/iam/devices').set('Authorization', `Bearer ${analyzer.token}`).expect(403);
    await http()
      .get('/api/v1/support/streams/lab-worklist')
      .set('Authorization', `Bearer ${analyzer.token}`)
      .expect(403);
    await ingest(body, { token: kioskToken }).expect(403);
  });

  it('pesan tenant lain tidak terlihat (RLS)', async () => {
    expect(await inboundCount(B.id)).toBe(0);
  });
});

/** Kunjungan + order lab + hasil (opsional kritis) langsung di DB. */
async function labFixture(
  tenantId: string,
  units: Record<string, string>,
  opts: { released?: boolean } = {},
) {
  const p = await createTestPatient(tenantId, {
    name: 'Tn. Uji Penunjang',
    sex: 'male',
    birthDate: '1970-01-01',
  });
  return run(tenantId, async (tx) => {
    const analyst = (await tx.user.findFirstOrThrow({ select: { id: true } })).id;
    const enc = await tx.encounter.create({
      data: {
        id: newId(),
        tenantId,
        number: `RI-SI-${newId().slice(-8)}`,
        patientId: p.id,
        encounterClass: 'IMP',
        status: 'in_progress',
        unitId: units.MELATI as string,
        plannedAt: new Date(),
      },
    });
    const order = await tx.labOrder.create({
      data: {
        id: newId(),
        tenantId,
        labNo: `L261007${String(Math.floor(Math.random() * 9999)).padStart(4, '0')}`,
        encounterId: enc.id,
        patientId: p.id,
        unitId: units.LAB as string,
        priority: 'cito',
        // Rilis = order selesai (ResultsQueryService hanya membaca rilis yang masih berlaku).
        status: opts.released ? 'selesai' : 'hasil',
        idempotencyKey: newId(),
        acceptedBy: analyst,
        releasedAt: opts.released ? new Date() : null,
      },
    });
    const def = await tx.labTestDefinition.findFirstOrThrow({ where: { loinc: '2160-0' } });
    const id = newId();
    const result = await tx.labResult.create({
      data: {
        id,
        rootId: id,
        tenantId,
        patientId: p.id,
        encounterId: enc.id,
        occurredAt: new Date(),
        authorUserId: analyst,
        authorRole: 'analis_lab',
        labOrderId: order.id,
        testDefinitionId: def.id,
        loinc: def.loinc,
        name: def.name,
        valueNumeric: 1.1,
        unit: 'mg/dL',
        decimals: 1,
        flag: 'N',
        source: 'manual',
      },
    });
    return { patientId: p.id, encounterId: enc.id, orderId: order.id, resultId: result.id, analyst };
  });
}

function ctxFor(tenantId: string, tx: TenantTx, actorUserId: string | null): TenantRequestContext {
  return {
    tenantId,
    tx,
    actor: { userId: actorUserId, role: 'analis_lab', sessionId: null, unitId: null },
    requestId: null,
    ip: null,
    userAgent: null,
    permissionScope: null,
    audit: [],
    afterCommit: [],
  };
}

describe('kerangka nilai kritis dan ResultsQueryService', () => {
  it('raise() sekali per hasil (idempoten), batas lapor dari pengaturan, event tanpa PHI; gerbang hasOpenCritical', async () => {
    const f = await labFixture(T.id, unit);
    const svc = app.get(CriticalResultsService);
    const first = await run(T.id, (tx) =>
      requestContext.run(ctxFor(T.id, tx, f.analyst), () =>
        svc.raise({ source: 'lab', labResultId: f.resultId, analyte: 'Kreatinin', valueText: '1,1 mg/dL' }),
      ),
    );
    expect(first).toMatchObject({ created: true, limitMinutes: 30 });
    const again = await run(T.id, (tx) =>
      requestContext.run(ctxFor(T.id, tx, f.analyst), () =>
        svc.raise({ source: 'lab', labResultId: f.resultId, analyte: 'Kreatinin', valueText: '1,1 mg/dL' }),
      ),
    );
    expect(again).toEqual({ id: first.id, created: false, limitMinutes: 30 });
    const open = await run(T.id, (tx) =>
      requestContext.run(ctxFor(T.id, tx, f.analyst), () => svc.hasOpenCritical(f.orderId)),
    );
    expect(open).toBe(true);
    const row = await run(T.id, (tx) => tx.criticalResult.findUniqueOrThrow({ where: { id: first.id } }));
    expect(row).toMatchObject({ status: 'terbuka', unitId: unit.LAB, encounterId: f.encounterId });
    const events = await run(T.id, (tx) =>
      tx.domainEvent.findMany({ where: { name: 'critical_result.raised' }, select: { payload: true } }),
    );
    const ev = events.find((e) => (e.payload as { criticalResultId: string }).criticalResultId === first.id);
    expect(ev?.payload).toMatchObject({
      source: 'lab',
      sourceId: f.resultId,
      unitId: unit.LAB,
      limitMinutes: 30,
    });
    expect(JSON.stringify(ev?.payload)).not.toMatch(/Kreatinin|1,1/);
  });

  it('ResultsQueryService: hanya hasil yang sudah dirilis; eGFR CKD-EPI 2021 dari kreatinin + umur/jenis kelamin', async () => {
    const svc = app.get(ResultsQueryService);
    const pending = await labFixture(T.id, unit);
    const none = await run(T.id, (tx) =>
      requestContext.run(ctxFor(T.id, tx, null), () => svc.latest(pending.patientId, ['2160-0'])),
    );
    expect(none).toEqual([]);
    const done = await labFixture(T.id, unit, { released: true });
    const egfr = await run(T.id, (tx) =>
      requestContext.run(ctxFor(T.id, tx, null), () => svc.egfr(done.patientId)),
    );
    expect(egfr?.creatinineResultId).toBe(done.resultId);
    expect(egfr?.value).toBeGreaterThan(60);
    expect(egfr?.value).toBeLessThan(90);
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
  const waitFor = async (pred: () => boolean, ms = 8_000) => {
    const until = Date.now() + ms;
    while (!pred()) {
      if (Date.now() > until) throw new Error(`waitFor timeout; events=${JSON.stringify(events)}`);
      await new Promise((r) => setTimeout(r, 20));
    }
  };
  return { status: res.status, events, waitFor, close: () => controller.abort() };
}

describe('SSE penunjang (ADR-0026)', () => {
  it('worklist lab: unit pelaksana menerima ID + status saja; unit lain dan tenant lain tidak', async () => {
    const lab = await openStream('analisLab', 'support/streams/lab-worklist');
    const rad = await openStream('analisRad', 'support/streams/lab-worklist');
    const other = await openStream('analisB', 'support/streams/lab-worklist');
    try {
      expect([lab.status, rad.status, other.status]).toEqual([200, 200, 200]);
      await new Promise((r) => setTimeout(r, 300));
      const f = await labFixture(T.id, unit);
      const histId = newId();
      await run(T.id, (tx) =>
        tx.labOrderStatusHistory.create({
          data: {
            id: histId,
            tenantId: T.id,
            labOrderId: f.orderId,
            fromStatus: 'proses',
            toStatus: 'hasil',
          },
        }),
      );
      await lab.waitFor(() => lab.events.some((e) => e.data.eventId === histId));
      const ev = lab.events.find((e) => e.data.eventId === histId);
      expect(ev?.event).toBe('lab.worklist');
      expect(Object.keys(ev?.data ?? {}).sort()).toEqual(['at', 'eventId', 'labOrderId', 'status', 'unitId']);
      expect(ev?.data).toMatchObject({ labOrderId: f.orderId, unitId: unit.LAB, status: 'hasil' });
      await new Promise((r) => setTimeout(r, 500));
      expect(rad.events.some((e) => e.data.eventId === histId)).toBe(false);
      expect(other.events.some((e) => e.data.eventId === histId)).toBe(false);
    } finally {
      lab.close();
      rad.close();
      other.close();
    }
  });

  it('nilai kritis: unit pelapor menerima event `raised` tanpa nilai/analit; unit lain tidak', async () => {
    const lab = await openStream('analisLab', 'support/streams/critical');
    const rad = await openStream('analisRad', 'support/streams/critical');
    try {
      await new Promise((r) => setTimeout(r, 300));
      const f = await labFixture(T.id, unit);
      const id = newId();
      await run(T.id, (tx) =>
        tx.criticalResult.create({
          data: {
            id,
            tenantId: T.id,
            source: 'lab',
            labResultId: f.resultId,
            encounterId: f.encounterId,
            patientId: f.patientId,
            unitId: unit.LAB as string,
            analyte: 'Kalium',
            valueText: '6,8 mmol/L',
            limitMinutes: 30,
          },
        }),
      );
      await lab.waitFor(() => lab.events.some((e) => e.data.criticalResultId === id));
      const ev = lab.events.find((e) => e.data.criticalResultId === id);
      expect(ev?.data).toMatchObject({ kind: 'raised', status: 'terbuka', level: 0, unitId: unit.LAB });
      expect(JSON.stringify(ev?.data)).not.toMatch(/Kalium|6,8|Uji Penunjang/);
      await new Promise((r) => setTimeout(r, 500));
      expect(rad.events.some((e) => e.data.criticalResultId === id)).toBe(false);
    } finally {
      lab.close();
      rad.close();
    }
  });

  it('kasir tanpa izin worklist/nilai kritis → 403', async () => {
    await http()
      .get('/api/v1/support/streams/lab-worklist')
      .set(bearer(tok.kasir as Tokens))
      .expect(403);
    await http()
      .get('/api/v1/support/streams/critical')
      .set(bearer(tok.kasir as Tokens))
      .expect(403);
  });
});
