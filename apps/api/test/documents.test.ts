/**
 * P08 · Dokumen pasien lewat API: unggah (jenis dari isi berkas, batas ukuran, nama aman), ABAC + hak tulis,
 * unduh dengan cek hash (berkas yang diubah di penyimpanan ditahan), batal beralasan, minta TTE lewat outbox,
 * verifikasi publik tanpa PHI.
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { withTenant } from '@simrs/db';
import { MAX_DOCUMENT_BYTES, newId } from '@simrs/shared';
import { sha256Hex } from '@simrs/shared/node';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bearer,
  createTestApp,
  createTestPatient,
  createTestTenant,
  createTestUser,
  login,
  TEST_STORAGE_ROOT,
  type TestUser,
  testDb,
  type Tokens,
} from './helpers';

let app: NestExpressApplication;
let T: { id: string; code: string };
const u: Record<string, TestUser> = {};
const tok: Record<string, Tokens> = {};
let patientId: string;
const http = () => request(app.getHttpServer());
const auth = (who: string) => bearer(tok[who] as Tokens);

const PDF = Buffer.from('%PDF-1.4\n% dokumen fiktif untuk uji\n1 0 obj << >> endobj\n%%EOF\n');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

function upload(
  who: string | null,
  body: Buffer,
  meta: { kind?: string; title?: string; file?: string } = {},
) {
  let req = http()
    .post(`/api/v1/patients/${patientId}/documents`)
    .set('Content-Type', 'application/octet-stream')
    .set('X-Document-Kind', meta.kind ?? 'hasil')
    .set('X-Document-Title', encodeURIComponent(meta.title ?? 'Hasil laboratorium darah'))
    .set('X-Document-Filename', encodeURIComponent(meta.file ?? 'C:\\fakepath\\hasil lab.pdf'));
  if (who) req = req.set(auth(who));
  return req.send(body);
}

const audits = (where: Record<string, unknown>) =>
  withTenant(testDb(), T.id, (tx) => tx.auditEvent.findMany({ where, orderBy: { seq: 'asc' } }));

beforeAll(async () => {
  app = await createTestApp();
  T = await createTestTenant();
  for (const [who, role] of [
    ['dokter', 'dokter'],
    ['dokter2', 'dokter'],
    ['perawat', 'perawat'],
    ['rm', 'petugas_rm'],
    ['kasir', 'kasir'],
  ] as const) {
    u[who] = await createTestUser(T.id, { roles: [{ code: role }], tenantCode: T.code });
    tok[who] = await login(app, u[who] as TestUser);
  }
  patientId = (await createTestPatient(T.id)).id;
  await withTenant(testDb(), T.id, async (tx) => {
    for (const who of ['dokter', 'dokter2', 'perawat'] as const) {
      await tx.accessRelationship.create({
        data: { id: newId(), tenantId: T.id, userId: u[who]?.id as string, patientId, kind: 'dpjp' },
      });
    }
  });
});

afterAll(async () => {
  await app.close();
});

describe('unggah dokumen', () => {
  it('dokter berelasi mengunggah PDF: jenis dari isi, hash, nama aman; diaudit dengan pasien', async () => {
    const res = await upload('dokter', PDF).expect(201);
    expect(res.body).toMatchObject({
      patientId,
      kind: 'hasil',
      title: 'Hasil laboratorium darah',
      fileName: 'hasil lab.pdf',
      mimeType: 'application/pdf',
      sizeBytes: PDF.length,
      sha256: sha256Hex(PDF),
      voided: null,
      signatures: [],
    });
    const [created] = await audits({ action: 'create', resourceType: 'document', resourceId: res.body.id });
    expect(created).toMatchObject({ patientId, details: { kind: 'hasil' } });
  });

  it('isi bukan PDF/PNG/JPEG ditolak walau berekstensi .pdf; kosong dan terlalu besar ditolak', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>');
    expect((await upload('dokter', svg, { file: 'hasil.pdf' }).expect(415)).body.code).toBe(
      'UNSUPPORTED_MEDIA_TYPE',
    );
    await upload('dokter', Buffer.alloc(0)).expect(400);
    const big = Buffer.alloc(MAX_DOCUMENT_BYTES + 1, 0x25);
    expect((await upload('dokter', big).expect(413)).body.code).toBe('PAYLOAD_TOO_LARGE');
    await upload('dokter', PDF, { kind: 'rahasia' }).expect(400);
    await upload('dokter', PDF, { title: 'x' }).expect(400);
    // Tanpa token: ditolak sebelum berkas dibaca.
    expect((await upload(null, PDF).expect(401)).body.code).toBe('UNAUTHENTICATED');
    // PNG dikenali dari isinya walau nama berkasnya .pdf.
    const png = await upload('dokter', PNG, {
      file: 'foto.pdf',
      kind: 'lampiran',
      title: 'Foto luka',
    }).expect(201);
    expect(png.body).toMatchObject({ mimeType: 'image/png', fileName: 'foto.png' });
  });

  it('hak: perawat (tanpa hak tulis dokumen) dan kasir ditolak; dokter tanpa relasi ditolak dan diaudit', async () => {
    await upload('perawat', PDF).expect(403);
    await upload('kasir', PDF).expect(403);
    const other = (await createTestPatient(T.id)).id;
    await http()
      .post(`/api/v1/patients/${other}/documents`)
      .set(auth('dokter'))
      .set('Content-Type', 'application/octet-stream')
      .set('X-Document-Kind', 'hasil')
      .set('X-Document-Title', 'Hasil')
      .send(PDF)
      .expect(403);
    const denied = await audits({ action: 'access_denied', actorUserId: u.dokter?.id, patientId: other });
    expect(denied).toHaveLength(1);
  });
});

describe('baca, unduh, batal', () => {
  it('unduh: isi sama + header aman; perawat berelasi boleh baca; berkas yang diubah di disk ditahan', async () => {
    const doc = (await upload('dokter', PDF, { title: 'Surat rujukan' }).expect(201)).body;
    const res = await http().get(`/api/v1/documents/${doc.id}/content`).set(auth('perawat')).expect(200);
    expect(Buffer.from(res.body as Buffer).equals(PDF)).toBe(true);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['content-disposition']).toBe(
      `attachment; filename="hasil lab.pdf"; filename*=UTF-8''hasil%20lab.pdf`,
    );
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain('sandbox');
    const [read] = await audits({ action: 'read', resourceType: 'document', resourceId: doc.id });
    expect(read).toMatchObject({ patientId, details: { content: true } });

    const list = await http().get(`/api/v1/patients/${patientId}/documents`).set(auth('rm')).expect(200);
    expect(list.body.map((d: { id: string }) => d.id)).toContain(doc.id);
    await http().get(`/api/v1/documents/${doc.id}`).set(auth('kasir')).expect(403);

    const row = await withTenant(testDb(), T.id, (tx) =>
      tx.document.findUniqueOrThrow({ where: { id: doc.id }, select: { storageKey: true } }),
    );
    await writeFile(join(TEST_STORAGE_ROOT, ...row.storageKey.split('/')), Buffer.from('%PDF-1.4 diubah'));
    const tampered = await http().get(`/api/v1/documents/${doc.id}/content`).set(auth('rm')).expect(500);
    expect(tampered.body.code).toBe('DOCUMENT_INTEGRITY');
  });

  it('batal sekali dengan alasan; dokumen batal tidak bisa ditandatangani', async () => {
    const doc = (await upload('dokter', PDF).expect(201)).body;
    await http()
      .post(`/api/v1/documents/${doc.id}/void`)
      .set(auth('dokter'))
      .send({ reason: 'salah' })
      .expect(400);
    const voided = await http()
      .post(`/api/v1/documents/${doc.id}/void`)
      .set(auth('dokter'))
      .send({ reason: 'Salah unggah, milik pasien lain' })
      .expect(200);
    expect(voided.body.voided).toMatchObject({ reason: 'Salah unggah, milik pasien lain' });
    await http()
      .post(`/api/v1/documents/${doc.id}/void`)
      .set(auth('dokter'))
      .send({ reason: 'Batal kedua kalinya' })
      .expect(409);
    await http().post(`/api/v1/documents/${doc.id}/signatures`).set(auth('dokter')).expect(409);
    const [ev] = await audits({ action: 'deactivate', resourceType: 'document', resourceId: doc.id });
    expect(ev).toMatchObject({ patientId, reason: 'Salah unggah, milik pasien lain' });
  });
});

describe('tanda tangan elektronik (TTE)', () => {
  it('minta TTE → pending + pesan outbox berisi ID saja; verifikasi publik tanpa PHI; selesai → sah', async () => {
    const doc = (await upload('dokter', PDF, { title: 'Resume medis Siti Rahmawati' }).expect(201)).body;
    const res = await http().post(`/api/v1/documents/${doc.id}/signatures`).set(auth('dokter')).expect(201);
    const [sig] = res.body.signatures;
    expect(sig).toMatchObject({ status: 'pending', signer: 'Pengguna Uji Fiktif', signedAt: null });
    expect(sig.verifyUrl).toMatch(/\/verifikasi\/sv1\./);
    await http().post(`/api/v1/documents/${doc.id}/signatures`).set(auth('dokter')).expect(409);
    // Dokumen yang sedang ditandatangani tidak bisa dibatalkan.
    await http()
      .post(`/api/v1/documents/${doc.id}/void`)
      .set(auth('dokter'))
      .send({ reason: 'Mencoba membatalkan dokumen' })
      .expect(409);

    const msg = await withTenant(testDb(), T.id, (tx) =>
      tx.outboxMessage.findFirstOrThrow({
        where: { target: 'tte', operation: 'tte.sign' },
        orderBy: { createdAt: 'desc' },
      }),
    );
    expect(msg.payload).toEqual({ signatureId: sig.id });

    const code = new URL(sig.verifyUrl).pathname.split('/').pop() as string;
    const pending = await http().get(`/api/v1/verification/signatures/${code}`).expect(200);
    expect(pending.body).toMatchObject({
      valid: false,
      status: 'pending',
      documentKind: 'Hasil pemeriksaan',
    });
    const text = JSON.stringify(pending.body);
    expect(text).not.toContain('Siti');
    expect(text).not.toContain(patientId);

    // Selesai di penyelenggara TTE (diisi worker; operasinya diuji di apps/worker).
    await withTenant(testDb(), T.id, (tx) =>
      tx.documentSignature.update({
        where: { id: sig.id },
        data: {
          status: 'signed',
          signedAt: new Date(),
          certificate: 'CN=uji, O=Mock TTE Lokal',
          signature: 'c2ln',
        },
      }),
    );
    const signed = await http().get(`/api/v1/verification/signatures/${code}`).expect(200);
    expect(signed.body).toMatchObject({
      valid: true,
      status: 'signed',
      signer: 'Pengguna Uji Fiktif',
      documentSha256: sha256Hex(PDF),
      documentVoided: false,
      certificate: 'CN=uji, O=Mock TTE Lokal',
    });
    // Dokter lain tetap bisa ikut menandatangani; dokumen bertanda tangan tidak bisa dibatalkan.
    await http().post(`/api/v1/documents/${doc.id}/signatures`).set(auth('dokter2')).expect(201);
    await http()
      .post(`/api/v1/documents/${doc.id}/void`)
      .set(auth('dokter'))
      .send({ reason: 'Mencoba membatalkan dokumen final' })
      .expect(409);

    await http().get('/api/v1/verification/signatures/bukan-kode').expect(400);
    await http()
      .get(`/api/v1/verification/signatures/sv1.${T.id}.${'A'.repeat(43)}`)
      .expect(404);
  });
});

describe('isolasi tenant', () => {
  it('pengguna RS lain tidak melihat dokumen RS ini', async () => {
    const doc = (await upload('dokter', PDF).expect(201)).body;
    const other = await createTestTenant();
    const rmOther = await createTestUser(other.id, {
      roles: [{ code: 'petugas_rm' }],
      tenantCode: other.code,
    });
    const t = await login(app, rmOther);
    await http().get(`/api/v1/documents/${doc.id}`).set(bearer(t)).expect(404);
    await http().get(`/api/v1/documents/${doc.id}/content`).set(bearer(t)).expect(404);
  });
});
