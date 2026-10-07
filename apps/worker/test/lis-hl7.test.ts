/**
 * Fase 4 §4.2 · Penangan pesan analyzer `lis-hl7`: cocok HANYA lewat barcode spesimen (OBR), hasil analyzer = hasil awal
 * bersumber `analyzer` yang merujuk pesannya, flag/rentang dari inti yang sama dengan input manual, nilai kritis →
 * S09 + event worker `critical_result.raised`; spesimen belum diterima → dicoba lagi; barcode tak dikenal / order sudah
 * divalidasi → berhenti (`dead`) dengan galat tanpa PHI; kiriman ulang dengan nilai sama tidak menggandakan hasil.
 * Data fiktif.
 */
import { createHash, randomBytes } from 'node:crypto';
import {
  createPrismaClient,
  ensureSystemRoles,
  insertPatient,
  type PrismaClient,
  seedClinicalMasters,
  seedHospitalStructure,
  seedSupportMasters,
  type TenantTx,
  withTenant,
} from '@simrs/db';
import { testDbUrls } from '@simrs/db/testing';
import { buildOru, newId, redactHl7 } from '@simrs/shared';
import { PatientCrypto } from '@simrs/shared/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InboundProcessor } from '../src/inbound/inbound.processor';
import { hl7Instant } from '../src/inbound/lis-hl7.handler';
import { freshTenant, loadTestEnvFile, testEnv, testModule } from './helpers';

let db: PrismaClient;
let owner: PrismaClient;
let processor: InboundProcessor;
let close: () => Promise<void>;

interface Ctx {
  tenantId: string;
  deviceId: string;
  analyst: string;
  labOrderId: string;
  barcodes: Record<string, string>;
}
let C: Ctx;

const inT = <T>(fn: (tx: TenantTx) => Promise<T>) => withTenant(db, C.tenantId, fn);

async function setup(): Promise<Ctx> {
  const tenantId = await freshTenant('LIS');
  await withTenant(owner, tenantId, async (tx) => {
    await ensureSystemRoles(tx, tenantId);
    await seedHospitalStructure(tx, tenantId);
  });
  return withTenant(db, tenantId, async (tx) => {
    await seedClinicalMasters(tx, tenantId);
    await seedSupportMasters(tx, tenantId);
    const unitOf = async (code: string) => (await tx.unit.findFirstOrThrow({ where: { code } })).id;
    const lab = await unitOf('LAB');
    const analyst = newId();
    await tx.user.create({
      data: { id: analyst, tenantId, username: `u.${analyst.slice(-10)}`, displayName: 'Analis' },
    });
    const p = await insertPatient(
      tx,
      new PatientCrypto(
        {
          encKeyB64: Buffer.alloc(32, 71).toString('base64'),
          hashKeyB64: Buffer.alloc(32, 73).toString('base64'),
        },
        tenantId,
      ),
      { name: 'Ny. Uji Analyzer', sex: 'female', birthDate: '1980-02-02' },
    );
    const encounterId = newId();
    await tx.encounter.create({
      data: {
        id: encounterId,
        tenantId,
        number: `RI-LIS-${newId().slice(-8)}`,
        patientId: p.id,
        encounterClass: 'IMP',
        status: 'in_progress',
        unitId: await unitOf('MELATI'),
        plannedAt: new Date(),
      },
    });
    const groupId = newId();
    await tx.orderGroup.create({
      data: {
        id: groupId,
        tenantId,
        encounterId,
        patientId: p.id,
        idempotencyKey: newId(),
        requestHash: 'b'.repeat(64),
        orderedBy: analyst,
        orderedRole: 'dokter',
      },
    });
    const labOrderId = newId();
    await tx.labOrder.create({
      data: {
        id: labOrderId,
        tenantId,
        labNo: 'L2610070101',
        encounterId,
        patientId: p.id,
        unitId: lab,
        priority: 'cito',
        status: 'diterima',
        idempotencyKey: newId(),
        acceptedBy: analyst,
      },
    });
    for (const name of ['Kalium', 'Darah lengkap']) {
      const o = await tx.orderable.findFirstOrThrow({ where: { kind: 'lab', name } });
      const sr = newId();
      await tx.serviceRequest.create({
        data: {
          id: sr,
          tenantId,
          orderGroupId: groupId,
          encounterId,
          patientId: p.id,
          orderableId: o.id,
          name: o.name,
          codeSystem: o.codeSystem,
          code: o.code,
          priority: 'cito',
        },
      });
      await tx.labOrderItem.create({ data: { id: newId(), tenantId, labOrderId, serviceRequestId: sr } });
    }
    const barcodes = { serum: 'L2610070101-01', darah_edta: 'L2610070101-02' };
    for (const [specimenType, barcode] of Object.entries(barcodes)) {
      await tx.specimen.create({ data: { id: newId(), tenantId, labOrderId, barcode, specimenType } });
    }
    const deviceId = newId();
    const now = new Date();
    await tx.registeredDevice.create({
      data: {
        id: deviceId,
        tenantId,
        kind: 'lab_analyzer',
        name: 'Analyzer uji',
        unitId: lab,
        tokenHash: createHash('sha256').update(randomBytes(32)).digest('hex'),
        createdAt: now,
        expiresAt: new Date(now.getTime() + 300 * 86_400_000),
        enrolExpiresAt: new Date(now.getTime() + 15 * 60_000),
        enrolledAt: now,
        hmacKeyEnc: `v1.${randomBytes(12).toString('base64url')}.${randomBytes(32).toString('base64url')}.${randomBytes(16).toString('base64url')}`,
      },
    });
    return { tenantId, deviceId, analyst, labOrderId, barcodes };
  });
}

function oru(barcode: string, obs: Array<[string, string, string]>): string {
  const msg = buildOru({
    controlId: `T${newId().slice(-12)}`,
    sendingApplication: 'ANALYZER',
    sendingFacility: 'LAB',
    sentAt: '20261007100000',
    specimenBarcode: barcode,
    observations: obs.map(([code, value, unit]) => ({ code, text: code, value, unit })),
  });
  const [msh, ...rest] = msg.split('\r');
  return redactHl7([msh, 'PID|1||RM9||Analyzer^Ny', ...rest].join('\r'));
}

async function message(body: string): Promise<string> {
  const id = newId();
  await inT((tx) =>
    tx.inboundEvent.create({
      data: {
        id,
        tenantId: C.tenantId,
        source: 'lis-hl7',
        idempotencyKey: `K${id}`,
        headers: {},
        rawBody: body,
        deviceId: C.deviceId,
        nextAttemptAt: new Date(Date.now() - 1000),
      },
    }),
  );
  return id;
}

const event = (id: string) => inT((tx) => tx.inboundEvent.findUniqueOrThrow({ where: { id } }));
const process = () => processor.processOnce({ tenantIds: [C.tenantId] });
const receive = (barcode: string) =>
  inT((tx) =>
    tx.specimen.update({
      where: { tenantId_barcode: { tenantId: C.tenantId, barcode } },
      data: { status: 'diterima', receivedAt: new Date(), receivedBy: C.analyst },
    }),
  );

beforeAll(async () => {
  loadTestEnvFile();
  const env = testEnv();
  db = createPrismaClient({ connectionString: env.DATABASE_URL, max: 4 });
  owner = createPrismaClient({ connectionString: testDbUrls().migrator, max: 2 });
  const mod = await testModule(env);
  processor = mod.get(InboundProcessor);
  close = () => mod.close();
  C = await setup();
}, 120_000);

afterAll(async () => {
  await close?.();
  await db?.$disconnect();
  await owner?.$disconnect();
});

describe('penangan lis-hl7', () => {
  it('jam HL7 tanpa zona = WIB', () => {
    expect(hl7Instant('20261007100000')?.toISOString()).toBe('2026-10-07T03:00:00.000Z');
    expect(hl7Instant('2026')).toBeNull();
  });

  it('spesimen belum diterima → dicoba lagi (failed) dengan galat aman', async () => {
    const id = await message(oru(C.barcodes.serum as string, [['2823-3', '4.0', 'mmol/L']]));
    await process();
    expect(await event(id)).toMatchObject({
      status: 'failed',
      attempts: 1,
      error: `Spesimen ${C.barcodes.serum} belum diterima lab`,
    });
    await inT((tx) => tx.inboundEvent.update({ where: { id }, data: { status: 'dead' } }));
  });

  it('spesimen diterima → hasil awal bersumber analyzer; kalium kritis → S09 + event worker; OBX tak dikenal dilewati', async () => {
    await receive(C.barcodes.serum as string);
    const id = await message(
      oru(C.barcodes.serum as string, [
        ['2823-3', '6.8', 'mmol/L'],
        ['2075-0', '102', 'mmol/L'],
      ]),
    );
    const s = await process();
    expect(s.processed).toBe(1);
    expect((await event(id)).status).toBe('processed');
    const results = await inT((tx) => tx.labResult.findMany({ where: { inboundEventId: id } }));
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      source: 'analyzer',
      flag: 'KRITIS',
      authorUserId: C.analyst,
      authorRole: 'analyzer',
      loinc: '2823-3',
    });
    const crit = await inT((tx) =>
      tx.criticalResult.findFirstOrThrow({ where: { labResultId: results[0]?.id } }),
    );
    expect(crit.status).toBe('terbuka');
    const ev = await inT((tx) =>
      tx.domainEvent.findFirstOrThrow({ where: { name: 'critical_result.raised' } }),
    );
    expect(ev).toMatchObject({ actorDeviceId: C.deviceId });
    expect(JSON.stringify(ev.payload)).not.toMatch(/Kalium|6\.8|Analyzer\^Ny/);
  });

  it('kiriman ulang dengan nilai sama (MSH-10 baru) tidak menggandakan; nilai beda sebelum validasi = versi baru', async () => {
    const same = await message(oru(C.barcodes.serum as string, [['2823-3', '6.8', 'mmol/L']]));
    await process();
    expect((await event(same)).status).toBe('processed');
    expect(await inT((tx) => tx.labResult.count({ where: { inboundEventId: same } }))).toBe(0);
    const other = await message(oru(C.barcodes.serum as string, [['2823-3', '6.9', 'mmol/L']]));
    await process();
    const v2 = await inT((tx) => tx.labResult.findFirstOrThrow({ where: { inboundEventId: other } }));
    expect(v2).toMatchObject({ version: 2 });
    expect(v2.correctionReason).toMatch(/Hasil ulang dari analyzer/);
  });

  it('barcode tak dikenal → dead tanpa PHI; order sudah divalidasi teknis → hasil ulang alat ditolak (dead)', async () => {
    const unknown = await message(oru('XX1234567', [['2823-3', '4.0', 'mmol/L']]));
    await process();
    const u = await event(unknown);
    expect(u).toMatchObject({ status: 'dead', error: 'Barcode spesimen XX1234567 tidak dikenal' });
    await inT((tx) =>
      tx.labOrder.update({ where: { id: C.labOrderId }, data: { status: 'validasi_teknis' } }),
    );
    const late = await message(oru(C.barcodes.serum as string, [['2823-3', '5.0', 'mmol/L']]));
    await process();
    const l = await event(late);
    expect(l.status).toBe('dead');
    expect(l.error).toMatch(/sudah divalidasi/);
    expect(l.error).not.toMatch(/Analyzer|RM9/);
  });
});
