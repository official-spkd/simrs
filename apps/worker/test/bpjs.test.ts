/**
 * Konektor BPJS outbox (potongan 1a) terhadap mock BPJS SUNGGUHAN (`apps/mock`, port acak): header bertanda tangan
 * dan `user_key` diterima mock, respons terenkripsi didekripsi dan divalidasi dengan skema kontrak bersama
 * (`@simrs/shared` integrations/bpjs), galat bisnis di HTTP 200 menjadi hasil domain "ditolak" (pesan terkirim,
 * bukan retry/DLQ), gangguan dan timeout dicoba ulang, kredensial salah langsung DLQ. Data mock fiktif.
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
import {
  ANTREAN_ENDPOINTS,
  antreanRefPoliResponseSchema,
  bpjsPath,
  newId,
  VCLAIM_ENDPOINTS,
  VCLAIM_PESERTA_AKTIF,
  vclaimPesertaResponseSchema,
} from '@simrs/shared';
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

const NIK = '9999010101900001'; // fiktif (pola mock 9999…)
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

const updatewaktu = (msg: { payload: unknown }) => ({
  service: 'antrean' as const,
  ...ANTREAN_ENDPOINTS.updateWaktu,
  body: {
    kodebooking: (msg.payload as { kodebooking: string }).kodebooking,
    taskid: 3,
    waktu: Date.now() - 60_000,
  },
});

const OPS: Record<string, OutboxOperation> = {
  'test.bpjs.peserta': defineBpjsOperation({
    prepare: (msg) => ({
      service: 'vclaim',
      method: VCLAIM_ENDPOINTS.pesertaByNik.method,
      path: bpjsPath(VCLAIM_ENDPOINTS.pesertaByNik.path, {
        nik: (msg.payload as { nik: string }).nik,
        tglSEP: '2026-10-05',
      }),
    }),
    response: vclaimPesertaResponseSchema,
    async onAccepted(tx, msg, res) {
      await mark(tx, msg, {
        outcome: 'accepted',
        aktif: res.peserta.statusPeserta.kode === VCLAIM_PESERTA_AKTIF,
      });
    },
  }),
  /** Skema yang sengaja tidak cocok dengan isi respons: pelanggaran kontrak = DLQ. */
  'test.bpjs.kontrak-salah': defineBpjsOperation({
    prepare: () => ({ service: 'antrean', ...ANTREAN_ENDPOINTS.refPoli }),
    response: z.array(z.object({ kodeTidakAda: z.string() })),
  }),
  'test.bpjs.ref-poli': defineBpjsOperation({
    prepare: () => ({ service: 'antrean', ...ANTREAN_ENDPOINTS.refPoli }),
    response: antreanRefPoliResponseSchema,
    async onAccepted(tx, msg, poli) {
      await mark(tx, msg, { outcome: 'accepted', poli: poli.length > 0 });
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
    OUTBOX_HTTP_TIMEOUT_MS: '1000',
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

const scenario = (mode: 'normal' | 'gagal' | 'timeout') =>
  mockState.scenarios.set('bpjs', { ...mockState.scenario('bpjs'), mode, failStatus: 503, timeoutMs: 3000 });
const run = <R>(fn: (tx: TenantTx) => Promise<R>) => tenantDb(db, T)(fn);
const enqueue = (operation: string, payload: Record<string, unknown> = {}) =>
  run((tx) =>
    enqueueOutbox(tx, T, { target: 'bpjs', operation, idempotencyKey: `bpjs-${newId()}`, payload }),
  );
const message = (id: string) => run((tx) => tx.outboxMessage.findUniqueOrThrow({ where: { id } }));
const lastAttempt = (id: string) =>
  run((tx) =>
    tx.deliveryAttempt.findFirstOrThrow({ where: { outboxMessageId: id }, orderBy: { attemptNo: 'desc' } }),
  );
const marks = async (id: string) =>
  (await run((tx) => tx.auditEvent.findMany({ where: { resourceType: 'bpjs_uji', resourceId: id } }))).map(
    (m) => m.details,
  );
const dispatch = (now = new Date(Date.now() + 1000)) => dispatcher.dispatchOnce({ tenantIds: [T], now });

describe('konektor BPJS ↔ mock', () => {
  it('VClaim: tanda tangan + user_key diterima, respons terenkripsi didekripsi dan lolos skema kontrak', async () => {
    expect(mockState.bpjsEncryption).toBe(true);
    const aktif = await enqueue('test.bpjs.peserta', { nik: NIK });
    const tidakAktif = await enqueue('test.bpjs.peserta', { nik: NIK_TIDAK_AKTIF });
    const s = await dispatch();
    expect(s.sent).toBe(2);
    expect(await marks(aktif.id)).toEqual([{ outcome: 'accepted', aktif: true }]);
    expect(await marks(tidakAktif.id)).toEqual([{ outcome: 'accepted', aktif: false }]);
    expect(await lastAttempt(aktif.id)).toMatchObject({
      outcome: 'sent',
      statusCode: 200,
      responseExcerpt: 'BPJS OK',
    });
  });

  it('Antrean: respons berisi data (terenkripsi) tervalidasi; tanpa enkripsi (flag mock) tetap terbaca', async () => {
    const enc = await enqueue('test.bpjs.ref-poli');
    await dispatch();
    expect(await marks(enc.id)).toEqual([{ outcome: 'accepted', poli: true }]);
    mockState.bpjsEncryption = false;
    const plain = await enqueue('test.bpjs.ref-poli');
    await dispatch();
    expect(await marks(plain.id)).toEqual([{ outcome: 'accepted', poli: true }]);
  });

  it('respons yang tidak sesuai skema kontrak → BPJS_PROTOCOL, langsung DLQ', async () => {
    const msg = await enqueue('test.bpjs.kontrak-salah');
    await dispatch();
    expect(await message(msg.id)).toMatchObject({
      status: 'dead',
      attempts: 1,
      lastError: 'BPJS_PROTOCOL: Isi respons BPJS tidak sesuai kontrak',
    });
  });

  it('galat bisnis di HTTP 200 → TERKIRIM sebagai hasil domain "ditolak" (bukan retry/DLQ)', async () => {
    const msg = await enqueue('test.bpjs.task', { kodebooking: 'BK-TIDAK-ADA' });
    const s = await dispatch();
    expect(s).toMatchObject({ sent: 1, failed: 0, dead: 0 });
    expect(await message(msg.id)).toMatchObject({ status: 'sent', attempts: 1, lastError: null });
    expect(await marks(msg.id)).toEqual([
      { outcome: 'rejected', code: 'BPJS_ANTREAN_TIDAK_DITEMUKAN', bpjsCode: '201' },
    ]);
    // Operasi BPJS sensitif secara bawaan: pesan asli BPJS tidak masuk jejak pengiriman, hanya kodenya.
    expect((await lastAttempt(msg.id)).responseExcerpt).toBe(
      'ditolak BPJS 201 → BPJS_ANTREAN_TIDAK_DITEMUKAN',
    );
  });

  it('penolakan tanpa onRejected → DLQ (tidak hilang diam-diam) + onDead', async () => {
    const msg = await enqueue('test.bpjs.task-tanpa-tolak', { kodebooking: 'BK-TIDAK-ADA' });
    await dispatch();
    const error = 'Ditolak BPJS 201: BPJS_ANTREAN_TIDAK_DITEMUKAN';
    expect(await message(msg.id)).toMatchObject({ status: 'dead', lastError: error });
    expect(await marks(msg.id)).toEqual([{ outcome: 'dead', lastError: error }]);
  });

  it('BPJS gangguan (mock gagal 503) → BPJS_UNAVAILABLE, dicoba ulang (kebijakan hari layanan), lalu pulih', async () => {
    scenario('gagal');
    const msg = await enqueue('test.bpjs.ref-poli');
    await dispatch();
    const m = await message(msg.id);
    expect(m).toMatchObject({ status: 'failed', attempts: 1, lastError: 'BPJS_UNAVAILABLE: HTTP 503' });
    expect(await marks(msg.id)).toEqual([]);

    scenario('normal');
    await dispatch(new Date(m.nextAttemptAt.getTime() + 1));
    expect(await message(msg.id)).toMatchObject({ status: 'sent', attempts: 2 });
  });

  it('mock menahan respons (mode timeout) → batas waktu klien → BPJS_UNAVAILABLE, dicoba ulang', async () => {
    scenario('timeout');
    const msg = await enqueue('test.bpjs.ref-poli');
    await dispatch();
    expect(await message(msg.id)).toMatchObject({
      status: 'failed',
      attempts: 1,
      lastError: 'BPJS_UNAVAILABLE: timeout',
    });
  });

  it('kredensial salah → mock 401 → BPJS_AUTH, galat permanen (rahasia maupun user_key)', async () => {
    const req = { service: 'antrean' as const, ...ANTREAN_ENDPOINTS.refPoli };
    const msg = { target: 'bpjs', operation: 'x', idempotencyKey: 'k', payload: {} };
    for (const wrong of [{ BPJS_SECRET_KEY: 'bukan-rahasia-mock' }, { BPJS_USER_KEY: 'bukan-user-key' }]) {
      const res = await new BpjsConnector({ ...env, ...wrong }).send(msg, req);
      expect(res).toMatchObject({
        ok: false,
        permanent: true,
        statusCode: 401,
        error: 'BPJS_AUTH: HTTP 401',
      });
    }
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
