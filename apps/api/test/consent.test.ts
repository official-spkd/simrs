/**
 * Fase 3 · potongan 3.7 · persetujuan/penolakan tindakan tablet (K11): templat P07 tujuh butir informasi, tanda tangan
 * pasien/wali (PNG unggahan biner atau ketik nama) + saksi keluarga + atestasi saksi petugas (sesi petugas itu,
 * sekali pakai), final hanya dokter (`consent.sign`) → PDF + TTE (versi terkunci), penolakan beralasan, pencabutan =
 * addendum ber-TTE, edukasi lewat P07, izin + isolasi tenant. Data fiktif.
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
import { CONSENT_TEMPLATE_SAMPLE, EDUCATION_FORM_SAMPLE, newId } from '@simrs/shared';
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

const run = <R>(tenantId: string, fn: (tx: TenantTx) => Promise<R>) => withTenant(testDb(), tenantId, fn);
const as = (who: string) => {
  const auth = () => bearer(tok[who] as Tokens);
  const http = () => request(app.getHttpServer());
  return {
    get: (url: string) => http().get(`/api/v1${url}`).set(auth()),
    post: (url: string, body: object = {}) => http().post(`/api/v1${url}`).set(auth()).send(body),
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
const consentBody = (encounterId: string, over: object = {}) => ({
  encounterId,
  templateCode: 'persetujuan_tindakan',
  procedure: PROCEDURE,
  explainedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
  information,
  decision: 'setuju',
  refusalReason: null,
  signerKind: 'pasien',
  signer: { name: 'Pasien Persetujuan Fiktif', relation: null, method: 'nama', imageDocumentId: null },
  familyWitness: { name: 'Sri Saksi Fiktif', relation: 'Istri', method: 'nama', imageDocumentId: null },
  staffWitnessUserId: users.perawat,
  ...over,
});
const witness = (who: string, encounterId: string, procedure = PROCEDURE) =>
  as(who).post(`/encounters/${encounterId}/consent-witness`, { procedure });

beforeAll(async () => {
  app = await createTestApp();
  A = await clinicalTenant();
  B = await clinicalTenant();
  for (const [who, t, role, unitCode] of [
    ['dokter', A, 'dokter', 'MELATI'],
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
  it('templat P07 tujuh butir terdaftar', async () => {
    const r = await as('perawat').get('/consents/templates').expect(200);
    const t = (r.body as Array<{ code: string; items: Array<{ key: string }> }>).find(
      (x) => x.code === 'persetujuan_tindakan',
    );
    expect(t?.items.map((i) => i.key)).toEqual([
      'diagnosis',
      'tindakan',
      'tata_cara',
      'risiko',
      'komplikasi',
      'alternatif',
      'prognosis',
    ]);
    expect((r.body as Array<{ code: string }>).some((x) => x.code === 'edukasi_terintegrasi')).toBe(false);
  });

  it('saksi petugas beratestasi → dokter memfinalkan (PNG + ketik nama) → PDF + TTE, versi terkunci; atestasi sekali pakai', async () => {
    const e = await inpatient();
    const png = await as('dokter').upload(e.patientId).expect(201);
    expect(png.body.mimeType).toBe('image/png');
    const att = await witness('perawat', e.encounterId).expect(201);
    expect(att.body).toMatchObject({ witnessUserId: users.perawat, procedure: PROCEDURE });

    const r = await as('dokter')
      .post(
        '/consents',
        consentBody(e.encounterId, {
          signer: {
            name: 'Pasien Persetujuan Fiktif',
            relation: null,
            method: 'goresan',
            imageDocumentId: png.body.id,
          },
        }),
      )
      .expect(201);
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
    ).toMatchObject({
      staffUserId: users.perawat,
    });
    const doc = await run(A.id, (tx) => tx.document.findUniqueOrThrow({ where: { id: r.body.document.id } }));
    expect(doc).toMatchObject({
      sourceType: 'consents',
      sourceId: r.body.id,
      mimeType: 'application/pdf',
      kind: 'consent',
    });
    const tte = await run(A.id, (tx) => tx.outboxMessage.count({ where: { operation: 'tte.sign' } }));
    expect(tte).toBeGreaterThanOrEqual(1);
    const event = await run(A.id, (tx) =>
      tx.domainEvent.findFirst({
        where: { name: 'consent.signed', payload: { path: ['consentId'], equals: r.body.id } },
      }),
    );
    expect(event?.payload).toMatchObject({ outcome: 'setuju' });

    // Atestasi sudah dipakai: final kedua tanpa atestasi baru → 422.
    const again = await as('dokter').post('/consents', consentBody(e.encounterId));
    expect(again.status).toBe(422);
    const list = await as('perawat').get(`/encounters/${e.encounterId}/consents`).expect(200);
    expect(list.body.map((c: { id: string }) => c.id)).toEqual([r.body.id]);
  });

  it('final ditolak tanpa saksi petugas, saksi diri sendiri, butir kurang; perawat/residen tidak bisa memfinalkan', async () => {
    const e = await inpatient();
    expect((await as('dokter').post('/consents', consentBody(e.encounterId))).status).toBe(422);
    await witness('perawat', e.encounterId).expect(201);
    const self = await as('dokter').post(
      '/consents',
      consentBody(e.encounterId, { staffWitnessUserId: users.dokter }),
    );
    expect(self.status).toBe(422);
    const { prognosis: _p, ...six } = information;
    const missing = await as('dokter').post('/consents', consentBody(e.encounterId, { information: six }));
    expect(missing.status).toBe(422);
    // Atestasi untuk tindakan lain tidak berlaku.
    const other = await as('dokter').post(
      '/consents',
      consentBody(e.encounterId, { procedure: 'Pungsi lumbal' }),
    );
    expect(other.status).toBe(422);
    await as('perawat').post('/consents', consentBody(e.encounterId)).expect(403);
    await as('residen').post('/consents', consentBody(e.encounterId)).expect(403);
    // Tanda tangan goresan tanpa berkas → 400; berkas bukan milik pasien → 422.
    await as('dokter')
      .post(
        '/consents',
        consentBody(e.encounterId, {
          signer: {
            name: 'Pasien Persetujuan Fiktif',
            relation: null,
            method: 'goresan',
            imageDocumentId: null,
          },
        }),
      )
      .expect(400);
    const stranger = await inpatient();
    const png = await as('dokter').upload(stranger.patientId).expect(201);
    const wrong = await as('dokter').post(
      '/consents',
      consentBody(e.encounterId, {
        signer: {
          name: 'Pasien Persetujuan Fiktif',
          relation: null,
          method: 'goresan',
          imageDocumentId: png.body.id,
        },
      }),
    );
    expect(wrong.status).toBe(422);
    // Wali wajib hubungan.
    await as('dokter')
      .post(
        '/consents',
        consentBody(e.encounterId, {
          signerKind: 'wali',
          signer: { name: 'Budi Wali Fiktif', relation: null, method: 'nama', imageDocumentId: null },
        }),
      )
      .expect(400);
    // Atestasi masih utuh (semua di atas gagal) → final sah.
    await as('dokter').post('/consents', consentBody(e.encounterId)).expect(201);
  });

  it('penolakan beralasan → PDF penolakan + TTE; tanpa alasan 400', async () => {
    const e = await inpatient();
    await as('dokter')
      .post('/consents', consentBody(e.encounterId, { decision: 'tolak', refusalReason: 'pendek' }))
      .expect(400);
    await witness('perawat', e.encounterId).expect(201);
    const r = await as('dokter')
      .post(
        '/consents',
        consentBody(e.encounterId, {
          decision: 'tolak',
          refusalReason: 'Pasien ingin mendiskusikan dengan keluarga di luar kota',
        }),
      )
      .expect(201);
    expect(r.body).toMatchObject({ decision: 'tolak', refusalReason: expect.stringContaining('keluarga') });
    const doc = await run(A.id, (tx) => tx.document.findUniqueOrThrow({ where: { id: r.body.document.id } }));
    expect(doc.title).toBe('Penolakan tindakan kedokteran');
    const audit = await run(A.id, (tx) =>
      tx.auditEvent.findFirst({ where: { action: 'sign', resourceId: r.body.id } }),
    );
    expect(audit).toMatchObject({ patientId: e.patientId });
  });

  it('pencabutan = addendum dicabut ber-TTE; status berlaku persetujuan menjadi dicabut; tidak bisa dicabut dua kali', async () => {
    const e = await inpatient();
    await witness('perawat', e.encounterId).expect(201);
    const c = await as('dokter').post('/consents', consentBody(e.encounterId)).expect(201);
    const revokeBody = {
      reason: 'Pasien berubah pikiran setelah konsultasi keluarga',
      signerKind: 'pasien',
      signer: { name: 'Pasien Persetujuan Fiktif', relation: null, method: 'nama', imageDocumentId: null },
      familyWitness: null,
      staffWitnessUserId: users.perawat,
    };
    expect((await as('dokter').post(`/consents/${c.body.id}/revoke`, revokeBody)).status).toBe(422);
    await witness('perawat', e.encounterId).expect(201);
    const rv = await as('dokter').post(`/consents/${c.body.id}/revoke`, revokeBody).expect(201);
    expect(rv.body).toMatchObject({
      decision: 'dicabut',
      addendumOf: c.body.id,
      document: { signatureStatus: 'pending' },
    });
    const list = await as('dokter').get(`/encounters/${e.encounterId}/consents`).expect(200);
    const original = (list.body as Array<{ id: string; effectiveDecision: string }>).find(
      (x) => x.id === c.body.id,
    );
    expect(original?.effectiveDecision).toBe('dicabut');
    await witness('perawat', e.encounterId).expect(201);
    expect((await as('dokter').post(`/consents/${c.body.id}/revoke`, revokeBody)).status).toBe(409);
  });

  it('izin + isolasi: kasir 403, tenant lain 404; edukasi lewat P07 dengan encounterId', async () => {
    const e = await inpatient();
    await as('kasir').get(`/encounters/${e.encounterId}/consents`).expect(403);
    await as('dokterB').get(`/encounters/${e.encounterId}/consents`).expect(404);
    await as('dokterB')
      .post(`/encounters/${e.encounterId}/consent-witness`, { procedure: PROCEDURE })
      .expect(404);
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
