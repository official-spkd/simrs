/**
 * P05 → I05 · Operasi outbox verifikasi NIK ke Dukcapil: NIK dibaca dan didekripsi saat dikirim (payload hanya
 * ID), hasil per elemen disimpan tanpa nilai bersamaan dengan pencatatan "terkirim", audit sebagai `system`,
 * NIK yang sudah diganti dilewati, respons rusak masuk DLQ. Target = stub HTTP lokal; tenant fiktif baru.
 */
import 'reflect-metadata';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Test } from '@nestjs/testing';
import {
  createPrismaClient,
  enqueueOutbox,
  insertPatient,
  type NewPatientRecord,
  type PrismaClient,
  withTenant,
} from '@simrs/db';
import { testDbUrls } from '@simrs/db/testing';
import { DUKCAPIL_VERIFY_OPERATION, newId } from '@simrs/shared';
import { PatientCrypto } from '@simrs/shared/node';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadWorkerEnv, WORKER_ENV, type WorkerEnv } from '../src/config/env';
import { OutboxDispatcher } from '../src/outbox/outbox.dispatcher';
import { WorkerModule } from '../src/worker.module';

const ALL_MATCH = '{"found":true,"match":{"nama":true,"tanggalLahir":true,"jenisKelamin":true}}';

let stub: Server;
let reply = { status: 200, body: ALL_MATCH };
const received: Array<Record<string, unknown>> = [];
let env: WorkerEnv;
let db: PrismaClient;
let dispatcher: OutboxDispatcher;
let T: string;

beforeAll(async () => {
  try {
    process.loadEnvFile('../../.env');
  } catch {
    // opsional
  }
  stub = createServer((req: IncomingMessage, res) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => {
      raw += chunk.toString();
    });
    req.on('end', () => {
      if (req.url === '/dukcapil/verify-data')
        received.push(JSON.parse(raw || '{}') as Record<string, unknown>);
      res.writeHead(reply.status, { 'content-type': 'application/json' }).end(reply.body);
    });
  });
  await new Promise<void>((r) => stub.listen(0, '127.0.0.1', r));
  env = loadWorkerEnv({
    ...process.env,
    NODE_ENV: 'test',
    DATABASE_URL: testDbUrls().app,
    MOCK_BASE_URL: `http://127.0.0.1:${(stub.address() as AddressInfo).port}`,
    OUTBOX_HTTP_TIMEOUT_MS: '2000',
  });
  const ref = await Test.createTestingModule({ imports: [WorkerModule] })
    .overrideProvider(WORKER_ENV)
    .useValue(env)
    .compile();
  dispatcher = ref.get(OutboxDispatcher);
  db = createPrismaClient({ connectionString: env.DATABASE_URL, max: 2 });

  const owner = createPrismaClient({ connectionString: testDbUrls().migrator, max: 1 });
  T = newId();
  try {
    await withTenant(owner, T, (tx) =>
      tx.tenant.create({
        data: { id: T, code: `DK${T.slice(-8).toUpperCase()}`, name: 'RS Fiktif Uji Dukcapil' },
      }),
    );
  } finally {
    await owner.$disconnect();
  }
});

afterAll(async () => {
  await dispatcher?.onModuleDestroy();
  await db?.$disconnect();
  await new Promise<void>((r) => stub.close(() => r()));
});

beforeEach(() => {
  reply = { status: 200, body: ALL_MATCH };
  received.length = 0;
});

const nik = () => `999901540372${String(Math.floor(Math.random() * 10_000)).padStart(4, '0')}`;

/** Pasien dengan NIK menunggu verifikasi + pesan outbox, seperti yang dibuat API saat pendaftaran. */
async function pendingNik(value: string, rec: Partial<NewPatientRecord> = {}) {
  const crypto = new PatientCrypto(
    { encKeyB64: env.FIELD_ENCRYPTION_KEY, hashKeyB64: env.FIELD_HASH_KEY },
    T,
  );
  return withTenant(db, T, async (tx) => {
    const p = await insertPatient(tx, crypto, {
      name: 'Siti Rahmawati',
      sex: 'female',
      birthDate: '1972-03-14',
      identifiers: { nik: value },
      ...rec,
    });
    const ident = await tx.patientIdentifier.findFirstOrThrow({ where: { patientId: p.id, system: 'nik' } });
    await tx.patientIdentifier.update({
      where: { id: ident.id },
      data: { verificationStatus: 'pending', verificationDetails: { requests: 1 } },
    });
    const msg = await enqueueOutbox(tx, T, {
      target: 'dukcapil',
      operation: DUKCAPIL_VERIFY_OPERATION,
      idempotencyKey: `nik-verify:${ident.id}:1`,
      payload: { patientId: p.id, identifierId: ident.id },
    });
    return { patientId: p.id, identifierId: ident.id, messageId: msg.id };
  });
}

const read = <R>(fn: (tx: Parameters<Parameters<typeof withTenant>[2]>[0]) => Promise<R>) =>
  withTenant(db, T, fn);

describe('verifikasi NIK ke Dukcapil (operasi outbox)', () => {
  it('cocok → terverifikasi; NIK + data dikirim saat itu juga; audit sistem; pesan terkirim', async () => {
    const n = nik();
    const x = await pendingNik(n);
    await dispatcher.dispatchOnce({ tenantIds: [T] });

    expect(received).toEqual([
      { nik: n, nama: 'Siti Rahmawati', tanggalLahir: '1972-03-14', jenisKelamin: 'P' },
    ]);
    const ident = await read((tx) =>
      tx.patientIdentifier.findUniqueOrThrow({ where: { id: x.identifierId } }),
    );
    expect(ident.verificationStatus).toBe('verified');
    expect(ident.verifiedAt).not.toBeNull();
    expect(ident.verificationDetails).toMatchObject({ requests: 1, source: 'dukcapil', mismatched: [] });
    const msg = await read((tx) => tx.outboxMessage.findUniqueOrThrow({ where: { id: x.messageId } }));
    expect(msg.status).toBe('sent');
    const audit = await read((tx) =>
      tx.auditEvent.findFirstOrThrow({ where: { action: 'verify', resourceId: x.identifierId } }),
    );
    expect(audit).toMatchObject({
      actorUserId: null,
      actorRole: 'system',
      patientId: x.patientId,
      details: { source: 'dukcapil', outcome: 'verified', mismatched: [] },
    });
    expect(JSON.stringify(audit.details)).not.toContain(n);
  });

  it('elemen tidak sesuai → mismatch (nama atribut saja); tidak ditemukan → not_found', async () => {
    reply = {
      status: 200,
      body: '{"found":true,"match":{"nama":false,"tanggalLahir":true,"jenisKelamin":null}}',
    };
    const a = await pendingNik(nik(), { sex: 'unknown' });
    await dispatcher.dispatchOnce({ tenantIds: [T] });
    expect(received[0]).not.toHaveProperty('jenisKelamin');
    const ia = await read((tx) => tx.patientIdentifier.findUniqueOrThrow({ where: { id: a.identifierId } }));
    expect(ia).toMatchObject({
      verificationStatus: 'mismatch',
      verificationDetails: { mismatched: ['name'] },
    });

    reply = { status: 200, body: '{"found":false}' };
    const b = await pendingNik(nik());
    await dispatcher.dispatchOnce({ tenantIds: [T] });
    const ib = await read((tx) => tx.patientIdentifier.findUniqueOrThrow({ where: { id: b.identifierId } }));
    expect(ib.verificationStatus).toBe('not_found');
  });

  it('NIK diganti sebelum terkirim → dilewati tanpa memanggil Dukcapil', async () => {
    const x = await pendingNik(nik());
    await read((tx) =>
      tx.patientIdentifier.update({
        where: { id: x.identifierId },
        data: { active: false, deactivatedAt: new Date(), deactivationReason: 'Salah ketik, diganti' },
      }),
    );
    await dispatcher.dispatchOnce({ tenantIds: [T] });
    expect(received).toEqual([]);
    const msg = await read((tx) =>
      tx.outboxMessage.findUniqueOrThrow({ where: { id: x.messageId }, include: { deliveries: true } }),
    );
    expect(msg.status).toBe('sent');
    expect(msg.deliveries[0]?.responseExcerpt).toBe('dilewati: NIK sudah diganti');
  });

  it('respons tak dikenali → DLQ, status NIK tetap menunggu; gangguan 503 → dicoba ulang', async () => {
    reply = { status: 200, body: '{"received":true}' };
    const bad = await pendingNik(nik());
    await dispatcher.dispatchOnce({ tenantIds: [T] });
    const m1 = await read((tx) => tx.outboxMessage.findUniqueOrThrow({ where: { id: bad.messageId } }));
    expect(m1).toMatchObject({ status: 'dead', lastError: 'Respons Dukcapil tidak dikenali' });
    const i1 = await read((tx) =>
      tx.patientIdentifier.findUniqueOrThrow({ where: { id: bad.identifierId } }),
    );
    expect(i1.verificationStatus).toBe('pending');
    expect(
      await read((tx) => tx.auditEvent.count({ where: { action: 'verify', resourceId: bad.identifierId } })),
    ).toBe(0);

    reply = { status: 503, body: '{}' };
    const down = await pendingNik(nik());
    await dispatcher.dispatchOnce({ tenantIds: [T] });
    const m2 = await read((tx) => tx.outboxMessage.findUniqueOrThrow({ where: { id: down.messageId } }));
    expect(m2).toMatchObject({ status: 'failed', lastError: 'HTTP 503' });
  });
});
