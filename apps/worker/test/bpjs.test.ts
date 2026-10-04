/**
 * Konektor BPJS outbox (potongan 1a) terhadap mock BPJS SUNGGUHAN (`apps/mock`, port acak): header bertanda tangan
 * diterima mock, respons terenkripsi didekripsi, galat bisnis di HTTP 200 menjadi hasil domain "ditolak" (pesan
 * terkirim, bukan retry/DLQ), gangguan dicoba ulang, kredensial salah langsung DLQ. Data mock fiktif.
 */
import 'reflect-metadata';
import type { AddressInfo } from 'node:net';
import type { TestingModule } from '@nestjs/testing';
import {
  createPrismaClient,
  enqueueOutbox,
  type OutboxMessage,
  type PrismaClient,
  type TenantTx,
} from '@simrs/db';
import { newId } from '@simrs/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { loadConfig } from '../../mock/src/config';
import { buildServer } from '../../mock/src/server';
import { MockState } from '../../mock/src/state';
import type { WorkerEnv } from '../src/config/env';
import { BpjsConnector } from '../src/outbox/bpjs-connector';
import { defineBpjsOperation, type OutboxOperation } from '../src/outbox/operations';
import { OutboxDispatcher } from '../src/outbox/outbox.dispatcher';
import { freshTenant, loadTestEnvFile, tenantDb, testEnv, testModule } from './helpers';

const NIK = '9999010101900001'; // fiktif (pola mock)
const NIK_TIDAK_AKTIF = '9999010101900000'; // berakhiran 0000: peserta tidak aktif di mock

let mock: ReturnType<typeof buildServer>;
let mockState: MockState;
let env: WorkerEnv;
let ref: TestingModule;
let db: PrismaClient;
let dispatcher: OutboxDispatcher;
let T: string;

async function mark(tx: TenantTx, msg: OutboxMessage, details: Record<string, unknown>) {
  await tx.auditEvent.create({
    data: {
      id: newId(),
      tenantId: msg.tenantId,
      actorRole: 'system',
      resourceType: 'bpjs_uji',
      resourceId: msg.id,
      action: 'update',
      details: details as object,
    },
  });
}

const pesertaSchema = z.object({
  peserta: z.object({ noKartu: z.string(), statusPeserta: z.object({ keterangan: z.string() }) }),
});

const updatewaktu = (msg: { payload: unknown }) => ({
  service: 'antrean' as const,
  method: 'POST' as const,
  path: '/antrean/updatewaktu',
  body: { kodebooking: 'BK-UJI-1', taskid: (msg.payload as { taskid: number }).taskid, waktu: 1791158400000 },
});

const OPS: Record<string, OutboxOperation> = {
  'test.bpjs.peserta': defineBpjsOperation({
    prepare: (msg) => ({
      service: 'vclaim',
      method: 'GET',
      path: `/Peserta/nik/${(msg.payload as { nik: string }).nik}/tglSEP/2026-10-05`,
    }),
    response: pesertaSchema,
    async onAccepted(tx, msg, res) {
      await mark(tx, msg, { outcome: 'accepted', status: res.peserta.statusPeserta.keterangan });
    },
  }),
  'test.bpjs.task': defineBpjsOperation({
    prepare: updatewaktu,
    async onAccepted(tx, msg) {
      await mark(tx, msg, { outcome: 'accepted' });
    },
    async onRejected(tx, msg, rejection) {
      await mark(tx, msg, { outcome: 'rejected', code: rejection.code, bpjsCode: rejection.bpjsCode });
    },
  }),
  /** Tanpa `onRejected`: penolakan tidak boleh hilang diam-diam → DLQ + onDead. */
  'test.bpjs.task-tanpa-tolak': defineBpjsOperation({
    prepare: updatewaktu,
    async onDead(tx, msg) {
      await mark(tx, msg, { outcome: 'dead', lastError: msg.lastError });
    },
  }),
};

beforeAll(async () => {
  loadTestEnvFile();
  mockState = new MockState();
  mock = buildServer({ ...loadConfig({}), port: 0 }, mockState);
  await mock.listen({ port: 0, host: '127.0.0.1' });
  const port = (mock.server.address() as AddressInfo).port;
  env = testEnv({
    BPJS_BASE_URL: `http://127.0.0.1:${port}/bpjs`,
    BPJS_CONS_ID: '10000',
    BPJS_SECRET_KEY: 'mock-secret',
    BPJS_USER_KEY: 'mock-user-key',
  });
  ref = await testModule(env, { operations: OPS });
  dispatcher = ref.get(OutboxDispatcher);
  db = createPrismaClient({ connectionString: env.DATABASE_URL, max: 2 });
  T = await freshTenant('Uji BPJS');
});

afterAll(async () => {
  await ref?.close();
  await db?.$disconnect();
  await mock?.close();
});

beforeEach(() => mockState.reset());

const run = <R>(fn: (tx: TenantTx) => Promise<R>) => tenantDb(db, T)(fn);
const enqueue = (operation: string, payload: Record<string, unknown>) =>
  run((tx) =>
    enqueueOutbox(tx, T, { target: 'bpjs', operation, idempotencyKey: `bpjs-${newId()}`, payload }),
  );
const message = (id: string) => run((tx) => tx.outboxMessage.findUniqueOrThrow({ where: { id } }));
const lastAttempt = (id: string) =>
  run((tx) =>
    tx.deliveryAttempt.findFirstOrThrow({ where: { outboxMessageId: id }, orderBy: { attemptNo: 'desc' } }),
  );
const marks = (id: string) =>
  run((tx) => tx.auditEvent.findMany({ where: { resourceType: 'bpjs_uji', resourceId: id } }));
const dispatch = () => dispatcher.dispatchOnce({ tenantIds: [T], now: new Date(Date.now() + 1000) });

describe('konektor BPJS ↔ mock', () => {
  it('VClaim: tanda tangan diterima, respons terenkripsi didekripsi dan divalidasi, potongan respons tidak disimpan', async () => {
    expect(mockState.bpjsEncryption).toBe(true);
    const aktif = await enqueue('test.bpjs.peserta', { nik: NIK });
    const tidakAktif = await enqueue('test.bpjs.peserta', { nik: NIK_TIDAK_AKTIF });
    const s = await dispatch();
    expect(s.sent).toBe(2);
    expect((await marks(aktif.id)).map((m) => m.details)).toEqual([{ outcome: 'accepted', status: 'AKTIF' }]);
    expect((await marks(tidakAktif.id)).map((m) => m.details)).toEqual([
      { outcome: 'accepted', status: 'TIDAK AKTIF' },
    ]);
    const attempt = await lastAttempt(aktif.id);
    expect(attempt).toMatchObject({ outcome: 'sent', statusCode: 200, responseExcerpt: 'BPJS 200' });
    expect(mockState.log.some((l) => l.system === 'bpjs' && l.status === 401)).toBe(false);
  });

  it('respons tanpa enkripsi (flag mock dimatikan) tetap terbaca', async () => {
    mockState.bpjsEncryption = false;
    const msg = await enqueue('test.bpjs.peserta', { nik: NIK });
    await dispatch();
    expect((await message(msg.id)).status).toBe('sent');
    expect((await marks(msg.id)).map((m) => m.details)).toEqual([{ outcome: 'accepted', status: 'AKTIF' }]);
  });

  it('Antrean: sukses (metadata angka 200) → onAccepted', async () => {
    const msg = await enqueue('test.bpjs.task', { taskid: 3 });
    await dispatch();
    expect(await message(msg.id)).toMatchObject({ status: 'sent', attempts: 1 });
    expect((await marks(msg.id)).map((m) => m.details)).toEqual([{ outcome: 'accepted' }]);
  });

  it('galat bisnis di HTTP 200 → TERKIRIM sebagai hasil domain "ditolak" (bukan retry/DLQ)', async () => {
    const msg = await enqueue('test.bpjs.task', { taskid: 8 });
    const s = await dispatch();
    expect(s).toMatchObject({ sent: 1, failed: 0, dead: 0 });
    expect(await message(msg.id)).toMatchObject({ status: 'sent', attempts: 1, lastError: null });
    expect((await marks(msg.id)).map((m) => m.details)).toEqual([
      { outcome: 'rejected', code: 'BPJS_VALIDATION', bpjsCode: '201' },
    ]);
    // Operasi BPJS sensitif secara bawaan: pesan asli BPJS tidak masuk jejak pengiriman, hanya kodenya.
    expect((await lastAttempt(msg.id)).responseExcerpt).toBe('ditolak BPJS 201 → BPJS_VALIDATION');
  });

  it('penolakan tanpa onRejected → DLQ (tidak hilang diam-diam) + onDead', async () => {
    const msg = await enqueue('test.bpjs.task-tanpa-tolak', { taskid: 8 });
    await dispatch();
    expect(await message(msg.id)).toMatchObject({
      status: 'dead',
      lastError: 'Ditolak BPJS 201: BPJS_VALIDATION',
    });
    expect((await marks(msg.id)).map((m) => m.details)).toEqual([
      { outcome: 'dead', lastError: 'Ditolak BPJS 201: BPJS_VALIDATION' },
    ]);
  });

  it('BPJS gangguan (mock gagal 503) → BPJS_UNAVAILABLE, dicoba ulang (kebijakan hari layanan), bukan DLQ', async () => {
    mockState.scenarios.set('bpjs', { mode: 'gagal', latencyMs: 0, failStatus: 503 });
    const msg = await enqueue('test.bpjs.task', { taskid: 3 });
    await dispatch();
    const m = await message(msg.id);
    expect(m).toMatchObject({ status: 'failed', attempts: 1, lastError: 'BPJS_UNAVAILABLE: HTTP 503' });
    expect(await marks(msg.id)).toEqual([]);

    mockState.scenarios.set('bpjs', { mode: 'normal', latencyMs: 0, failStatus: 503 });
    await dispatcher.dispatchOnce({ tenantIds: [T], now: new Date(m.nextAttemptAt.getTime() + 1) });
    expect(await message(msg.id)).toMatchObject({ status: 'sent', attempts: 2 });
  });

  it('kredensial salah → mock 401 → BPJS_AUTH, galat permanen', async () => {
    const wrong = new BpjsConnector({ ...env, BPJS_SECRET_KEY: 'bukan-rahasia-mock' });
    const res = await wrong.send(
      { target: 'bpjs', operation: 'x', idempotencyKey: 'k', payload: {} },
      { service: 'vclaim', method: 'GET', path: `/Peserta/nik/${NIK}/tglSEP/2026-10-05` },
    );
    expect(res).toMatchObject({ ok: false, permanent: true, statusCode: 401, error: 'BPJS_AUTH: HTTP 401' });
  });

  it('produksi tanpa kredensial BPJS → galat permanen yang jelas (tidak jatuh ke nilai mock)', async () => {
    const unconfigured = new BpjsConnector({
      ...env,
      APP_ENV: 'production',
      BPJS_BASE_URL: undefined,
      BPJS_CONS_ID: undefined,
      BPJS_SECRET_KEY: undefined,
      BPJS_USER_KEY: undefined,
    });
    const res = await unconfigured.send(
      { target: 'bpjs', operation: 'x', idempotencyKey: 'k', payload: {} },
      { service: 'vclaim', method: 'GET', path: '/x' },
    );
    expect(res).toMatchObject({
      ok: false,
      permanent: true,
      error: 'BPJS_AUTH: kredensial BPJS belum dikonfigurasi',
    });
  });
});
