/**
 * Migrasi `20261005102000_worker_failure_states` (untuk potongan 1a): tanda tangan TTE `failed` + kirim ulang,
 * status verifikasi identifier `error`, dan `outbox_messages.requeued_at`.
 */
import { newId } from '@simrs/shared';
import { newVerifyCode, PatientCrypto, sha256Hex } from '@simrs/shared/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createPrismaClient,
  enqueueOutbox,
  insertPatient,
  type PrismaClient,
  withTenant,
} from '../src/index';
import { testDbUrls } from '../src/testing';

let app: PrismaClient;
let owner: PrismaClient;
let T: string;
let patientId: string;
let userId: string;

beforeAll(async () => {
  app = createPrismaClient({ connectionString: testDbUrls().app, max: 2 });
  owner = createPrismaClient({ connectionString: testDbUrls().migrator, max: 1 });
  T = newId();
  await withTenant(owner, T, (tx) =>
    tx.tenant.create({
      data: { id: T, code: `WF${T.slice(-8).toUpperCase()}`, name: 'RS Fiktif Uji Worker' },
    }),
  );
  const crypto = new PatientCrypto(
    {
      encKeyB64: Buffer.alloc(32, 51).toString('base64'),
      hashKeyB64: Buffer.alloc(32, 53).toString('base64'),
    },
    T,
  );
  patientId = (
    await withTenant(app, T, (tx) =>
      insertPatient(tx, crypto, {
        name: 'Pasien Uji Worker',
        sex: 'male',
        birthDate: '1970-05-05',
        identifiers: { nik: '9999970505700001' },
      }),
    )
  ).id;
  userId = newId();
  await withTenant(app, T, (tx) =>
    tx.user.create({
      data: { id: userId, tenantId: T, username: `wf.${userId.slice(-6)}`, displayName: 'dr. Uji' },
    }),
  );
});

afterAll(async () => {
  await app.$disconnect();
  await owner.$disconnect();
});

const inT = <R>(fn: Parameters<typeof withTenant<R>>[2]) => withTenant(app, T, fn);

async function pendingSignature(): Promise<string> {
  const docId = newId();
  const sha256 = sha256Hex(docId);
  const id = newId();
  await inT(async (tx) => {
    await tx.document.create({
      data: {
        id: docId,
        tenantId: T,
        patientId,
        kind: 'hasil',
        title: 'Hasil uji',
        fileName: 'hasil.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 100,
        sha256,
        storageKey: `${T}/2026/10/${newId()}`,
      },
    });
    await tx.documentSignature.create({
      data: {
        id,
        tenantId: T,
        documentId: docId,
        signerUserId: userId,
        documentSha256: sha256,
        verifyCode: newVerifyCode(T),
      },
    });
  });
  return id;
}

const setStatus = (id: string, status: string) =>
  inT((tx) => tx.documentSignature.update({ where: { id }, data: { status } }));
const sign = (id: string) =>
  inT((tx) =>
    tx.documentSignature.update({
      where: { id },
      data: { status: 'signed', signedAt: new Date(), certificate: 'CN=Uji', signature: 'c2lnbg' },
    }),
  );

describe('keadaan gagal permanen untuk worker', () => {
  it('tanda tangan: pending → failed → pending (kirim ulang) → signed; failed tidak langsung signed; signed final', async () => {
    const s = await pendingSignature();
    await setStatus(s, 'failed');
    await expect(sign(s)).rejects.toThrow(/SIGNATURE_IMMUTABLE/);
    await setStatus(s, 'pending');
    await sign(s);
    await expect(setStatus(s, 'failed')).rejects.toThrow(/SIGNATURE_IMMUTABLE/);
    await expect(setStatus(s, 'batal')).rejects.toThrow(
      /document_signatures_status_valid|SIGNATURE_IMMUTABLE/,
    );
    const other = await pendingSignature();
    await expect(setStatus(other, 'batal')).rejects.toThrow(/document_signatures_status_valid/);
  });

  it('verifikasi identifier boleh berstatus error; nilai lain tetap ditolak', async () => {
    const update = (verificationStatus: string) =>
      inT((tx) => tx.patientIdentifier.updateMany({ where: { patientId }, data: { verificationStatus } }));
    await update('error');
    await expect(update('gagal')).rejects.toThrow(/patient_identifiers_verification_valid/);
  });

  it('outbox: requeued_at bisa diisi aplikasi saat kirim ulang', async () => {
    const msg = await inT((tx) =>
      enqueueOutbox(tx, T, {
        target: 'tte',
        operation: 'ping',
        idempotencyKey: `rq-${newId()}`,
        payload: {},
      }),
    );
    const at = new Date();
    const row = await inT((tx) =>
      tx.outboxMessage.update({
        where: { id: msg.id },
        data: { requeuedAt: at },
        select: { requeuedAt: true },
      }),
    );
    expect(row.requeuedAt?.toISOString()).toBe(at.toISOString());
  });
});
