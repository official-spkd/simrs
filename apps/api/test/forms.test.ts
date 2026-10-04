/**
 * P07 · Form engine lewat API: siklus definisi (draf → ajukan → terbit, versi lama diarsipkan), isian dengan
 * hak tulis per profesi + ABAC, koreksi berversi beralasan (append-only), diff, dan tampilannya di detail Audit.
 * Kriteria fase 1: "Koreksi form_response menghasilkan versi baru dengan alasan; diff tampil".
 */
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ensurePublishedForm, withTenant } from '@simrs/db';
import { MORSE_FALL_SCALE, newId } from '@simrs/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
let T: { id: string; code: string };
const u: Record<string, TestUser> = {};
const tok: Record<string, Tokens> = {};
let patientId: string;
const http = () => request(app.getHttpServer());
const as = (who: string) => {
  const auth = () => bearer(tok[who] as Tokens);
  return {
    get: (url: string) => http().get(url).set(auth()),
    post: (url: string, body: object = {}) => http().post(url).set(auth()).send(body),
    put: (url: string, body: object) => http().put(url).set(auth()).send(body),
  };
};

const MORSE_HIGH = {
  q_riwayat_jatuh: 'ya',
  q_diag_sekunder: 'ya',
  q_alat_bantu: 'furnitur',
  q_infus: 'tidak',
  q_gaya_jalan: 'normal',
  q_mental: 'sadar',
};

const audits = (where: Record<string, unknown>) =>
  withTenant(testDb(), T.id, (tx) => tx.auditEvent.findMany({ where, orderBy: { seq: 'asc' } }));

beforeAll(async () => {
  app = await createTestApp();
  T = await createTestTenant();
  for (const [who, role] of [
    ['rm', 'petugas_rm'],
    ['perawat', 'perawat'],
    ['perawat2', 'perawat'],
    ['dokter', 'dokter'],
    ['kasir', 'kasir'],
    ['privasi', 'petugas_privasi'],
  ] as const) {
    u[who] = await createTestUser(T.id, { roles: [{ code: role }], tenantCode: T.code });
    tok[who] = await login(app, u[who] as TestUser);
  }
  await withTenant(testDb(), T.id, (tx) => ensurePublishedForm(tx, T.id, MORSE_FALL_SCALE));
  patientId = (await createTestPatient(T.id)).id;
  await withTenant(testDb(), T.id, async (tx) => {
    for (const who of ['perawat', 'perawat2', 'dokter'] as const) {
      await tx.accessRelationship.create({
        data: { id: newId(), tenantId: T.id, userId: u[who]?.id as string, patientId, kind: 'petugas_unit' },
      });
    }
  });
});

afterAll(async () => {
  await app.close();
});

describe('definisi formulir (komite rekam medis)', () => {
  const schema = {
    sections: [
      {
        title: 'Skrining nyeri',
        fields: [
          {
            key: 'nyeri',
            type: 'single',
            label: '',
            required: true,
            options: [
              { value: 'ya', label: 'Ya' },
              { value: 'tidak', label: 'Tidak' },
            ],
          },
        ],
      },
    ],
  };

  it('draf → ajukan (label wajib) → terbit; draf v2 → terbit, v1 diarsipkan; riwayat versi', async () => {
    await as('rm')
      .post('/api/v1/forms', {
        code: 'skrining_nyeri',
        title: 'Skrining nyeri',
        category: 'keperawatan',
        schema,
        writeRoles: ['perawat'],
        changeNote: 'Formulir baru',
      })
      .expect(201);
    await as('rm')
      .post('/api/v1/forms', {
        code: 'skrining_nyeri',
        title: 'Duplikat',
        category: 'umum',
        schema,
        writeRoles: ['perawat'],
        changeNote: 'Ganda',
      })
      .expect(409);
    const notReady = await as('rm').post('/api/v1/forms/skrining_nyeri/submit').expect(400);
    expect(notReady.body.message).toMatch(/1 field belum berlabel/);

    const labelled = structuredClone(schema);
    (labelled.sections[0]?.fields[0] as { label: string }).label = 'Ada nyeri?';
    await as('rm').put('/api/v1/forms/skrining_nyeri/draft', { schema: labelled }).expect(200);
    await as('rm').post('/api/v1/forms/skrining_nyeri/submit').expect(200);
    await as('rm').put('/api/v1/forms/skrining_nyeri/draft', { title: 'Ubah saat diajukan' }).expect(409);
    await as('rm').post('/api/v1/forms/skrining_nyeri/publish').expect(200);

    const v2 = await as('rm')
      .post('/api/v1/forms/skrining_nyeri/drafts', { changeNote: 'Tambah skala' })
      .expect(201);
    expect(v2.body).toMatchObject({ version: 2, status: 'draft', schema: labelled });
    await as('rm').post('/api/v1/forms/skrining_nyeri/drafts', { changeNote: 'Draf kedua' }).expect(409);
    // Dua anggota komite membuka draf yang sama: simpanan kedua tidak boleh menimpa diam-diam.
    const saved = await as('rm')
      .put('/api/v1/forms/skrining_nyeri/draft', {
        baseUpdatedAt: v2.body.updatedAt,
        title: 'Skrining nyeri v2',
      })
      .expect(200);
    const stale = await as('rm')
      .put('/api/v1/forms/skrining_nyeri/draft', { baseUpdatedAt: v2.body.updatedAt, title: 'Menimpa' })
      .expect(409);
    expect(stale.body.message).toMatch(/diubah pengguna lain/);
    await as('rm')
      .post('/api/v1/forms/skrining_nyeri/submit', { baseUpdatedAt: v2.body.updatedAt })
      .expect(409);
    const submitted = await as('rm')
      .post('/api/v1/forms/skrining_nyeri/submit', { baseUpdatedAt: saved.body.updatedAt })
      .expect(200);
    await as('rm').post('/api/v1/forms/skrining_nyeri/withdraw').expect(200);
    await as('rm').post('/api/v1/forms/skrining_nyeri/publish').expect(409);
    await as('rm').post('/api/v1/forms/skrining_nyeri/submit').expect(200);
    // Penerbit melihat pengajuan lama (sebelum ditarik-ajukan ulang): ditolak, harus melihat versi terbaru.
    await as('rm')
      .post('/api/v1/forms/skrining_nyeri/publish', { baseUpdatedAt: submitted.body.updatedAt })
      .expect(409);
    await as('rm').post('/api/v1/forms/skrining_nyeri/publish').expect(200);

    const res = await as('rm').get('/api/v1/forms/skrining_nyeri').expect(200);
    expect(res.body.published).toMatchObject({ version: 2, status: 'published', title: 'Skrining nyeri v2' });
    expect(res.body.draft).toBeNull();
    expect(res.body.history.map((h: { version: number; status: string }) => [h.version, h.status])).toEqual([
      [2, 'published'],
      [1, 'archived'],
    ]);
    const list = await as('perawat').get('/api/v1/forms').expect(200);
    expect(list.body.find((f: { code: string }) => f.code === 'skrining_nyeri')).toMatchObject({
      published: { version: 2 },
      draft: null,
    });
    const actions = (await audits({ resourceType: 'form_definition' })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['create', 'update', 'submit', 'publish']));
  });

  it('perawat hanya membaca definisi; peran tak dikenal di hak tulis ditolak', async () => {
    await as('perawat')
      .post('/api/v1/forms', {
        code: 'form_perawat',
        title: 'Tidak boleh',
        category: 'umum',
        schema,
        writeRoles: ['perawat'],
        changeNote: 'x',
      })
      .expect(403);
    await as('rm')
      .post('/api/v1/forms', {
        code: 'form_peran_aneh',
        title: 'Peran aneh',
        category: 'umum',
        schema,
        writeRoles: ['tukang_sihir'],
        changeNote: 'Uji peran',
      })
      .expect(400);
  });
});

describe('isian formulir pasien', () => {
  it('perawat berelasi mengisi Morse: skor + kategori; isian tidak lengkap ditolak per field', async () => {
    const bad = await as('perawat')
      .post(`/api/v1/patients/${patientId}/forms/morse_dewasa/responses`, {
        answers: { q_riwayat_jatuh: 'ya' },
      })
      .expect(400);
    expect(bad.body.details.fields).toHaveProperty('q_mental');
    const res = await as('perawat')
      .post(`/api/v1/patients/${patientId}/forms/morse_dewasa/responses`, { answers: MORSE_HIGH })
      .expect(201);
    expect(res.body.current).toMatchObject({
      version: 1,
      score: 70,
      scoreBand: 'Risiko tinggi',
      changes: [],
    });
    expect(res.body.formVersion).toBe(1);
    const [created] = await audits({ action: 'create', resourceType: 'form_response', patientId });
    expect(created?.details).toEqual({ form: 'morse_dewasa' });
  });

  it('hak tulis per profesi: dokter (bukan penulis Morse) dan kasir ditolak; penolakan dokter tercatat', async () => {
    await as('dokter')
      .post(`/api/v1/patients/${patientId}/forms/morse_dewasa/responses`, { answers: MORSE_HIGH })
      .expect(403);
    const [denied] = await audits({
      action: 'access_denied',
      resourceType: 'form_response',
      actorUserId: u.dokter?.id,
    });
    expect(denied).toMatchObject({ patientId, details: { form: 'morse_dewasa', role: 'dokter' } });
    await as('kasir')
      .post(`/api/v1/patients/${patientId}/forms/morse_dewasa/responses`, { answers: MORSE_HIGH })
      .expect(403);
  });

  it('koreksi = versi baru beralasan + diff; versi lama tetap; koreksi versi usang dan serentak ditolak', async () => {
    const created = await as('perawat')
      .post(`/api/v1/patients/${patientId}/forms/morse_dewasa/responses`, { answers: MORSE_HIGH })
      .expect(201);
    const v1 = created.body.current.id;
    await as('perawat')
      .post(`/api/v1/form-responses/${v1}/corrections`, {
        answers: MORSE_HIGH,
        reason: 'Tidak ada perubahan apa pun',
      })
      .expect(400);
    await as('perawat')
      .post(`/api/v1/form-responses/${v1}/corrections`, {
        answers: { ...MORSE_HIGH, q_alat_bantu: 'kruk' },
        reason: 'pendek',
      })
      .expect(400);
    const corrected = await as('perawat')
      .post(`/api/v1/form-responses/${v1}/corrections`, {
        answers: { ...MORSE_HIGH, q_alat_bantu: 'kruk' },
        reason: 'Salah pilih alat bantu saat entri, dikonfirmasi ulang dengan pasien',
      })
      .expect(201);
    expect(corrected.body.versions.map((v: { version: number }) => v.version)).toEqual([1, 2]);
    expect(corrected.body.current).toMatchObject({
      version: 2,
      score: 55,
      correctionReason: 'Salah pilih alat bantu saat entri, dikonfirmasi ulang dengan pasien',
      changes: [
        {
          key: 'q_alat_bantu',
          label: 'Alat bantu berjalan',
          before: 'Berpegangan pada furnitur',
          after: 'Kruk / tongkat / walker',
        },
      ],
    });
    // Versi 1 usang: koreksi harus atas versi terbaru.
    await as('perawat')
      .post(`/api/v1/form-responses/${v1}/corrections`, {
        answers: { ...MORSE_HIGH, q_mental: 'lupa' },
        reason: 'Koreksi atas versi yang sudah usang',
      })
      .expect(409);

    const v2 = corrected.body.current.id;
    const both = await Promise.all([
      as('perawat').post(`/api/v1/form-responses/${v2}/corrections`, {
        answers: { ...MORSE_HIGH, q_alat_bantu: 'kruk', q_mental: 'lupa' },
        reason: 'Status mental berubah setelah observasi ulang',
      }),
      as('perawat2').post(`/api/v1/form-responses/${v2}/corrections`, {
        answers: { ...MORSE_HIGH, q_alat_bantu: 'kruk', q_infus: 'ya' },
        reason: 'Infus terpasang sejak pagi, belum tercatat',
      }),
    ]);
    expect(both.map((r) => r.status).sort()).toEqual([201, 409]);

    const list = await as('perawat')
      .get(`/api/v1/patients/${patientId}/form-responses?code=morse_dewasa`)
      .expect(200);
    const mine = list.body.find((r: { rootId: string }) => r.rootId === v1);
    expect(mine).toMatchObject({ version: 3, formTitle: 'Asesmen risiko jatuh dewasa (Morse)' });
  });

  it('daftar isian membaca kelompok rekam medis: isian di RM lama yang digabung ikut tampil', async () => {
    const old = (await createTestPatient(T.id)).id;
    await withTenant(testDb(), T.id, (tx) =>
      tx.accessRelationship.create({
        data: {
          id: newId(),
          tenantId: T.id,
          userId: u.perawat?.id as string,
          patientId: old,
          kind: 'petugas_unit',
        },
      }),
    );
    const onOld = await as('perawat')
      .post(`/api/v1/patients/${old}/forms/morse_dewasa/responses`, { answers: MORSE_HIGH })
      .expect(201);
    const before = await as('perawat').get(`/api/v1/patients/${patientId}/form-responses`).expect(200);
    expect(before.body.some((r: { id: string }) => r.id === onOld.body.current.id)).toBe(false);

    await withTenant(testDb(), T.id, (tx) =>
      tx.patient.update({
        where: { id: old },
        data: { status: 'merged', mergedIntoId: patientId, mergedAt: new Date() },
      }),
    );
    const after = await as('perawat').get(`/api/v1/patients/${patientId}/form-responses`).expect(200);
    expect(after.body.find((r: { id: string }) => r.id === onOld.body.current.id)).toMatchObject({
      patientId: old,
      formCode: 'morse_dewasa',
    });
    // Isian baru untuk RM yang sudah digabung diarahkan ke RM tujuan.
    await as('perawat')
      .post(`/api/v1/patients/${old}/forms/morse_dewasa/responses`, { answers: MORSE_HIGH })
      .expect(409);
  });

  it('salah entri: versi baru berstatus entered_in_error; tidak bisa dikoreksi lagi', async () => {
    const created = await as('perawat')
      .post(`/api/v1/patients/${patientId}/forms/morse_dewasa/responses`, { answers: MORSE_HIGH })
      .expect(201);
    const voided = await as('perawat')
      .post(`/api/v1/form-responses/${created.body.current.id}/void`, {
        reason: 'Diisi untuk pasien yang salah, dibatalkan',
      })
      .expect(200);
    expect(voided.body.current).toMatchObject({ version: 2, status: 'entered_in_error' });
    await as('perawat')
      .post(`/api/v1/form-responses/${voided.body.current.id}/corrections`, {
        answers: { ...MORSE_HIGH, q_infus: 'ya' },
        reason: 'Mencoba mengoreksi isian salah entri',
      })
      .expect(409);
  });

  it('isian lama tetap memakai versi formulir saat diisi walau formulir diperbarui', async () => {
    const created = await as('perawat')
      .post(`/api/v1/patients/${patientId}/forms/morse_dewasa/responses`, { answers: MORSE_HIGH })
      .expect(201);
    await as('rm')
      .post('/api/v1/forms/morse_dewasa/drafts', { changeNote: 'Tambah bundle pencegahan' })
      .expect(201);
    await as('rm').post('/api/v1/forms/morse_dewasa/submit').expect(200);
    await as('rm').post('/api/v1/forms/morse_dewasa/publish').expect(200);
    const corrected = await as('perawat')
      .post(`/api/v1/form-responses/${created.body.current.id}/corrections`, {
        answers: { ...MORSE_HIGH, q_gaya_jalan: 'lemah' },
        reason: 'Cara berjalan dinilai ulang oleh perawat jaga',
      })
      .expect(201);
    expect(corrected.body.formVersion).toBe(1);
  });
});

describe('diff koreksi di detail Audit', () => {
  it('petugas privasi melihat alasan, penulis asli, pengoreksi, dan −v1/+v2; pembukaan tercatat', async () => {
    const created = await as('perawat')
      .post(`/api/v1/patients/${patientId}/forms/morse_dewasa/responses`, { answers: MORSE_HIGH })
      .expect(201);
    const corrected = await as('perawat2')
      .post(`/api/v1/form-responses/${created.body.current.id}/corrections`, {
        answers: { ...MORSE_HIGH, q_riwayat_jatuh: 'tidak' },
        reason: 'Riwayat jatuh salah dicatat, keluarga mengonfirmasi tidak pernah jatuh',
      })
      .expect(201);
    const [event] = await audits({ action: 'correct', resourceId: corrected.body.current.id });
    expect(event).toMatchObject({
      patientId,
      reason: 'Riwayat jatuh salah dicatat, keluarga mengonfirmasi tidak pernah jatuh',
      details: { form: 'morse_dewasa', from: 1, to: 2, status: 'final', fields: ['q_riwayat_jatuh'] },
    });

    const detail = await as('privasi').get(`/api/v1/audit/events/${event?.seq}`).expect(200);
    expect(detail.body.change).toMatchObject({
      formTitle: 'Asesmen risiko jatuh dewasa (Morse)',
      fromVersion: 1,
      toVersion: 2,
      originalAuthor: 'Pengguna Uji Fiktif',
      correctedBy: 'Pengguna Uji Fiktif',
      rows: [{ key: 'q_riwayat_jatuh', label: 'Riwayat jatuh dalam 3 bulan', before: 'Ya', after: 'Tidak' }],
    });
    const reads = await audits({ action: 'read', resourceType: 'form_response', actorUserId: u.privasi?.id });
    expect(reads.at(-1)).toMatchObject({ patientId, details: { via: 'audit' } });
  });
});
