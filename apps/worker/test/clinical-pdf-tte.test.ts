/**
 * ADR-0029 · Rantai PDF klinis → TTE ujung ke ujung dengan mock penyelenggara TTE sungguhan (`apps/mock`): PDF
 * deterministik (`@simrs/pdf`) → baris dokumen + tanda tangan `pending` + outbox `tte.sign` (seperti
 * `ClinicalPdfService` API) → worker → mock `/tte/sign`. Tiga hasil: ditandatangani (diverifikasi ulang ke mock),
 * ditolak penyelenggara (4xx → DLQ, `onDead` menandai `failed` + audit), dan gangguan sementara (5xx → dicoba ulang,
 * tetap `pending`, lalu berhasil). Tenant fiktif baru.
 */
import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { createPrismaClient, enqueueOutbox, insertPatient, type PrismaClient, withTenant } from '@simrs/db';
import { testDbUrls } from '@simrs/db/testing';
import { renderClinicalPdf } from '@simrs/pdf';
import { newId, TTE_SIGN_OPERATION, verifyPath } from '@simrs/shared';
import { newVerifyCode, PatientCrypto, sha256Hex } from '@simrs/shared/node';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../mock/src/config';
import { buildServer } from '../../mock/src/server';
import { MockState } from '../../mock/src/state';
import { loadWorkerEnv, WORKER_ENV, type WorkerEnv } from '../src/config/env';
import { OutboxDispatcher } from '../src/outbox/outbox.dispatcher';
import { WorkerModule } from '../src/worker.module';

let mock: ReturnType<typeof buildServer>;
let mockState: MockState;
let mockUrl: string;
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
  mockState = new MockState();
  mock = buildServer({ ...loadConfig({}), port: 0 }, mockState);
  await mock.listen({ port: 0, host: '127.0.0.1' });
  const addr = mock.server.address();
  mockUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  env = loadWorkerEnv({
    ...process.env,
    NODE_ENV: 'test',
    DATABASE_URL: testDbUrls().app,
    MOCK_BASE_URL: mockUrl,
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
        data: { id: T, code: `TP${T.slice(-8).toUpperCase()}`, name: 'RS Fiktif Uji PDF' },
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
      data: { id: signerId, tenantId: T, username: `pdf.${signerId.slice(-6)}`, displayName: 'dr. Uji PDF' },
    });
    return (
      await insertPatient(tx, crypto, { name: 'Pasien PDF Fiktif', sex: 'male', birthDate: '1975-05-05' })
    ).id;
  });
});

afterAll(async () => {
  await dispatcher?.onModuleDestroy();
  await db?.$disconnect();
  await mock?.close();
});

beforeEach(() => mockState.reset());

const read = <R>(fn: (tx: Parameters<Parameters<typeof withTenant>[2]>[0]) => Promise<R>) =>
  withTenant(db, T, fn);

/** PDF resume + dokumen + permintaan TTE + pesan outbox, seperti `ClinicalPdfService.issue` di API. */
async function issueResume() {
  const verifyCode = newVerifyCode(T);
  const pdf = Buffer.from(
    await renderClinicalPdf({
      hospital: { name: 'RS Fiktif Uji PDF' },
      document: { title: 'Resume Medis Pulang', issuedAt: '2026-10-05T06:00:00.000Z' },
      patient: { name: 'Pasien PDF Fiktif', mrn: '00-00-00-01', birthDate: '1975-05-05', sex: 'male' },
      sections: [{ title: 'Ringkasan', blocks: [{ kind: 'paragraph', text: 'Kondisi pulang membaik.' }] }],
      signatures: [
        {
          role: 'Dokter penanggung jawab pelayanan (DPJP)',
          name: 'dr. Uji PDF',
          verifyUrl: new URL(verifyPath(verifyCode), 'http://localhost:3000').toString(),
        },
      ],
    }),
  );
  const sha = sha256Hex(pdf);
  return read(async (tx) => {
    const docId = newId();
    await tx.document.create({
      data: {
        id: docId,
        tenantId: T,
        patientId,
        kind: 'resume',
        title: 'Resume Medis Pulang',
        fileName: 'resume.pdf',
        mimeType: 'application/pdf',
        sizeBytes: pdf.length,
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
        verifyCode,
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

const state = (x: { sigId: string; messageId: string }) =>
  read(async (tx) => ({
    sig: await tx.documentSignature.findUniqueOrThrow({ where: { id: x.sigId } }),
    msg: await tx.outboxMessage.findUniqueOrThrow({ where: { id: x.messageId } }),
  }));

describe('PDF klinis → TTE (mock penyelenggara)', () => {
  it('sukses: hash PDF ditandatangani; tanda tangan valid saat diverifikasi ulang ke penyelenggara', async () => {
    const x = await issueResume();
    await dispatcher.dispatchOnce({ tenantIds: [T] });
    const { sig, msg } = await state(x);
    expect(msg.status).toBe('sent');
    expect(sig).toMatchObject({
      status: 'signed',
      documentSha256: x.sha,
      certificate: `CN=${signerId}, O=Mock TTE Lokal, C=ID`,
    });
    const verify = await fetch(`${mockUrl}/tte/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        documentHash: x.sha,
        signerId,
        signedAt: sig.signedAt?.toISOString(),
        signature: sig.signature,
      }),
    });
    expect(await verify.json()).toEqual({ valid: true });
  });

  it('ditolak penyelenggara (422): langsung DLQ, onDead menandai tanda tangan gagal + audit sistem', async () => {
    mockState.scenarios.set('tte', { ...mockState.scenario('tte'), mode: 'gagal', failStatus: 422 });
    const x = await issueResume();
    await dispatcher.dispatchOnce({ tenantIds: [T] });
    const { sig, msg } = await state(x);
    expect(msg).toMatchObject({ status: 'dead', attempts: 1 });
    expect(sig.status).toBe('failed');
    expect(sig.signature).toBeNull();
    const audit = await read((tx) =>
      tx.auditEvent.findFirstOrThrow({ where: { action: 'sign', resourceId: x.docId } }),
    );
    expect(audit).toMatchObject({
      actorRole: 'system',
      patientId,
      details: { status: 'failed', signatureId: x.sigId, outboxMessageId: x.messageId },
    });
  });

  it('gangguan sementara (503): dicoba ulang, tanda tangan tetap pending, lalu berhasil saat penyelenggara pulih', async () => {
    mockState.scenarios.set('tte', { ...mockState.scenario('tte'), mode: 'gagal', failStatus: 503 });
    const x = await issueResume();
    await dispatcher.dispatchOnce({ tenantIds: [T] });
    const first = await state(x);
    expect(first.msg).toMatchObject({ status: 'failed', attempts: 1 });
    expect(first.sig.status).toBe('pending');

    mockState.reset();
    // Lewati jeda backoff: jalankan putaran berikutnya "satu hari kemudian".
    await dispatcher.dispatchOnce({ tenantIds: [T], now: new Date(Date.now() + 86_400_000) });
    const second = await state(x);
    expect(second.msg.status).toBe('sent');
    expect(second.sig.status).toBe('signed');
  });
});
