/**
 * P08 · Penjaga database dokumen dan tanda tangan: dokumen tidak bisa diubah/dihapus (juga oleh pemilik tabel),
 * batal hanya sekali dan tidak untuk dokumen yang ditandatangani, hash tanda tangan = hash dokumen, tanda tangan
 * terkunci setelah `signed`, kunci penyimpanan selalu buatan server.
 */
import { newId } from '@simrs/shared';
import { newVerifyCode, PatientCrypto, sha256Hex } from '@simrs/shared/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient, insertPatient, type PrismaClient, withTenant } from '../src/index';
import { testDbUrls } from '../src/testing';

let app: PrismaClient;
let owner: PrismaClient;
let T: string;
let patientId: string;
let userId: string;

beforeAll(async () => {
  app = createPrismaClient({ connectionString: testDbUrls().app, max: 3 });
  owner = createPrismaClient({ connectionString: testDbUrls().migrator, max: 2 });
  T = newId();
  await withTenant(owner, T, (tx) =>
    tx.tenant.create({
      data: { id: T, code: `DC${T.slice(-8).toUpperCase()}`, name: 'RS Fiktif Uji Dokumen' },
    }),
  );
  const crypto = new PatientCrypto(
    {
      encKeyB64: Buffer.alloc(32, 41).toString('base64'),
      hashKeyB64: Buffer.alloc(32, 43).toString('base64'),
    },
    T,
  );
  patientId = (
    await withTenant(app, T, (tx) =>
      insertPatient(tx, crypto, { name: 'Pasien Dokumen', sex: 'male', birthDate: '1970-05-05' }),
    )
  ).id;
  userId = newId();
  await withTenant(app, T, (tx) =>
    tx.user.create({
      data: { id: userId, tenantId: T, username: `dok.${userId.slice(-6)}`, displayName: 'dr. Uji' },
    }),
  );
});

afterAll(async () => {
  await app.$disconnect();
  await owner.$disconnect();
});

const doc = (over: Record<string, unknown> = {}) => {
  const id = newId();
  return {
    id,
    tenantId: T,
    patientId,
    kind: 'hasil',
    title: 'Hasil laboratorium',
    fileName: 'hasil.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1234,
    sha256: sha256Hex(id),
    storageKey: `${T}/2026/10/${newId()}`,
    ...over,
  };
};
const signature = (d: { id: string; sha256: string }, over: Record<string, unknown> = {}) => ({
  id: newId(),
  tenantId: T,
  documentId: d.id,
  signerUserId: userId,
  documentSha256: d.sha256,
  verifyCode: newVerifyCode(T),
  ...over,
});
const inT = <R>(fn: Parameters<typeof withTenant<R>>[2], client: PrismaClient = app) =>
  withTenant(client, T, fn);

describe('dokumen di database (P08)', () => {
  it('isi dokumen tidak bisa diubah/dihapus; kunci penyimpanan wajib buatan server', async () => {
    const d = doc();
    await inT((tx) => tx.document.create({ data: d }));
    await expect(
      inT((tx) => tx.document.update({ where: { id: d.id }, data: { title: 'Judul diganti' } })),
    ).rejects.toThrow(/permission denied/);
    await expect(
      inT(
        (tx) => tx.$executeRaw`UPDATE documents SET sha256 = ${'0'.repeat(64)} WHERE id = ${d.id}::uuid`,
        owner,
      ),
    ).rejects.toThrow(/DOCUMENT_IMMUTABLE/);
    await expect(
      inT((tx) => tx.$executeRaw`DELETE FROM documents WHERE id = ${d.id}::uuid`, owner),
    ).rejects.toThrow(/DOCUMENT_IMMUTABLE/);
    await expect(
      inT((tx) => tx.document.create({ data: doc({ storageKey: '../../etc/passwd' }) })),
    ).rejects.toThrow(/documents_storage_key_format/);
    await expect(
      inT((tx) => tx.document.create({ data: doc({ storageKey: `${newId()}/2026/10/${newId()}` }) })),
    ).rejects.toThrow(/documents_storage_key_format/);
  });

  it('batal sekali dengan alasan; tidak bisa dibatalkan ulang', async () => {
    const d = doc();
    await inT((tx) => tx.document.create({ data: d }));
    const voided = { voidedAt: new Date(), voidedBy: userId, voidReason: 'Salah unggah, pasien berbeda' };
    await expect(
      inT((tx) =>
        tx.document.update({ where: { id: d.id }, data: { voidedAt: new Date(), voidedBy: userId } }),
      ),
    ).rejects.toThrow(/documents_void_consistent/);
    await inT((tx) => tx.document.update({ where: { id: d.id }, data: voided }));
    await expect(
      inT((tx) =>
        tx.document.update({ where: { id: d.id }, data: { ...voided, voidReason: 'Alasan lain diganti' } }),
      ),
    ).rejects.toThrow(/DOCUMENT_IMMUTABLE/);
    // Dokumen batal tidak bisa ditandatangani.
    await expect(inT((tx) => tx.documentSignature.create({ data: signature(d) }))).rejects.toThrow(
      /DOCUMENT_VOIDED/,
    );
  });

  it('tanda tangan: hash wajib sama, satu per penanda tangan, terkunci setelah signed; dokumennya tidak bisa dibatalkan', async () => {
    const d = doc();
    await inT((tx) => tx.document.create({ data: d }));
    await expect(
      inT((tx) => tx.documentSignature.create({ data: signature(d, { documentSha256: 'f'.repeat(64) }) })),
    ).rejects.toThrow(/SIGNATURE_HASH_MISMATCH/);
    const s = signature(d);
    await inT((tx) => tx.documentSignature.create({ data: s }));
    await expect(inT((tx) => tx.documentSignature.create({ data: signature(d) }))).rejects.toThrow(
      /Unique constraint/,
    );
    await expect(
      inT((tx) =>
        tx.document.update({
          where: { id: d.id },
          data: { voidedAt: new Date(), voidedBy: userId, voidReason: 'Batal saat sedang ditandatangani' },
        }),
      ),
    ).rejects.toThrow(/DOCUMENT_SIGNED/);
    const signedAt = new Date();
    await inT((tx) =>
      tx.documentSignature.update({
        where: { id: s.id },
        data: {
          status: 'signed',
          signedAt,
          certificate: 'CN=uji',
          signature: 'c2lnbmF0dXJl',
          providerSignatureId: 'p1',
        },
      }),
    );
    await expect(
      inT((tx) => tx.documentSignature.update({ where: { id: s.id }, data: { signature: 'ZGlnYW50aQ==' } })),
    ).rejects.toThrow(/SIGNATURE_IMMUTABLE/);
    await expect(
      inT((tx) => tx.$executeRaw`DELETE FROM document_signatures WHERE id = ${s.id}::uuid`, owner),
    ).rejects.toThrow(/SIGNATURE_IMMUTABLE/);
    // Status signed wajib lengkap.
    const d2 = doc();
    await inT((tx) => tx.document.create({ data: d2 }));
    const s2 = signature(d2);
    await inT((tx) => tx.documentSignature.create({ data: s2 }));
    await expect(
      inT((tx) =>
        tx.documentSignature.update({ where: { id: s2.id }, data: { status: 'signed', signedAt } }),
      ),
    ).rejects.toThrow(/document_signatures_signed_consistent/);
  });

  it('isolasi tenant: tenant lain tidak melihat dokumen', async () => {
    const other = newId();
    await withTenant(owner, other, (tx) =>
      tx.tenant.create({
        data: { id: other, code: `DX${other.slice(-8).toUpperCase()}`, name: 'RS Fiktif Lain' },
      }),
    );
    expect(await withTenant(app, other, (tx) => tx.document.count())).toBe(0);
    expect(await inT((tx) => tx.document.count())).toBeGreaterThan(0);
  });
});
