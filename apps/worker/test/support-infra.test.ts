/**
 * Fase 4 §4.1a · Worker penunjang:
 * - pemroses pesan masuk generik: penangan + penanda `processed` atomik (ADR-0017), gagal → `failed` dengan backoff
 *   (galat tanpa PHI), galat permanen / batas percobaan → `dead`, sumber tanpa penangan tidak diklaim, isolasi tenant,
 * - job `critical.escalation`: tingkat 1 pada batas, tingkat 2 pada batas + langkah, sekali per tingkat walau berjalan
 *   ganda/serentak, penerima sesuai tingkat, notifikasi tanpa PHI, event domain tersimpan,
 * - job stok harian: ringkasan per depo ke petugas depo, sekali per hari.
 * Data fiktif.
 */
import type { TestingModule } from '@nestjs/testing';
import {
  createPrismaClient,
  ensureSystemRoles,
  insertPatient,
  type PrismaClient,
  seedClinicalMasters,
  seedHospitalStructure,
  seedSupportMasters,
  seedSupportStock,
  type TenantTx,
  withTenant,
} from '@simrs/db';
import { testDbUrls } from '@simrs/db/testing';
import { type InboundSource, newId } from '@simrs/shared';
import { PatientCrypto } from '@simrs/shared/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  INBOUND_HANDLER_REGISTRY,
  type InboundHandler,
  PermanentInboundError,
} from '../src/inbound/handlers';
import { InboundProcessor } from '../src/inbound/inbound.processor';
import { PERIODIC_JOBS } from '../src/jobs/periodic-jobs';
import {
  criticalEscalationJob,
  dueEscalationLevels,
  stockBelowMinimumJob,
  stockExpiryJob,
} from '../src/jobs/support-jobs';
import { WORKER_ENV } from '../src/config/env';
import { recordDomainEvent } from '../src/infra/domain-events';
import { freshTenant, loadTestEnvFile, tenantDb, testEnv } from './helpers';
import { Test } from '@nestjs/testing';
import { WorkerModule } from '../src/worker.module';

const SOURCE = 'uji-inbound' as InboundSource;
let db: PrismaClient;
let owner: PrismaClient;
let mod: TestingModule;
let processor: InboundProcessor;

/** Penangan uji: perilaku dari isi pesan. */
const handler: InboundHandler = {
  async handle(event, ctx) {
    await ctx.recordEvent('critical_result.escalated', {
      criticalResultId: event.id,
      encounterId: newId(),
      patientId: newId(),
      unitId: newId(),
      level: 1,
    });
    if (event.rawBody === 'GAGAL') throw new Error('Siti Rahmawati RM00123 tidak ditemukan');
    if (event.rawBody === 'PERMANEN') throw new PermanentInboundError('Format pesan tidak dikenal');
  },
};

beforeAll(async () => {
  loadTestEnvFile();
  const env = testEnv();
  db = createPrismaClient({ connectionString: env.DATABASE_URL, max: 4 });
  owner = createPrismaClient({ connectionString: testDbUrls().migrator, max: 2 });
  mod = await Test.createTestingModule({ imports: [WorkerModule] })
    .overrideProvider(WORKER_ENV)
    .useValue(env)
    .overrideProvider(INBOUND_HANDLER_REGISTRY)
    .useValue(new Map([[SOURCE, handler]]))
    .compile();
  processor = mod.get(InboundProcessor);
});

afterAll(async () => {
  await mod?.close();
  await db?.$disconnect();
  await owner?.$disconnect();
});

async function inbound(
  tenantId: string,
  body: string,
  over: { attempts?: number; nextAttemptAt?: Date; source?: string } = {},
) {
  const id = newId();
  await tenantDb(
    db,
    tenantId,
  )((tx) =>
    tx.inboundEvent.create({
      data: {
        id,
        tenantId,
        source: over.source ?? SOURCE,
        idempotencyKey: `K-${id}`,
        headers: {},
        rawBody: body,
        attempts: over.attempts ?? 0,
        nextAttemptAt: over.nextAttemptAt ?? new Date(Date.now() - 1000),
      },
    }),
  );
  return id;
}

const getEvent = (tenantId: string, id: string) =>
  tenantDb(db, tenantId)((tx) => tx.inboundEvent.findUniqueOrThrow({ where: { id } }));
const eventCount = (tenantId: string) =>
  tenantDb(
    db,
    tenantId,
  )((tx) => tx.domainEvent.count({ where: { name: 'critical_result.escalated', actorDeviceId: null } }));

describe('event yang ditulis worker (WORKER_EMITTED_EVENTS)', () => {
  it('worker hanya boleh menulis event di daftar; event lain ditolak (penangannya hanya ada di API)', async () => {
    const t = await freshTenant('Event worker');
    await expect(
      tenantDb(
        db,
        t,
      )((tx) =>
        recordDomainEvent(
          tx,
          t,
          'lab.test_voided' as never,
          {
            labOrderId: newId(),
            serviceRequestId: newId(),
            encounterId: newId(),
            patientId: newId(),
            unitId: newId(),
          } as never,
          { occurredAt: new Date() },
        ),
      ),
    ).rejects.toThrow(/tidak boleh ditulis worker/);
  });
});

describe('pemroses pesan masuk generik', () => {
  it('berhasil → processed + hasil penangan commit bersama; gagal → failed + backoff, hasil batal, galat tanpa PHI', async () => {
    const t = await freshTenant('Inbound A');
    const ok = await inbound(t, 'OK');
    const bad = await inbound(t, 'GAGAL');
    const now = new Date();
    const summary = await processor.processOnce({ tenantIds: [t], now, random: () => 0.5 });
    expect(summary).toMatchObject({ claimed: 2, processed: 1, failed: 1, dead: 0 });
    const okRow = await getEvent(t, ok);
    expect(okRow).toMatchObject({ status: 'processed', attempts: 1, error: null });
    expect(okRow.processedAt).not.toBeNull();
    const badRow = await getEvent(t, bad);
    expect(badRow).toMatchObject({ status: 'failed', attempts: 1, processedAt: null });
    expect(badRow.error).toBe('galat pemrosesan: Error');
    expect(badRow.nextAttemptAt.getTime()).toBeGreaterThan(now.getTime());
    // Satu event dari pesan berhasil; event dari pesan gagal ikut batal (atomik).
    expect(await eventCount(t)).toBe(1);
    // Belum jatuh tempo → tidak diklaim lagi.
    expect((await processor.processOnce({ tenantIds: [t], now })).claimed).toBe(0);
  });

  it('galat permanen → dead seketika; batas percobaan → dead; tampil di status', async () => {
    const t = await freshTenant('Inbound B');
    const perm = await inbound(t, 'PERMANEN');
    const last = await inbound(t, 'GAGAL', { attempts: 7 });
    const s = await processor.processOnce({ tenantIds: [t] });
    expect(s).toMatchObject({ claimed: 2, dead: 2 });
    expect(await getEvent(t, perm)).toMatchObject({
      status: 'dead',
      attempts: 1,
      error: 'Format pesan tidak dikenal',
    });
    expect(await getEvent(t, last)).toMatchObject({ status: 'dead', attempts: 8 });
  });

  it('sumber tanpa penangan tidak diklaim; pesan tenant lain tidak tersentuh', async () => {
    const t = await freshTenant('Inbound C');
    const other = await freshTenant('Inbound D');
    const orphan = await inbound(t, 'OK', { source: 'tanpa-penangan' });
    const foreign = await inbound(other, 'OK');
    await processor.processOnce({ tenantIds: [t] });
    expect((await getEvent(t, orphan)).status).toBe('received');
    expect((await getEvent(other, foreign)).status).toBe('received');
  });

  it('klaim kedaluwarsa (worker mati di tengah jalan) diambil ulang', async () => {
    const t = await freshTenant('Inbound E');
    const id = await inbound(t, 'OK');
    await tenantDb(
      db,
      t,
    )((tx) =>
      tx.inboundEvent.update({
        where: { id },
        data: { status: 'processing', nextAttemptAt: new Date(Date.now() - 1) },
      }),
    );
    await processor.processOnce({ tenantIds: [t] });
    expect((await getEvent(t, id)).status).toBe('processed');
  });
});

// ---------------------------------------------------------------------------------------------------------------

interface SupportTenant {
  id: string;
  lab: string;
  dpjp: string;
  analyst: string;
  analystRad: string;
  manager: string;
  pharmacist: string;
  encounterId: string;
  patientId: string;
}

async function supportTenant(): Promise<SupportTenant> {
  const id = await freshTenant('Penunjang');
  await withTenant(owner, id, async (tx) => {
    await ensureSystemRoles(tx, id);
    await seedHospitalStructure(tx, id);
  });
  return withTenant(db, id, async (tx) => {
    await seedClinicalMasters(tx, id);
    await seedSupportMasters(tx, id);
    const unitOf = async (code: string) => (await tx.unit.findFirstOrThrow({ where: { code } })).id;
    const user = async (name: string, role: string, unitCode: string | null) => {
      const u = newId();
      await tx.user.create({
        data: { id: u, tenantId: id, username: `u.${u.slice(-10)}`, displayName: name },
      });
      const r = await tx.role.findFirstOrThrow({ where: { code: role } });
      await tx.staffAssignment.create({
        data: {
          id: newId(),
          tenantId: id,
          userId: u,
          roleId: r.id,
          unitId: unitCode ? await unitOf(unitCode) : null,
        },
      });
      return u;
    };
    const pharmacist = await user('apt. Uji', 'apoteker', 'FARMASI');
    await seedSupportStock(tx, id, pharmacist);
    const p = await insertPatient(
      tx,
      new PatientCrypto(
        {
          encKeyB64: Buffer.alloc(32, 71).toString('base64'),
          hashKeyB64: Buffer.alloc(32, 73).toString('base64'),
        },
        id,
      ),
      { name: 'Tn. Uji Eskalasi', sex: 'male', birthDate: '1970-01-01' },
    );
    const enc = await tx.encounter.create({
      data: {
        id: newId(),
        tenantId: id,
        number: `RI-ES-${newId().slice(-8)}`,
        patientId: p.id,
        encounterClass: 'IMP',
        status: 'in_progress',
        unitId: await unitOf('MELATI'),
        plannedAt: new Date(),
      },
    });
    const dpjp = await user('dr. DPJP Uji', 'dokter', 'MELATI');
    await tx.encounterParticipant.create({
      data: { id: newId(), tenantId: id, encounterId: enc.id, userId: dpjp, role: 'dpjp_utama' },
    });
    return {
      id,
      lab: await unitOf('LAB'),
      dpjp,
      analyst: await user('Analis Uji', 'analis_lab', 'LAB'),
      analystRad: await user('Analis RAD', 'analis_lab', 'RAD'),
      manager: await user('Manajer Mutu', 'manajemen', null),
      pharmacist,
      encounterId: enc.id,
      patientId: p.id,
    };
  });
}

async function openCritical(s: SupportTenant): Promise<{ id: string; raisedAt: Date }> {
  return withTenant(db, s.id, async (tx: TenantTx) => {
    const order = await tx.labOrder.create({
      data: {
        id: newId(),
        tenantId: s.id,
        labNo: `L261007${String(Math.floor(Math.random() * 9999)).padStart(4, '0')}`,
        encounterId: s.encounterId,
        patientId: s.patientId,
        unitId: s.lab,
        priority: 'cito',
        status: 'hasil',
        idempotencyKey: newId(),
        acceptedBy: s.analyst,
      },
    });
    const def = await tx.labTestDefinition.findFirstOrThrow({ where: { code: 'K' } });
    const rid = newId();
    await tx.labResult.create({
      data: {
        id: rid,
        rootId: rid,
        tenantId: s.id,
        patientId: s.patientId,
        encounterId: s.encounterId,
        occurredAt: new Date(),
        authorUserId: s.analyst,
        authorRole: 'analis_lab',
        labOrderId: order.id,
        testDefinitionId: def.id,
        loinc: def.loinc,
        name: def.name,
        valueNumeric: 6.8,
        unit: 'mmol/L',
        decimals: 1,
        flag: 'KRITIS',
        source: 'manual',
      },
    });
    const c = await tx.criticalResult.create({
      data: {
        id: newId(),
        tenantId: s.id,
        source: 'lab',
        labResultId: rid,
        encounterId: s.encounterId,
        patientId: s.patientId,
        unitId: s.lab,
        analyte: 'Kalium',
        valueText: '6,8 mmol/L',
        limitMinutes: 30,
      },
    });
    return { id: c.id, raisedAt: c.raisedAt };
  });
}

describe('job eskalasi nilai kritis', () => {
  let s: SupportTenant;
  beforeAll(async () => {
    s = await supportTenant();
  }, 120_000);

  it('terdaftar tiap menit (modul S09); tingkat jatuh tempo dari batas + langkah', () => {
    expect(PERIODIC_JOBS.get('critical.escalation')).toBe(criticalEscalationJob);
    expect(criticalEscalationJob).toMatchObject({ schedule: { everyMs: 60_000 }, module: 'S09' });
    expect(dueEscalationLevels(29 * 60_000, 30, 30)).toEqual([]);
    expect(dueEscalationLevels(30 * 60_000, 30, 30)).toEqual([1]);
    expect(dueEscalationLevels(60 * 60_000, 30, 30)).toEqual([1, 2]);
  });

  it('tingkat 1 ke DPJP + petugas unit pelapor, tingkat 2 ke pemegang review; sekali per tingkat walau serentak', async () => {
    const c = await openCritical(s);
    const tx = tenantDb(db, s.id);
    const at = (min: number) => new Date(c.raisedAt.getTime() + min * 60_000);
    await criticalEscalationJob.run({ tenantId: s.id, now: at(10), tx });
    expect(await tx((t) => t.criticalResultEscalation.count({ where: { criticalResultId: c.id } }))).toBe(0);

    await Promise.all([
      criticalEscalationJob.run({ tenantId: s.id, now: at(31), tx }),
      criticalEscalationJob.run({ tenantId: s.id, now: at(31), tx }),
    ]);
    const lvl1 = await tx((t) => t.criticalResultEscalation.findMany({ where: { criticalResultId: c.id } }));
    expect(lvl1.map((e) => e.level)).toEqual([1]);
    expect(new Set(lvl1[0]?.notifiedUserIds)).toEqual(new Set([s.dpjp, s.analyst]));

    await criticalEscalationJob.run({ tenantId: s.id, now: at(61), tx });
    await criticalEscalationJob.run({ tenantId: s.id, now: at(62), tx });
    const all = await tx((t) =>
      t.criticalResultEscalation.findMany({ where: { criticalResultId: c.id }, orderBy: { level: 'asc' } }),
    );
    expect(all.map((e) => e.level)).toEqual([1, 2]);
    expect(all[1]?.notifiedUserIds).toEqual([s.manager]);

    const notes = await tx((t) =>
      t.notification.findMany({
        where: { kind: 'critical_result.escalated', link: `/penunjang/hasil-kritis?id=${c.id}` },
      }),
    );
    expect(notes.map((n) => n.recipientUserId).sort()).toEqual([s.analyst, s.dpjp, s.manager].sort());
    expect(notes.some((n) => n.recipientUserId === s.analystRad)).toBe(false);
    expect(JSON.stringify(notes)).not.toMatch(/Kalium|6,8|Uji Eskalasi/);
    const events = await tx((t) =>
      t.domainEvent.findMany({ where: { name: 'critical_result.escalated' }, select: { payload: true } }),
    );
    expect(
      events.filter((e) => (e.payload as { criticalResultId: string }).criticalResultId === c.id).length,
    ).toBe(2);
  });

  it('nilai kritis yang sudah dilaporkan tidak dieskalasi', async () => {
    const c = await openCritical(s);
    const tx = tenantDb(db, s.id);
    await tx((t) =>
      t.criticalResultReport.create({
        data: {
          id: newId(),
          tenantId: s.id,
          criticalResultId: c.id,
          recipientUserId: s.dpjp,
          channel: 'telepon',
          readBackText: 'Kalium enam koma delapan',
          readBackConfirmed: true,
          reportedBy: s.analyst,
        },
      }),
    );
    await criticalEscalationJob.run({
      tenantId: s.id,
      now: new Date(c.raisedAt.getTime() + 90 * 60_000),
      tx,
    });
    expect(await tx((t) => t.criticalResultEscalation.count({ where: { criticalResultId: c.id } }))).toBe(0);
  });

  it('job stok harian: ringkasan batch dekat/lewat ED dan stok di bawah minimum ke petugas depo, sekali sehari', async () => {
    const tx = tenantDb(db, s.id);
    const now = new Date();
    for (let i = 0; i < 2; i++) {
      await stockExpiryJob.run({ tenantId: s.id, now, tx });
      await stockBelowMinimumJob.run({ tenantId: s.id, now, tx });
    }
    const expiry = await tx((t) =>
      t.notification.findMany({ where: { kind: 'stock.expiry', recipientUserId: s.pharmacist } }),
    );
    // Gudang + depo rawat inap (unit Farmasi) memuat batch kedaluwarsa dan dekat ED dari seed.
    expect(expiry).toHaveLength(2);
    expect(expiry.every((n) => /1 batch sudah kedaluwarsa/.test(n.body))).toBe(true);
    const below = await tx((t) =>
      t.notification.findMany({ where: { kind: 'stock.below_minimum', recipientUserId: s.pharmacist } }),
    );
    expect(below.length).toBeGreaterThanOrEqual(1);
    expect(below.map((n) => n.link)).toEqual([...new Set(below.map((n) => n.link))]);
    // Petugas lab tidak menerima peringatan depo.
    expect(
      await tx((t) =>
        t.notification.count({ where: { kind: { startsWith: 'stock.' }, recipientUserId: s.analyst } }),
      ),
    ).toBe(0);
  });
});
