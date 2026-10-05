/**
 * P12 minimal (ADR-0029) · Terbitkan PDF klinis di atas alur dokumen P08: render deterministik → berkas + hash →
 * `documents` → TTE `pending` + outbox `tte.sign`. Identitas pasien dan kop dari DB. Pemanggilnya modul klinis (fase 3)
 * di transaksi permintaannya; di sini dijalankan dalam konteks permintaan tiruan atas transaksi bertenant sungguhan,
 * lalu isi berkas diunduh lewat API dokumen (hash diverifikasi ulang).
 */
import type { NestExpressApplication } from '@nestjs/platform-express';
import { withTenant } from '@simrs/db';
import { renderClinicalPdf } from '@simrs/pdf';
import { AppError, newId, TTE_SIGN_OPERATION } from '@simrs/shared';
import { sha256Hex } from '@simrs/shared/node';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type PendingAudit, requestContext } from '../src/common/request-context';
import {
  ClinicalPdfService,
  type IssueClinicalPdfInput,
} from '../src/modules/documents/clinical-pdf.service';
import {
  bearer,
  createTestApp,
  createTestPatient,
  createTestTenant,
  createTestUser,
  login,
  type TestUser,
  testDb,
  type Tokens,
} from './helpers';

let app: NestExpressApplication;
let svc: ClinicalPdfService;
let T: { id: string; code: string };
let dokter: TestUser;
let dokterTok: Tokens;
let patientId: string;
let mergedId: string;

beforeAll(async () => {
  app = await createTestApp();
  svc = app.get(ClinicalPdfService);
  T = await createTestTenant();
  dokter = await createTestUser(T.id, { roles: [{ code: 'dokter' }], tenantCode: T.code });
  dokterTok = await login(app, dokter);
  patientId = (await createTestPatient(T.id, { name: 'Ny. Uji Resume Fiktif', birthDate: '1968-03-12' })).id;
  const survivor = await createTestPatient(T.id, { name: 'Tn. Uji Gabung' });
  mergedId = (await createTestPatient(T.id, { name: 'Tn. Uji Gabung' })).id;
  await withTenant(testDb(), T.id, async (tx) => {
    await tx.facility.create({
      data: {
        id: newId(),
        tenantId: T.id,
        code: 'UTAMA',
        name: 'Kampus Utama',
        address: 'Jl. Uji Fiktif No. 1',
      },
    });
    await tx.accessRelationship.create({
      data: { id: newId(), tenantId: T.id, userId: dokter.id, patientId, kind: 'dpjp' },
    });
    await tx.patient.update({
      where: { id: mergedId },
      data: { status: 'merged', mergedIntoId: survivor.id, mergedAt: new Date() },
    });
  });
});

afterAll(async () => {
  await app?.close();
});

/** Jalankan `fn` seperti di dalam transaksi permintaan bertenant milik dokter (audit dikumpulkan, tidak ditulis). */
async function asDoctor<R>(fn: () => Promise<R>, scope: 'all' | 'relationship' = 'relationship') {
  const audit: PendingAudit[] = [];
  const result = await withTenant(testDb(), T.id, (tx) =>
    requestContext.run(
      {
        tenantId: T.id,
        tx,
        actor: { userId: dokter.id, role: 'dokter', sessionId: null, unitId: null },
        requestId: null,
        ip: null,
        userAgent: null,
        permissionScope: scope,
        audit,
        afterCommit: [],
      },
      fn,
    ),
  );
  return { result, audit };
}

const input = (over: Partial<IssueClinicalPdfInput> = {}): IssueClinicalPdfInput => ({
  patientId,
  kind: 'resume',
  title: 'Resume Medis Pulang',
  fileName: 'resume medis',
  number: 'RES/2026/10/0001',
  issuedAt: new Date('2026-10-05T06:00:00.000Z'),
  patientExtra: [{ label: 'Ruang / bed', value: 'Bangsal Melati M-203' }],
  sections: [
    {
      title: 'Ringkasan',
      blocks: [{ kind: 'paragraph', text: 'Suhu 38,9 °C → 36,8 °C; kondisi pulang membaik.' }],
    },
  ],
  tte: { role: 'Dokter penanggung jawab pelayanan (DPJP)', caption: null },
  ...over,
});

describe('PDF klinis + TTE lewat alur dokumen', () => {
  it('terbit: berkas PDF ber-hash, dokumen, TTE pending + outbox tte.sign (ID saja), audit; unduh = byte yang sama', async () => {
    const { result, audit } = await asDoctor(() => svc.issue(input()));
    const doc = result.document;
    expect(doc).toMatchObject({
      patientId,
      kind: 'resume',
      title: 'Resume Medis Pulang',
      fileName: 'resume medis.pdf',
      mimeType: 'application/pdf',
      voided: null,
    });
    expect(doc.signatures).toEqual([expect.objectContaining({ id: result.signatureId, status: 'pending' })]);
    expect(audit.map((a) => [a.action, a.details?.status ?? a.details?.generated])).toEqual([
      ['create', 'clinical_pdf'],
      ['sign', 'requested'],
    ]);

    const rows = await withTenant(testDb(), T.id, async (tx) => ({
      sig: await tx.documentSignature.findUniqueOrThrow({ where: { id: result.signatureId as string } }),
      msg: await tx.outboxMessage.findFirstOrThrow({
        where: { idempotencyKey: `tte-sign:${result.signatureId}` },
      }),
    }));
    expect(rows.sig).toMatchObject({
      signerUserId: dokter.id,
      documentSha256: doc.sha256,
      status: 'pending',
    });
    expect(rows.msg).toMatchObject({
      target: 'tte',
      operation: TTE_SIGN_OPERATION,
      payload: { signatureId: result.signatureId },
    });

    const res = await request(app.getHttpServer())
      .get(`/api/v1/documents/${doc.id}/content`)
      .set(bearer(dokterTok))
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    const body = res.body as Buffer;
    expect(body.subarray(0, 5).toString()).toBe('%PDF-');
    expect(sha256Hex(body)).toBe(doc.sha256);
    expect(body.length).toBe(doc.sizeBytes);

    // Hash dapat dibangun ulang dari data (kop + identitas dari DB, kode verifikasi dari tanda tangan).
    const { signer, mrn } = await withTenant(testDb(), T.id, async (tx) => ({
      signer: (await tx.user.findUniqueOrThrow({ where: { id: dokter.id } })).displayName,
      mrn: (await tx.patient.findUniqueOrThrow({ where: { id: patientId } })).mrn,
    }));
    const rebuilt = await renderClinicalPdf({
      hospital: { name: 'RS Fiktif Uji', unit: 'Kampus Utama', address: 'Jl. Uji Fiktif No. 1' },
      document: {
        title: 'Resume Medis Pulang',
        number: 'RES/2026/10/0001',
        issuedAt: '2026-10-05T06:00:00.000Z',
      },
      patient: {
        name: 'Ny. Uji Resume Fiktif',
        mrn,
        birthDate: '1968-03-12',
        sex: 'female',
        extra: [{ label: 'Ruang / bed', value: 'Bangsal Melati M-203' }],
      },
      sections: input().sections,
      signatures: [
        {
          role: 'Dokter penanggung jawab pelayanan (DPJP)',
          name: signer,
          caption: null,
          verifyUrl: doc.signatures[0]?.verifyUrl,
        },
      ],
    });
    expect(sha256Hex(Buffer.from(rebuilt))).toBe(doc.sha256);
  });

  it('tanpa TTE: dokumen tanpa permintaan tanda tangan dan tanpa outbox', async () => {
    const { result, audit } = await asDoctor(() =>
      svc.issue(
        input({
          kind: 'consent',
          title: 'Penolakan Tindakan',
          fileName: 'penolakan',
          tte: null,
          otherSigners: [{ role: 'Pasien', name: 'Ny. Uji Resume Fiktif' }],
        }),
      ),
    );
    expect(result.signatureId).toBeNull();
    expect(result.document.signatures).toEqual([]);
    expect(audit.map((a) => a.action)).toEqual(['create']);
  });

  it('akses mengikuti ABAC pasien; pasien tak dikenal 404; RM yang sudah digabung 409', async () => {
    const stranger = (await createTestPatient(T.id, { name: 'Pasien Lain Fiktif' })).id;
    await expect(asDoctor(() => svc.issue(input({ patientId: stranger })))).rejects.toMatchObject({
      status: 403,
    });
    await expect(asDoctor(() => svc.issue(input({ patientId: newId() })), 'all')).rejects.toMatchObject({
      status: 404,
    });
    const merged = asDoctor(() => svc.issue(input({ patientId: mergedId })), 'all');
    await expect(merged).rejects.toBeInstanceOf(AppError);
    await expect(merged).rejects.toMatchObject({ status: 409 });
  });
});
