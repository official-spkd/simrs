/**
 * P08 · Operasi outbox TTE: yang dikirim ke penyelenggara hanya hash dokumen + ID penanda tangan (bukan isi berkas
 * atau data pasien), hasil disimpan atomik dengan pencatatan terkirim, audit sebagai `system`, tanda tangan yang
 * sudah selesai dilewati, respons rusak masuk DLQ. Target = stub HTTP lokal; tenant fiktif baru.
 */
import 'reflect-metadata';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Test } from '@nestjs/testing';
import { createPrismaClient, enqueueOutbox, insertPatient, type PrismaClient, withTenant } from '@simrs/db';
import { testDbUrls } from '@simrs/db/testing';
import { newId, TTE_SIGN_OPERATION } from '@simrs/shared';
import { newVerifyCode, PatientCrypto, sha256Hex } from '@simrs/shared/node';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadWorkerEnv, WORKER_ENV, type WorkerEnv } from '../src/config/env';
import { OutboxDispatcher } from '../src/outbox/outbox.dispatcher';
import { WorkerModule } from '../src/worker.module';

const SIGNED = JSON.stringify({
  signatureId: 'mock-sig-1',
  signedAt: '2026-10-04T05:00:00.000Z',
  certificate: 'CN=uji, O=Mock TTE Lokal, C=ID',
  signature: 'c2lnbmF0dXJl',
});

let stub: Server;
let reply = { status: 200, body: SIGNED };
const received: Array<Record<string, unknown>> = [];
let env: WorkerEnv;
let db: PrismaClient;
let dispatcher: OutboxDispatcher;
let T: string;
let patientId: string;
let signerId: string;

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
      if (req.url === '/tte/sign') received.push(JSON.parse(raw || '{}') as Record<string, unknown>);
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
        data: { id: T, code: `TT${T.slice(-8).toUpperCase()}`, name: 'RS Fiktif Uji TTE' },
      }),
    );
  } finally {
    await owner.$disconnect();
  }
  const crypto = new PatientCrypto(
    { encKeyB64: env.FIELD_ENCRYPTION_KEY, hashKeyB64: env.FIELD_HASH_KEY },
    T,
  );
  signerId = newId();
  patientId = await withTenant(db, T, async (tx) => {
    await tx.user.create({
      data: { id: signerId, tenantId: T, username: `ttd.${signerId.slice(-6)}`, displayName: 'dr. Uji TTE' },
    });
    return (await insertPatient(tx, crypto, { name: 'Pasien TTE', sex: 'female', birthDate: '1980-01-01' }))
      .id;
  });
});

afterAll(async () => {
  await dispatcher?.onModuleDestroy();
  await db?.$disconnect();
  await new Promise<void>((r) => stub.close(() => r()));
});

beforeEach(() => {
  reply = { status: 200, body: SIGNED };
  received.length = 0;
});

const read = <R>(fn: (tx: Parameters<Parameters<typeof withTenant>[2]>[0]) => Promise<R>) =>
  withTenant(db, T, fn);

/** Dokumen + permintaan tanda tangan + pesan outbox, seperti yang dibuat API. */
async function pendingSignature() {
  return read(async (tx) => {
    const docId = newId();
    const sha = sha256Hex(docId);
    await tx.document.create({
      data: {
        id: docId,
        tenantId: T,
        patientId,
        kind: 'resume',
        title: 'Resume medis rahasia',
        fileName: 'resume.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 100,
        sha256: sha,
        storageKey: `${T}/2026/10/${newId()}`,
      },
    });
    const sigId = newId();
    await tx.documentSignature.create({
      data: {
        id: sigId,
        tenantId: T,
        documentId: docId,
        signerUserId: signerId,
        documentSha256: sha,
        verifyCode: newVerifyCode(T),
      },
    });
    const msg = await enqueueOutbox(tx, T, {
      target: 'tte',
      operation: TTE_SIGN_OPERATION,
      idempotencyKey: `tte-sign:${sigId}`,
      payload: { signatureId: sigId },
    });
    return { docId, sha, sigId, messageId: msg.id };
  });
}

describe('TTE dokumen (operasi outbox)', () => {
  it('hanya hash + penanda tangan yang dikirim; hasil tersimpan; audit sistem; pesan terkirim', async () => {
    const x = await pendingSignature();
    await dispatcher.dispatchOnce({ tenantIds: [T] });
    expect(received).toEqual([{ documentHash: x.sha, signerId }]);
    const sig = await read((tx) => tx.documentSignature.findUniqueOrThrow({ where: { id: x.sigId } }));
    expect(sig).toMatchObject({
      status: 'signed',
      certificate: 'CN=uji, O=Mock TTE Lokal, C=ID',
      signature: 'c2lnbmF0dXJl',
      providerSignatureId: 'mock-sig-1',
    });
    expect(sig.signedAt?.toISOString()).toBe('2026-10-04T05:00:00.000Z');
    const msg = await read((tx) => tx.outboxMessage.findUniqueOrThrow({ where: { id: x.messageId } }));
    expect(msg.status).toBe('sent');
    const audit = await read((tx) =>
      tx.auditEvent.findFirstOrThrow({ where: { action: 'sign', resourceId: x.docId } }),
    );
    expect(audit).toMatchObject({ actorRole: 'system', patientId, details: { status: 'signed' } });
  });

  it('respons tidak dikenali → DLQ, tanda tangan tetap menunggu; sudah selesai → dilewati', async () => {
    reply = { status: 200, body: '{"ok":true}' };
    const bad = await pendingSignature();
    await dispatcher.dispatchOnce({ tenantIds: [T] });
    const m1 = await read((tx) => tx.outboxMessage.findUniqueOrThrow({ where: { id: bad.messageId } }));
    expect(m1).toMatchObject({ status: 'dead', lastError: 'Respons TTE tidak dikenali' });
    const s1 = await read((tx) => tx.documentSignature.findUniqueOrThrow({ where: { id: bad.sigId } }));
    expect(s1.status).toBe('pending');

    reply = { status: 200, body: SIGNED };
    const done = await pendingSignature();
    await read((tx) =>
      tx.documentSignature.update({
        where: { id: done.sigId },
        data: { status: 'signed', signedAt: new Date(), certificate: 'CN=lain', signature: 'bGFpbg==' },
      }),
    );
    received.length = 0;
    await dispatcher.dispatchOnce({ tenantIds: [T] });
    expect(received).toEqual([]);
    const s2 = await read((tx) => tx.documentSignature.findUniqueOrThrow({ where: { id: done.sigId } }));
    expect(s2.certificate).toBe('CN=lain');
  });
});
