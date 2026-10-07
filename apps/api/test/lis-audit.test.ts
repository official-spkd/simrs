/**
 * Fase 4 §4.1a · Audit agen BUG atas jalur analyzer lab + SSE penunjang: enrol sekali pakai di bawah serentak,
 * HMAC (cap waktu masa depan, ISO, byte non-UTF-8), redaksi segmen ber-PHI selain PID/NK1, batas 413 tanpa
 * Content-Length, dan SSE nilai kritis lingkup relasi (dokter hanya pasien berelasi). Tenant dan data fiktif.
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
import { createHmac } from 'node:crypto';
import { lisSignature } from '@simrs/shared/node';
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
        status: 'hasil',
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

describe('audit BUG · enrol analyzer', () => {
  it('kode sekali pakai di bawah 8 permintaan serentak: tepat satu token; kode RS lain 401', async () => {
    const dev = await createDevice('lab_analyzer', unit.LAB as string);
    await http().post('/api/v1/devices/lis/enrol').send({ tenantCode: B.code, code: dev.code }).expect(401);
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        http().post('/api/v1/devices/lis/enrol').send({ tenantCode: T.code, code: dev.code }),
      ),
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status !== 200 && r.status !== 401).map((r) => r.status)).toEqual([]);
  });
});

describe('audit BUG · HMAC ingest', () => {
  it('cap waktu > 5 menit di masa depan → 401; ISO 8601 dalam batas → 200', async () => {
    const future = String(Math.floor(Date.now() / 1000) + 6 * 60);
    await ingest(oru(`FUT${newId().slice(-10)}`), { ts: future }).expect(401);
    await ingest(oru(`ISO${newId().slice(-10)}`), { ts: new Date().toISOString() }).expect(200);
  });

  it('tanda tangan atas byte mentah: pesan ISO-8859-1 (charset dideklarasikan) diterima', async () => {
    const ctrl = `LAT${newId().slice(-10)}`;
    const text = oru(ctrl).replace('Kalium', 'Kalium s\u00e9rum');
    const bytes = Buffer.from(text, 'latin1');
    const ts = nowSec();
    const sig = createHmac('sha256', analyzer.hmacKey)
      .update(Buffer.concat([Buffer.from(`${ts}.`, 'utf8'), bytes]))
      .digest('hex');
    const res = await http()
      .post('/api/v1/devices/lis/hl7')
      .set('Authorization', `Bearer ${analyzer.token}`)
      .set('Content-Type', 'application/hl7-v2; charset=iso-8859-1')
      .set('X-Device-Timestamp', ts)
      .set('X-Device-Signature', sig)
      .send(bytes);
    expect(res.status).toBe(200);
    const ev = await run(T.id, (tx) =>
      tx.inboundEvent.findFirstOrThrow({ where: { source: 'lis-hl7', idempotencyKey: ctrl } }),
    );
    expect(ev.rawBody).toContain('Kalium s\u00e9rum');
    // Charset lain (mis. UTF-16) ditolak 415 sebelum apa pun disimpan.
    const ctrl2 = `U16${newId().slice(-10)}`;
    await ingest(oru(ctrl2), { type: 'application/hl7-v2; charset=utf-16' }).expect(415);
    expect(await inboundCount(T.id, ctrl2)).toBe(0);
  });

  it('> 256 KB tanpa Content-Length (chunked) → 413 tanpa menyimpan', async () => {
    const ctrl = `CHK${newId().slice(-10)}`;
    const body = `${oru(ctrl)}\rNTE|1||${'y'.repeat(300 * 1024)}`;
    const ts = nowSec();
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/devices/lis/hl7`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${analyzer.token}`,
        'content-type': HL7,
        'x-device-timestamp': ts,
        'x-device-signature': lisSignature(ts, body, analyzer.hmacKey),
      },
      body: new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode(body));
          c.close();
        },
      }),
      duplex: 'half',
    } as RequestInit);
    expect(res.status).toBe(413);
    expect(await inboundCount(T.id, ctrl)).toBe(0);
  });
});

describe('audit BUG · redaksi PHI di inbound_events', () => {
  it('segmen ber-PHI selain PID/NK1 (PD1, PV1, GT1, IN1, MRG) dan PID berawalan spasi tidak tersimpan apa adanya', async () => {
    const ctrl = `PHI${newId().slice(-10)}`;
    const [msh, ...rest] = oru(ctrl, 'L2610070009-01', false).split('\r');
    const body = [
      msh,
      ' PID|1||RM00999^^^RS||Wulandari^Rina||19900101|F',
      'PD1|||Puskesmas Kenanga^^1234',
      'PV1|1|I|MELATI^M-205^1||||9999^dr. Hartono Fiktif|||||||||||VN-00777',
      'GT1|1||Wulandari^Budi||Jl. Kenanga No. 12^^Jakarta||081200001111',
      'IN1|1|BPJS|0001|BPJS Kesehatan|||||||||||Wulandari^Rina|||19900101',
      'MRG|RM00111',
      ...rest,
    ].join('\r');
    await ingest(body).expect(200);
    const ev = await run(T.id, (tx) =>
      tx.inboundEvent.findFirstOrThrow({ where: { source: 'lis-hl7', idempotencyKey: ctrl } }),
    );
    expect(ev.rawBody).not.toMatch(/Wulandari|RM00999|RM00111|Kenanga|081200001111|19900101|VN-00777|M-205/);
    // Segmen hasil tetap utuh untuk pencocokan barcode.
    expect(ev.rawBody).toContain('OBR|1||L2610070009-01');
    expect(ev.rawBody).toMatch(/OBX\|1\|NM\|2823-3/);
  });
});

describe('audit BUG · SSE nilai kritis lingkup relasi', () => {
  it('dokter (lingkup relationship) hanya menerima nilai kritis pasien berelasi', async () => {
    await staff('dokter', T, 'dokter');
    const mine = await labFixture(T.id, unit);
    const other = await labFixture(T.id, unit);
    await run(T.id, (tx) =>
      tx.accessRelationship.create({
        data: {
          id: newId(),
          tenantId: T.id,
          userId: userId.dokter as string,
          patientId: mine.patientId,
          kind: 'dpjp',
          sourceType: 'encounter',
          sourceId: mine.encounterId,
        },
      }),
    );
    const s = await openStream('dokter', 'support/streams/critical');
    try {
      expect(s.status).toBe(200);
      await new Promise((r) => setTimeout(r, 300));
      const raise = (f: { resultId: string; encounterId: string; patientId: string }) => {
        const id = newId();
        return run(T.id, (tx) =>
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
        ).then(() => id);
      };
      const a = await raise(mine);
      const b = await raise(other);
      await s.waitFor(() => s.events.some((e) => e.data.criticalResultId === a));
      await new Promise((r) => setTimeout(r, 500));
      expect(s.events.some((e) => e.data.criticalResultId === b)).toBe(false);
    } finally {
      s.close();
    }
  });
});
