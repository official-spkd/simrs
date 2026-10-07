/**
 * Fase 3 · potongan 3.7 · persetujuan/penolakan tindakan tablet (K11, ADR-0058): templat P07 tujuh butir, draf
 * (`consent_drafts`, bukan rekam medis), tanda tangan pasien/wali (PNG unggahan biner atau ketik nama) + saksi keluarga
 * + atestasi saksi petugas (sesi petugas itu), final hanya dokter berelasi (`consent.sign`) → PDF + TTE (versi
 * terkunci), penolakan beralasan, pencabutan = entri baru ber-TTE, batal draf, edukasi lewat P07, izin + ABAC + isolasi
 * tenant. Data fiktif.
 */
import {
  createPrismaClient,
  ensurePublishedForm,
  seedClinicalMasters,
  seedHospitalStructure,
  type TenantTx,
  withTenant,
} from '@simrs/db';
import { testDbUrls } from '@simrs/db/testing';
import {
  CONSENT_INFORMATION_KEYS,
  CONSENT_SIGNATURE_MAX_BYTES,
  CONSENT_TEMPLATE_SAMPLE,
  EDUCATION_FORM_SAMPLE,
  newId,
  patientDocumentSchema,
} from '@simrs/shared';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bearer,
  createTestApp,
  createTestPatient,
  createTestTenant,
  createTestUser,
  login,
  type Tokens,
  testDb,
} from './helpers';

let app: NestExpressApplication;
let A: { id: string; code: string };
let B: { id: string; code: string };
const tok: Record<string, Tokens> = {};
const users: Record<string, string> = {};
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const PDF = Buffer.from('%PDF-1.4\n%fiktif\n');

const run = <R>(tenantId: string, fn: (tx: TenantTx) => Promise<R>) => withTenant(testDb(), tenantId, fn);
const as = (who: string) => {
  const auth = () => bearer(tok[who] as Tokens);
  const http = () => request(app.getHttpServer());
  return {
    get: (url: string) => http().get(`/api/v1${url}`).set(auth()),
    post: (url: string, body: object = {}) => http().post(`/api/v1${url}`).set(auth()).send(body),
    put: (url: string, body: object = {}) => http().put(`/api/v1${url}`).set(auth()).send(body),
    binary: (url: string, bytes: Buffer) =>
      http().post(`/api/v1${url}`).set(auth()).set('Content-Type', 'application/octet-stream').send(bytes),
    upload: (patientId: string) =>
      http()
        .post(`/api/v1/patients/${patientId}/documents`)
        .set(auth())
        .set('Content-Type', 'application/octet-stream')
        .set('X-Document-Kind', 'lampiran')
        .set('X-Document-Title', encodeURIComponent('Tanda tangan pasien'))
        .set('X-Document-Filename', 'ttd.png')
        .send(PNG),
  };
};

async function clinicalTenant() {
  const t = await createTestTenant();
  const owner = createPrismaClient({ connectionString: testDbUrls().migrator, max: 1 });
  try {
    await withTenant(owner, t.id, async (tx) => {
      await seedHospitalStructure(tx, t.id);
      await seedClinicalMasters(tx, t.id);
      await ensurePublishedForm(tx, t.id, CONSENT_TEMPLATE_SAMPLE);
      await ensurePublishedForm(tx, t.id, EDUCATION_FORM_SAMPLE);
    });
  } finally {
    await owner.$disconnect();
  }
  return t;
}

let seq = 0;
/** Pasien rawat inap Melati; tim: dokter = DPJP utama, perawat = perawat PJ (relasi akses). */
async function inpatient() {
  const p = await createTestPatient(A.id, { name: 'Pasien Persetujuan Fiktif' });
  seq += 1;
  return run(A.id, async (tx) => {
    const u = (await tx.unit.findFirstOrThrow({ where: { code: 'MELATI' } })).id;
    const enc = await tx.encounter.create({
      data: {
        id: newId(),
        tenantId: A.id,
        number: `RI-2610-${String(Date.now() % 1e5).padStart(5, '0')}${seq}`,
        patientId: p.id,
        encounterClass: 'IMP',
        status: 'in_progress',
        unitId: u,
        plannedAt: new Date(),
      },
    });
    for (const [who, role, kind] of [
      ['dokter', 'dpjp_utama', 'dpjp'],
      ['perawat', 'perawat_pj', 'perawat_penanggung_jawab'],
    ] as const) {
      const pid = newId();
      await tx.encounterParticipant.create({
        data: { id: pid, tenantId: A.id, encounterId: enc.id, userId: users[who] as string, role },
      });
      await tx.accessRelationship.create({
        data: {
          id: newId(),
          tenantId: A.id,
          userId: users[who] as string,
          patientId: p.id,
          kind,
          validFrom: new Date(Date.now() - 60_000),
          sourceType: 'encounter_participant',
          sourceId: pid,
        },
      });
    }
    return { patientId: p.id, encounterId: enc.id };
  });
}

const PROCEDURE = 'Pemasangan kateter vena sentral';
const information = {
  diagnosis: 'Syok septik (R57.2), banding syok hipovolemik',
  tindakan: PROCEDURE,
  tata_cara: 'Kateter dimasukkan lewat vena jugularis dengan panduan USG dan anestesi lokal',
  risiko: 'Nyeri, perdarahan lokal',
  komplikasi: 'Pneumotoraks, infeksi aliran darah',
  alternatif: 'Akses perifer berulang dengan risiko gagal resusitasi',
  prognosis: 'Dubia ad bonam',
};
const draftBody = (over: object = {}) => ({
  templateCode: 'persetujuan_tindakan',
  procedure: PROCEDURE,
  signerKind: 'pasien',
  information,
  explainedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
  ...over,
});
const typed = (name: string, relation: string | null = null) => ({
  name,
  relation,
  method: 'nama',
  imageDocumentId: null,
});
const signaturesBody = (over: object = {}) => ({
  acknowledged: [...CONSENT_INFORMATION_KEYS],
  signer: typed('Pasien Persetujuan Fiktif'),
  familyWitness: typed('Sri Saksi Fiktif', 'Istri'),
  ...over,
});

/** Draf siap final: dibuat perawat, ditandatangani di tablet, diatestasi perawat sebagai saksi. */
async function readyDraft(encounterId: string): Promise<string> {
  const d = await as('perawat').post(`/encounters/${encounterId}/consent-drafts`, draftBody()).expect(201);
  await as('perawat').put(`/consents/drafts/${d.body.id}/signatures`, signaturesBody()).expect(200);
  await as('perawat').post(`/consents/drafts/${d.body.id}/witness`).expect(201);
  return d.body.id as string;
}

beforeAll(async () => {
  app = await createTestApp();
  A = await clinicalTenant();
  B = await clinicalTenant();
  for (const [who, t, role, unitCode] of [
    ['dokter', A, 'dokter', 'MELATI'],
    ['dokterLain', A, 'dokter', 'MELATI'],
    ['residen', A, 'dokter_residen', 'MELATI'],
    ['perawat', A, 'perawat', 'MELATI'],
    ['kasir', A, 'kasir', undefined],
    ['dokterB', B, 'dokter', 'MELATI'],
  ] as const) {
    const unitId = unitCode
      ? (await run(t.id, (tx) => tx.unit.findFirstOrThrow({ where: { code: unitCode } }))).id
      : undefined;
    const user = await createTestUser(t.id, { roles: [{ code: role, unitId }], tenantCode: t.code });
    users[who] = user.id;
    tok[who] = await login(app, user);
  }
});

afterAll(async () => {
  await app?.close();
});

describe('persetujuan tindakan (K11)', () => {
  it('templat P07 tujuh butir terdaftar (formulir lain tidak)', async () => {
    const r = await as('perawat').get('/consents/templates').expect(200);
    const t = (r.body as Array<{ code: string; items: Array<{ key: string }> }>).find(
      (x) => x.code === 'persetujuan_tindakan',
    );
    expect(t?.items.map((i) => i.key)).toEqual([...CONSENT_INFORMATION_KEYS]);
    expect((r.body as Array<{ code: string }>).some((x) => x.code === 'edukasi_terintegrasi')).toBe(false);
  });

  it('draf → tanda tangan PNG di tablet → saksi petugas → dokter memfinalkan → PDF + TTE, versi terkunci', async () => {
    const e = await inpatient();
    const d = await as('perawat')
      .post(`/encounters/${e.encounterId}/consent-drafts`, draftBody())
      .expect(201);
    expect(d.body).toMatchObject({
      status: 'draf',
      templateCode: 'persetujuan_tindakan',
      missing: ['tanda_tangan', 'saksi_petugas'],
      createdBy: { userId: users.perawat },
    });
    expect(d.body.information).toHaveLength(7);

    // Gambar tanda tangan lewat unggahan biner draf (perawat tidak perlu izin dokumen umum); bukan PNG → 415.
    await as('perawat').binary(`/consents/drafts/${d.body.id}/signature-image?slot=signer`, PDF).expect(415);
    const img = await as('perawat')
      .binary(`/consents/drafts/${d.body.id}/signature-image?slot=signer`, PNG)
      .expect(201);
    const signed = await as('perawat')
      .put(
        `/consents/drafts/${d.body.id}/signatures`,
        signaturesBody({
          signer: {
            name: 'Pasien Persetujuan Fiktif',
            relation: null,
            method: 'goresan',
            imageDocumentId: img.body.imageDocumentId,
          },
        }),
      )
      .expect(200);
    expect(signed.body).toMatchObject({ missing: ['saksi_petugas'], signer: { method: 'goresan' } });
    expect(signed.body.signedAt).not.toBeNull();
    const w = await as('perawat').post(`/consents/drafts/${d.body.id}/witness`).expect(201);
    expect(w.body).toMatchObject({ missing: [], staffWitness: { userId: users.perawat } });

    const r = await as('dokter').post(`/consents/drafts/${d.body.id}/finalize`).expect(201);
    expect(r.body).toMatchObject({
      decision: 'setuju',
      effectiveDecision: 'setuju',
      templateCode: 'persetujuan_tindakan',
      locked: true,
      informer: { userId: users.dokter },
      document: { signatureStatus: 'pending' },
    });
    expect(r.body.information).toHaveLength(7);
    expect(r.body.signatures.map((s: { signerKind: string }) => s.signerKind).sort()).toEqual([
      'pasien',
      'saksi_keluarga',
      'saksi_petugas',
    ]);
    expect(
      r.body.signatures.find((s: { signerKind: string }) => s.signerKind === 'saksi_petugas'),
    ).toMatchObject({ staffUserId: users.perawat });
    const doc = await run(A.id, (tx) => tx.document.findUniqueOrThrow({ where: { id: r.body.document.id } }));
    expect(doc).toMatchObject({
      sourceType: 'consents',
      sourceId: r.body.id,
      mimeType: 'application/pdf',
      kind: 'consent',
    });
    const tte = await run(A.id, async (tx) => {
      const sig = await tx.documentSignature.findFirstOrThrow({ where: { documentId: doc.id } });
      return tx.outboxMessage.count({
        where: { operation: 'tte.sign', payload: { path: ['signatureId'], equals: sig.id } },
      });
    });
    expect(tte).toBe(1);
    const event = await run(A.id, (tx) =>
      tx.domainEvent.findFirst({
        where: { name: 'consent.signed', payload: { path: ['consentId'], equals: r.body.id } },
      }),
    );
    expect(event?.payload).toMatchObject({ outcome: 'setuju' });

    // Draf tertutup: final kedua, ubah isi, tanda tangan ulang → 409 CONSENT_CLOSED.
    const closed = await as('dokter').get(`/consents/drafts/${d.body.id}`).expect(200);
    expect(closed.body).toMatchObject({
      status: 'final',
      consentId: r.body.id,
      closedBy: { userId: users.dokter },
    });
    const again = await as('dokter').post(`/consents/drafts/${d.body.id}/finalize`).expect(409);
    expect(again.body.code).toBe('CONSENT_CLOSED');
    const { templateCode: _t, ...content } = draftBody();
    await as('perawat').put(`/consents/drafts/${d.body.id}`, content).expect(409);
    await as('perawat').put(`/consents/drafts/${d.body.id}/signatures`, signaturesBody()).expect(409);

    // Entri final tidak bisa diubah langsung (append-only, juga di DB), dan versi ber-TTE tidak bisa digantikan
    // koreksi (dikunci lewat `ClinicalSigningService.issueSigned` → `RECORD_LOCKED`; perubahan hanya addendum).
    await expect(
      run(A.id, (tx) => tx.consent.update({ where: { id: r.body.id }, data: { procedure: 'Diubah' } })),
    ).rejects.toThrow();
    await expect(
      run(A.id, async (tx) => {
        const v1 = await tx.consent.findUniqueOrThrow({ where: { id: r.body.id } });
        const { id: _id, recordedAt: _r, ...rest } = v1;
        await tx.consent.create({
          data: {
            ...rest,
            information: v1.information as object,
            id: newId(),
            version: 2,
            supersedesId: v1.id,
            correctionReason: 'Koreksi setelah TTE dicoba',
          },
        });
      }),
    ).rejects.toThrow(/RECORD_LOCKED/);
    const list = await as('perawat').get(`/encounters/${e.encounterId}/consents`).expect(200);
    expect(list.body.map((c: { id: string }) => c.id)).toEqual([r.body.id]);
    // Dokumen pasien (P08) yang dibaca komponen dokumen klinis web: PDF persetujuan + PNG tanda tangan, bentuk
    // sesuai kontrak `patientDocumentSchema`.
    const docs = await as('dokter').get(`/patients/${e.patientId}/documents`).expect(200);
    const parsed = patientDocumentSchema.array().parse(docs.body);
    expect(parsed.map((x) => x.kind).sort()).toEqual(['consent', 'consent']);
    expect(parsed.find((x) => x.id === doc.id)?.signatures[0]?.status).toBe('pending');
  });

  it('gambar tanda tangan hanya PNG ≤ 512 KB (SVG 415, besar 413); finalisasi serentak hanya sekali', async () => {
    const e = await inpatient();
    const d = await as('perawat')
      .post(`/encounters/${e.encounterId}/consent-drafts`, draftBody())
      .expect(201);
    const url = `/consents/drafts/${d.body.id}/signature-image?slot=signer`;
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect((await as('perawat').binary(url, svg).expect(415)).body.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    // SVG dengan tipe konten aslinya tidak dibaca sebagai berkas sama sekali.
    await request(app.getHttpServer())
      .post(`/api/v1${url}`)
      .set(bearer(tok.perawat as Tokens))
      .set('Content-Type', 'image/svg+xml')
      .send(svg)
      .expect(415);
    const big = Buffer.concat([PNG, Buffer.alloc(CONSENT_SIGNATURE_MAX_BYTES)]);
    const tooBig = await as('perawat').binary(url, big).expect(413);
    expect(tooBig.body).toMatchObject({ code: 'PAYLOAD_TOO_LARGE', message: 'Berkas maksimal 512 KB' });
    const docs = await run(A.id, (tx) => tx.document.count({ where: { patientId: e.patientId } }));
    expect(docs).toBe(0);

    // Dua dokter berelasi menekan "Finalkan" bersamaan: satu entri, satu PDF, yang lain 409 CONSENT_CLOSED.
    await as('perawat').put(`/consents/drafts/${d.body.id}/signatures`, signaturesBody()).expect(200);
    await as('perawat').post(`/consents/drafts/${d.body.id}/witness`).expect(201);
    const results = await Promise.all([
      as('dokter').post(`/consents/drafts/${d.body.id}/finalize`),
      as('dokter').post(`/consents/drafts/${d.body.id}/finalize`),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(results.find((r) => r.status === 409)?.body.code).toBe('CONSENT_CLOSED');
    const consents = await run(A.id, (tx) => tx.consent.count({ where: { encounterId: e.encounterId } }));
    expect(consents).toBe(1);
  });

  it('finalize tanpa tanda tangan/saksi → 422; saksi diri sendiri 422; ubah isi menghapus tanda tangan', async () => {
    const e = await inpatient();
    const d = await as('perawat')
      .post(`/encounters/${e.encounterId}/consent-drafts`, draftBody())
      .expect(201);
    const none = await as('dokter').post(`/consents/drafts/${d.body.id}/finalize`).expect(422);
    expect(none.body).toMatchObject({
      code: 'CONSENT_SIGNATURES_REQUIRED',
      details: { missing: ['tanda_tangan', 'saksi_petugas'] },
    });
    // Saksi sebelum tanda tangan ditolak.
    await as('perawat').post(`/consents/drafts/${d.body.id}/witness`).expect(422);
    await as('perawat').put(`/consents/drafts/${d.body.id}/signatures`, signaturesBody()).expect(200);
    const noWitness = await as('dokter').post(`/consents/drafts/${d.body.id}/finalize`).expect(422);
    expect(noWitness.body.details).toEqual({ missing: ['saksi_petugas'] });
    // Dokter sebagai saksi atas finalisasinya sendiri → 422.
    await as('dokter').post(`/consents/drafts/${d.body.id}/witness`).expect(201);
    const self = await as('dokter').post(`/consents/drafts/${d.body.id}/finalize`).expect(422);
    expect(self.body.code).toBe('CONSENT_SIGNATURES_REQUIRED');
    // Ubah isi → tanda tangan + atestasi hilang.
    const edited = await as('perawat')
      .put(`/consents/drafts/${d.body.id}`, {
        procedure: PROCEDURE,
        signerKind: 'wali',
        information: { ...information, prognosis: 'Dubia' },
        explainedAt: null,
      })
      .expect(200);
    expect(edited.body).toMatchObject({
      signer: null,
      staffWitness: null,
      missing: ['tanda_tangan', 'saksi_petugas'],
    });
    // Wali tanpa hubungan → 422; butir kurang → 422; goresan tanpa berkas → 400; berkas pasien lain → 422.
    await as('perawat').put(`/consents/drafts/${d.body.id}/signatures`, signaturesBody()).expect(422);
    const { prognosis: _p, ...six } = information;
    await as('perawat')
      .post(`/encounters/${e.encounterId}/consent-drafts`, draftBody({ information: six }))
      .expect(422);
    await as('perawat')
      .put(
        `/consents/drafts/${d.body.id}/signatures`,
        signaturesBody({ signer: { ...typed('Budi Wali Fiktif', 'Anak'), method: 'goresan' } }),
      )
      .expect(400);
    const stranger = await inpatient();
    const png = await as('dokter').upload(stranger.patientId).expect(201);
    await as('perawat')
      .put(
        `/consents/drafts/${d.body.id}/signatures`,
        signaturesBody({
          signer: {
            name: 'Budi Wali Fiktif',
            relation: 'Anak',
            method: 'goresan',
            imageDocumentId: png.body.id,
          },
        }),
      )
      .expect(422);
    // Wali dengan hubungan + saksi perawat → final sah; waktu penjelasan kosong = waktu tanda tangan.
    await as('perawat')
      .put(
        `/consents/drafts/${d.body.id}/signatures`,
        signaturesBody({ signer: typed('Budi Wali Fiktif', 'Anak') }),
      )
      .expect(200);
    await as('perawat').post(`/consents/drafts/${d.body.id}/witness`).expect(201);
    const ok = await as('dokter').post(`/consents/drafts/${d.body.id}/finalize`).expect(201);
    expect(ok.body.signatures.map((s: { signerKind: string }) => s.signerKind)).toContain('wali');
  });

  it('izin + ABAC: perawat/residen tidak bisa memfinalkan atau menolak; dokter tanpa relasi 403; residen tidak membuat draf', async () => {
    const e = await inpatient();
    const id = await readyDraft(e.encounterId);
    await as('perawat').post(`/consents/drafts/${id}/finalize`).expect(403);
    await as('residen').post(`/consents/drafts/${id}/finalize`).expect(403);
    await as('perawat')
      .post(`/consents/drafts/${id}/refuse`, { reason: 'Pasien menolak tindakan ini' })
      .expect(403);
    await as('residen').post(`/encounters/${e.encounterId}/consent-drafts`, draftBody()).expect(403);
    // Dokter lain di unit yang sama bukan DPJP/rawat bersama: lingkup `consent.sign` = relasi → 403 + audit.
    const denied = await as('dokterLain').post(`/consents/drafts/${id}/finalize`).expect(403);
    expect(denied.body.details).toMatchObject({ breakGlassAvailable: true });
    const audit = await run(A.id, (tx) =>
      tx.auditEvent.findFirst({
        where: { action: 'access_denied', actorUserId: users.dokterLain, patientId: e.patientId },
      }),
    );
    expect(audit).not.toBeNull();
    // Dokter lain tetap bisa membaca draf lewat lingkup unit (`consent.read`).
    await as('dokterLain').get(`/consents/drafts/${id}`).expect(200);
    await as('dokter').post(`/consents/drafts/${id}/finalize`).expect(201);
  });

  it('penolakan beralasan → dokumen penolakan + TTE; alasan pendek 400; draf ditolak', async () => {
    const e = await inpatient();
    const d = await as('perawat')
      .post(`/encounters/${e.encounterId}/consent-drafts`, draftBody())
      .expect(201);
    await as('dokter').post(`/consents/drafts/${d.body.id}/refuse`, { reason: 'pendek' }).expect(400);
    const r = await as('dokter')
      .post(`/consents/drafts/${d.body.id}/refuse`, {
        reason: 'Pasien ingin mendiskusikan dengan keluarga di luar kota',
      })
      .expect(201);
    expect(r.body).toMatchObject({
      decision: 'tolak',
      refusalReason: expect.stringContaining('keluarga'),
      locked: true,
      signatures: [],
      document: { signatureStatus: 'pending' },
    });
    const doc = await run(A.id, (tx) => tx.document.findUniqueOrThrow({ where: { id: r.body.document.id } }));
    expect(doc.title).toBe('Penolakan tindakan kedokteran');
    const audit = await run(A.id, (tx) =>
      tx.auditEvent.findFirst({ where: { action: 'sign', resourceId: r.body.id } }),
    );
    expect(audit).toMatchObject({ patientId: e.patientId });
    const draft = await as('perawat').get(`/consents/drafts/${d.body.id}`).expect(200);
    expect(draft.body).toMatchObject({ status: 'ditolak', consentId: r.body.id, missing: [] });
    await as('dokter').post(`/consents/drafts/${d.body.id}/finalize`).expect(409);
  });

  it('pencabutan = entri baru dicabut ber-TTE; status berlaku dicabut; tidak bisa dicabut dua kali; perawat 403', async () => {
    const e = await inpatient();
    const id = await readyDraft(e.encounterId);
    const c = await as('dokter').post(`/consents/drafts/${id}/finalize`).expect(201);
    const revokeBody = {
      reason: 'Pasien berubah pikiran setelah konsultasi keluarga',
      signerKind: 'pasien',
      signer: typed('Pasien Persetujuan Fiktif'),
      familyWitness: null,
    };
    await as('perawat').post(`/consents/${c.body.id}/revoke`, revokeBody).expect(403);
    const rv = await as('dokter').post(`/consents/${c.body.id}/revoke`, revokeBody).expect(201);
    expect(rv.body).toMatchObject({
      decision: 'dicabut',
      addendumOf: c.body.id,
      locked: true,
      document: { signatureStatus: 'pending' },
    });
    expect(rv.body.id).not.toBe(c.body.id);
    const list = await as('dokter').get(`/encounters/${e.encounterId}/consents`).expect(200);
    const original = (list.body as Array<{ id: string; effectiveDecision: string }>).find(
      (x) => x.id === c.body.id,
    );
    expect(original?.effectiveDecision).toBe('dicabut');
    expect((await as('dokter').post(`/consents/${c.body.id}/revoke`, revokeBody)).status).toBe(409);
    // Penolakan tidak bisa dicabut (hanya persetujuan).
    const e2 = await inpatient();
    const d2 = await as('perawat')
      .post(`/encounters/${e2.encounterId}/consent-drafts`, draftBody())
      .expect(201);
    const refused = await as('dokter')
      .post(`/consents/drafts/${d2.body.id}/refuse`, { reason: 'Pasien menolak setelah penjelasan' })
      .expect(201);
    await as('dokter').post(`/consents/${refused.body.id}/revoke`, revokeBody).expect(409);
  });

  it('batal draf beralasan; draf batal tidak bisa difinalkan', async () => {
    const e = await inpatient();
    const id = await readyDraft(e.encounterId);
    await as('perawat').post(`/consents/drafts/${id}/cancel`, { reason: 'pendek' }).expect(400);
    const r = await as('perawat')
      .post(`/consents/drafts/${id}/cancel`, { reason: 'Tindakan dijadwal ulang oleh DPJP' })
      .expect(201);
    expect(r.body).toMatchObject({ status: 'batal', cancelReason: 'Tindakan dijadwal ulang oleh DPJP' });
    await as('dokter').post(`/consents/drafts/${id}/finalize`).expect(409);
    const drafts = await as('perawat').get(`/encounters/${e.encounterId}/consent-drafts`).expect(200);
    expect(drafts.body.map((x: { status: string }) => x.status)).toEqual(['batal']);
    expect((await as('perawat').get(`/encounters/${e.encounterId}/consents`).expect(200)).body).toEqual([]);
  });

  it('isolasi tenant + izin baca: kasir 403, tenant lain 404; edukasi lewat P07 dengan encounterId', async () => {
    const e = await inpatient();
    const id = await readyDraft(e.encounterId);
    await as('kasir').get(`/encounters/${e.encounterId}/consents`).expect(403);
    await as('kasir').get(`/consents/drafts/${id}`).expect(403);
    await as('dokterB').get(`/encounters/${e.encounterId}/consents`).expect(404);
    await as('dokterB').get(`/encounters/${e.encounterId}/consent-drafts`).expect(404);
    await as('dokterB').get(`/consents/drafts/${id}`).expect(404);
    await as('dokterB').post(`/consents/drafts/${id}/finalize`).expect(404);
    await as('dokterB').post(`/encounters/${e.encounterId}/consent-drafts`, draftBody()).expect(404);
    const fromB = await run(B.id, (tx) => tx.consentDraft.count({ where: { id } }));
    expect(fromB).toBe(0);
    const edu = await as('perawat')
      .post(`/patients/${e.patientId}/forms/edukasi_terintegrasi/responses`, {
        answers: { topik: ['obat', 'nyeri'], sasaran: 'keduanya', evaluasi: 'paham' },
        encounterId: e.encounterId,
      })
      .expect(201);
    expect(edu.body.encounterId).toBe(e.encounterId);
    const assessments = await as('dokter').get(`/encounters/${e.encounterId}/assessments`).expect(200);
    expect(assessments.body.map((a: { formCode: string }) => a.formCode)).toEqual(['edukasi_terintegrasi']);
  });
});
