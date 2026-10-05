/**
 * F01 · Worker jadwal (fase 2 potongan 2) terhadap mock BPJS + WhatsApp SUNGGUHAN (`apps/mock`, port acak):
 * job pembangkit sesi (idempoten), kirim templat ke HFIS (`bpjs.hfis.update`, revisi lama dilewati), tarik HFIS
 * (`bpjs.hfis.pull` → snapshot; hari tanpa jadwal = snapshot kosong), job tarik harian, dan WhatsApp perubahan jadwal
 * ke pasien tanpa isi klinis. Data fiktif (seed 0b, kode HFIS 99001–99006).
 */
import 'reflect-metadata';
import type { AddressInfo } from 'node:net';
import type { TestingModule } from '@nestjs/testing';
import {
  addIsoDays,
  createPrismaClient,
  dbDateFromIso,
  enqueueOutbox,
  insertPatient,
  type PrismaClient,
  reserveQuota,
  seedFrontOffice,
  seedHospitalStructure,
  type TenantTx,
  withTenant,
} from '@simrs/db';
import { testDbUrls } from '@simrs/db/testing';
import { hfisHariOf, hfisPullSnapshotSchema, isoDateJakarta, newId, outboxKey } from '@simrs/shared';
import { PatientCrypto } from '@simrs/shared/node';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../mock/src/config';
import { buildServer } from '../../mock/src/server';
import { MockState } from '../../mock/src/state';
import type { WorkerEnv } from '../src/config/env';
import { PeriodicScheduler } from '../src/jobs/periodic.scheduler';
import { OutboxDispatcher } from '../src/outbox/outbox.dispatcher';
import { loadTestEnvFile, testEnv, testModule } from './helpers';

let mock: ReturnType<typeof buildServer>;
let mockState: MockState;
let env: WorkerEnv;
let ref: TestingModule;
let db: PrismaClient;
let dispatcher: OutboxDispatcher;
let scheduler: PeriodicScheduler;
let T: string;

const run = <R>(fn: (tx: TenantTx) => Promise<R>) => withTenant(db, T, fn);
const dispatch = () => dispatcher.dispatchOnce({ tenantIds: [T], now: new Date(Date.now() + 1000) });
const today = isoDateJakarta(new Date());

async function freshFrontOfficeTenant(): Promise<string> {
  const owner = createPrismaClient({ connectionString: testDbUrls().migrator, max: 1 });
  const id = newId();
  try {
    await withTenant(owner, id, async (tx) => {
      await tx.tenant.create({
        data: { id, code: `WJ${id.slice(-8).toUpperCase()}`, name: 'RS Fiktif Uji Jadwal Worker' },
      });
      await seedHospitalStructure(tx, id);
    });
    await seedFrontOffice(owner, id);
  } finally {
    await owner.$disconnect();
  }
  return id;
}

const ids = async () =>
  run(async (tx) => ({
    bagus: (await tx.practitioner.findFirstOrThrow({ where: { name: { startsWith: 'dr. Bagus' } } })).id,
    jt: (await tx.queueService.findFirstOrThrow({ where: { code: 'JT' } })).id,
  }));

beforeAll(async () => {
  loadTestEnvFile();
  mockState = new MockState();
  mock = buildServer({ ...loadConfig({}), port: 0 }, mockState);
  await mock.listen({ port: 0, host: '127.0.0.1' });
  const port = (mock.server.address() as AddressInfo).port;
  env = testEnv({
    MOCK_BASE_URL: `http://127.0.0.1:${port}`,
    BPJS_BASE_URL: `http://127.0.0.1:${port}/bpjs`,
    BPJS_CONS_ID: '10000',
    BPJS_SECRET_KEY: 'mock-secret',
    BPJS_USER_KEY: 'mock-user-key',
  });
  ref = await testModule(env);
  dispatcher = ref.get(OutboxDispatcher);
  scheduler = ref.get(PeriodicScheduler);
  db = createPrismaClient({ connectionString: env.DATABASE_URL, max: 2 });
  T = await freshFrontOfficeTenant();
});

afterAll(async () => {
  await ref?.close();
  await db?.$disconnect();
  await mock?.close();
});

beforeEach(() => mockState.reset());

describe('job pembangkit sesi', () => {
  it('membangkitkan sesi 30 hari dari templat; diulang tidak menggandakan', async () => {
    const summary = await scheduler.runJob('scheduling.generate-sessions', { tenantIds: [T] });
    expect(summary).toMatchObject({ ok: 1, failed: 0 });
    const n = await run((tx) => tx.scheduleSession.count());
    expect(n).toBeGreaterThan(30);
    const last = await run((tx) => tx.scheduleSession.findFirst({ orderBy: { sessionDate: 'desc' } }));
    expect(last?.sessionDate.toISOString().slice(0, 10) <= addIsoDays(today, 29)).toBe(true);
    await scheduler.runJob('scheduling.generate-sessions', { tenantIds: [T] });
    expect(await run((tx) => tx.scheduleSession.count())).toBe(n);
  });
});

describe('HFIS ↔ mock', () => {
  it('bpjs.hfis.update mengirim templat mingguan aktif; revisi lama dilewati; snapshot push tersimpan', async () => {
    const { bagus, jt } = await ids();
    const key = (rev: number) => outboxKey('bpjs.hfis.update', `${bagus}:${jt}`, rev);
    const [r1, r2] = await run(async (tx) => [
      await enqueueOutbox(tx, T, {
        target: 'bpjs',
        operation: 'bpjs.hfis.update',
        idempotencyKey: key(1),
        payload: { practitionerId: bagus, serviceId: jt, revision: 1 },
      }),
      await enqueueOutbox(tx, T, {
        target: 'bpjs',
        operation: 'bpjs.hfis.update',
        idempotencyKey: key(2),
        payload: { practitionerId: bagus, serviceId: jt, revision: 2 },
      }),
    ]);
    await dispatch();
    const [m1, m2] = await run((tx) =>
      Promise.all([r1, r2].map((r) => tx.outboxMessage.findUniqueOrThrow({ where: { id: r?.id } }))),
    );
    expect([m1?.status, m2?.status]).toEqual(['sent', 'sent']);
    const skipped = await run((tx) =>
      tx.deliveryAttempt.findFirstOrThrow({ where: { outboxMessageId: m1?.id } }),
    );
    expect(skipped.responseExcerpt).toBe('dilewati: revisi 2 sudah diantrekan');
    expect(m2?.status).toBe('sent');
    expect(mockState.bpjs.hfisUpdates).toHaveLength(1);
    expect(mockState.bpjs.hfisUpdates[0]).toMatchObject({ kodedokter: 99003, kodepoli: 'JAN' });
    expect(mockState.bpjs.hfisUpdates[0]?.jadwal).toHaveLength(5);
    const push = await run((tx) => tx.hfisScheduleSnapshot.findMany({ where: { direction: 'push' } }));
    expect(push).toHaveLength(1);
    expect(push[0]?.payload).toMatchObject({ kodedokter: 99003, kodepoli: 'JAN', revision: 2 });
  });

  it('bpjs.hfis.pull: hari praktik → snapshot berisi dokter; Minggu (tanpa jadwal) → snapshot kosong', async () => {
    const { jt } = await ids();
    let rabu = addIsoDays(today, 1);
    while (hfisHariOf(rabu) !== 3) rabu = addIsoDays(rabu, 1);
    let minggu = rabu;
    while (hfisHariOf(minggu) !== 7) minggu = addIsoDays(minggu, 1);
    await run(async (tx) => {
      for (const date of [rabu, minggu]) {
        await enqueueOutbox(tx, T, {
          target: 'bpjs',
          operation: 'bpjs.hfis.pull',
          idempotencyKey: outboxKey('bpjs.hfis.pull', `${jt}:${date}`, 1),
          payload: { serviceId: jt, date, run: 1 },
        });
      }
    });
    await dispatch();
    const snaps = await run((tx) =>
      tx.hfisScheduleSnapshot.findMany({
        where: { direction: 'pull', periodStart: { in: [dbDateFromIso(rabu), dbDateFromIso(minggu)] } },
      }),
    );
    const byDate = new Map(
      snaps.map((s) => [s.periodStart.toISOString().slice(0, 10), hfisPullSnapshotSchema.parse(s.payload)]),
    );
    // Perbedaan yang disemai mock: dr. Bagus tetap praktik Rabu 09:00–12:00 di HFIS.
    expect(byDate.get(rabu)?.jadwal).toContainEqual(
      expect.objectContaining({
        kodedokter: 99003,
        jadwal: '09:00 - 12:00',
        kapasitaspasien: 20,
        libur: false,
      }),
    );
    expect(byDate.get(minggu)?.jadwal).toEqual([]);
  });
});

describe('WhatsApp perubahan jadwal', () => {
  it('terkirim ke no. HP pasien tanpa nama poli/dokter; booking batal dilewati', async () => {
    const { bagus, jt } = await ids();
    const crypto = new PatientCrypto(env.fieldKeys, T);
    const { appointmentId, bookingCode } = await run(async (tx) => {
      const patient = await insertPatient(tx, crypto, {
        name: 'Pasien WA Fiktif',
        sex: 'female',
        birthDate: '1980-01-01',
        phone: '6281200009876',
      });
      const session = await tx.scheduleSession.findFirstOrThrow({
        where: { practitionerId: bagus, serviceId: jt, sessionDate: { gt: dbDateFromIso(today) } },
        orderBy: { sessionDate: 'asc' },
      });
      await reserveQuota(tx, session.id, 'non_jkn');
      const id = newId();
      const code = String(Math.floor(1e9 + Math.random() * 8.9e9));
      await tx.appointment.create({
        data: {
          id,
          tenantId: T,
          bookingCode: code,
          patientId: patient.id,
          sessionId: session.id,
          practitionerId: bagus,
          serviceId: jt,
          appointmentDate: session.sessionDate,
          quotaBucket: 'non_jkn',
          channel: 'loket',
        },
      });
      await enqueueOutbox(tx, T, {
        target: 'whatsapp',
        operation: 'patient.whatsapp.schedule_changed',
        idempotencyKey: outboxKey('patient.whatsapp.schedule_changed', id, 1),
        payload: { appointmentId: id },
      });
      return { appointmentId: id, bookingCode: code };
    });
    await dispatch();
    expect(mockState.messages).toHaveLength(1);
    const wa = mockState.messages[0];
    expect(wa).toMatchObject({ channel: 'whatsapp', to: '6281200009876' });
    expect(wa?.text).toContain(`Kode booking: ${bookingCode}`);
    expect(wa?.text).toContain('09.00');
    expect(wa?.text).not.toMatch(/Jantung|Bagus/);

    await run(async (tx) => {
      await tx.appointment.update({
        where: { id: appointmentId },
        data: { status: 'cancelled', cancelledAt: new Date(), cancelReason: 'Uji batal' },
      });
      await enqueueOutbox(tx, T, {
        target: 'whatsapp',
        operation: 'patient.whatsapp.schedule_changed',
        idempotencyKey: outboxKey('patient.whatsapp.schedule_changed', appointmentId, 2),
        payload: { appointmentId },
      });
    });
    await dispatch();
    // Booking batal: dilewati, tidak ada pesan kedua.
    expect(mockState.messages).toHaveLength(1);
  });
});

// Terakhir: 56 pesan tarik yang diantrekan tidak dikirim di tes ini (tidak mengganggu tes lain).
describe('job tarik HFIS', () => {
  it('job scheduling.hfis-pull mengantrekan 4 poli × 14 hari', async () => {
    const before = await run((tx) => tx.outboxMessage.count({ where: { operation: 'bpjs.hfis.pull' } }));
    await scheduler.runJob('scheduling.hfis-pull', { tenantIds: [T], now: new Date() });
    const after = await run((tx) => tx.outboxMessage.count({ where: { operation: 'bpjs.hfis.pull' } }));
    expect(after - before).toBe(56);
  });
});
