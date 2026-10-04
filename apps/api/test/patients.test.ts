/**
 * P05 · Master Patient Index lewat API: pendaftaran, pencarian, detail, buka identitas utuh, perubahan
 * identitas, izin per peran + ABAC relasi, audit setiap pasien yang tampil, dan isolasi tenant.
 * Tenant fiktif baru agar hasil pencarian pasti.
 */
import type { NestExpressApplication } from '@nestjs/platform-express';
import { verifyAuditChain, withTenant } from '@simrs/db';
import { newId } from '@simrs/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bearer,
  createTestApp,
  createTestPatient,
  createTestTenant,
  createTestUser,
  jsonText,
  login,
  TENANT_B,
  type TestUser,
  testDb,
  type Tokens,
} from './helpers';

let app: NestExpressApplication;
let T: { id: string; code: string };
const u: Record<string, TestUser> = {};
const tok: Record<string, Tokens> = {};
const http = () => request(app.getHttpServer());
const as = (who: string) => {
  const auth = () => bearer(tok[who] as Tokens);
  return {
    get: (url: string) => http().get(url).set(auth()),
    post: (url: string, body: object) => http().post(url).set(auth()).send(body),
    patch: (url: string, body: object) => http().patch(url).set(auth()).send(body),
    put: (url: string, body: object) => http().put(url).set(auth()).send(body),
  };
};

/** NIK fiktif unik per tes (awalan 9999, struktur tanggal lahir perempuan 14-03-72). */
const nik = () => `99990154037${String(Math.floor(Math.random() * 100_000)).padStart(5, '0')}`;

const audits = (where: Record<string, unknown>) =>
  withTenant(testDb(), T.id, (tx) => tx.auditEvent.findMany({ where, orderBy: { seq: 'asc' } }));

beforeAll(async () => {
  app = await createTestApp();
  T = await createTestTenant();
  const mk = (code: string) => createTestUser(T.id, { roles: [{ code }], tenantCode: T.code });
  for (const [who, role] of [
    ['daftar', 'petugas_pendaftaran'],
    ['rm', 'petugas_rm'],
    ['perawat', 'perawat'],
    ['kasir', 'kasir'],
    ['auditor', 'auditor_mutu'],
  ] as const) {
    u[who] = await mk(role);
    tok[who] = await login(app, u[who] as TestUser);
  }
  u.rsB = await createTestUser(TENANT_B, { roles: [{ code: 'petugas_pendaftaran' }] });
  tok.rsB = await login(app, u.rsB);
});

afterAll(async () => {
  await app.close();
});

describe('pendaftaran pasien', () => {
  it('nomor RM berurutan, identitas tersamar di respons, terenkripsi di DB, diaudit tanpa nilai', async () => {
    const n = nik();
    const res = await as('daftar')
      .post('/api/v1/patients', {
        name: 'Siti Rahmawati',
        sex: 'female',
        birthDate: '1972-03-14',
        motherName: 'Aminah',
        address: 'Jl. Kenanga No. 12, Jakarta Timur',
        phone: '0812-0000-4567',
        identifiers: { nik: n, bpjs: '0000-0123-45678' },
      })
      .expect(201);
    expect(res.body.mrn).toMatch(/^\d{2}-\d{2}-\d{2}-\d{2}$/);
    expect(res.body.identifiers).toEqual([
      { system: 'bpjs', masked: '0000012•••678', verification: 'unverified', verifiedAt: null },
      {
        system: 'nik',
        masked: `${n.slice(0, 4)}••••••••${n.slice(-4)}`,
        // NIK baru langsung diantrekan untuk verifikasi Dukcapil (outbox).
        verification: 'pending',
        verifiedAt: null,
      },
    ]);
    expect(res.body).toMatchObject({
      phoneMasked: '0812•••4567',
      address: 'Jl. Kenanga No. 12, Jakarta Timur',
    });
    expect(JSON.stringify(res.body)).not.toContain(n);

    const [stored] = await withTenant(
      testDb(),
      T.id,
      (tx) =>
        tx.$queryRaw<Array<{ v: string }>>`
        SELECT string_agg(value_enc, ' ') AS v FROM patient_identifiers WHERE patient_id = ${res.body.id}::uuid`,
    );
    expect(stored?.v).not.toContain(n);

    const [created] = await audits({ action: 'create', patientId: res.body.id });
    expect(created).toMatchObject({ resourceType: 'patient', actorUserId: u.daftar?.id });
    expect(created?.details).toEqual({
      fields: ['address', 'birthDate', 'identifiers', 'motherName', 'name', 'phone', 'sex'],
      identifiers: ['bpjs', 'nik'],
    });
    expect(jsonText(created)).not.toMatch(/Rahmawati|Kenanga|4567/);
  });

  it('NIK yang sudah terdaftar → 409 berisi RM pemiliknya; dua pendaftaran serentak hanya satu lolos', async () => {
    const n = nik();
    const first = await as('daftar')
      .post('/api/v1/patients', {
        name: 'Budi Santoso',
        sex: 'male',
        birthDate: '1965-06-02',
        identifiers: { nik: n },
      })
      .expect(201);
    const dup = await as('daftar')
      .post('/api/v1/patients', {
        name: 'Budi Santosa',
        sex: 'male',
        birthDate: '1965-06-02',
        identifiers: { nik: n },
      })
      .expect(409);
    expect(dup.body.details).toMatchObject({ system: 'nik', mrn: first.body.mrn, patientId: first.body.id });

    const n2 = nik();
    const body = { name: 'Rina Wulandari', sex: 'female', birthDate: '1990-05-05', identifiers: { nik: n2 } };
    const statuses = (
      await Promise.all([
        as('daftar').post('/api/v1/patients', body),
        as('rm').post('/api/v1/patients', body),
      ])
    )
      .map((r) => r.status)
      .sort();
    expect(statuses).toEqual([201, 409]);
  });

  it('pasien tanpa identitas boleh tanpa tanggal lahir; pasien biasa wajib', async () => {
    const x = await as('daftar')
      .post('/api/v1/patients', { name: 'Tn. X (tanpa identitas)', sex: 'male', unidentified: true })
      .expect(201);
    expect(x.body).toMatchObject({ unidentified: true, birthDate: null });
    await as('daftar').post('/api/v1/patients', { name: 'Ani Lestari', sex: 'female' }).expect(400);
    await as('daftar').patch(`/api/v1/patients/${x.body.id}`, { unidentified: false }).expect(400);
  });
});

describe('pencarian', () => {
  let siti: { id: string; mrn: string };
  const sitiNik = nik();

  beforeAll(async () => {
    const res = await as('daftar')
      .post('/api/v1/patients', {
        name: 'Siti Nurhaliza',
        sex: 'female',
        birthDate: '1985-07-21',
        identifiers: { nik: sitiNik, bpjs: '0000777766665' },
      })
      .expect(201);
    siti = res.body;
    await as('daftar')
      .post('/api/v1/patients', { name: 'Sutrisno Hadi', sex: 'male', birthDate: '1950-01-01' })
      .expect(201);
  });

  it('nama dengan salah ketik, RM dengan/tanpa strip, NIK, BPJS', async () => {
    const byName = await as('daftar').get('/api/v1/patients?q=Ny.%20Siti%20Nurhaliza').expect(200);
    expect(byName.body.by).toBe('name');
    expect(byName.body.items[0]).toMatchObject({ id: siti.id, mrn: siti.mrn });
    const typo = await as('daftar').get('/api/v1/patients?q=siti%20nurhalisa').expect(200);
    expect(typo.body.items.map((p: { id: string }) => p.id)).toContain(siti.id);

    for (const q of [siti.mrn, siti.mrn.replace(/-/g, ''), sitiNik, '0000777766665']) {
      const r = await as('daftar')
        .get(`/api/v1/patients?q=${encodeURIComponent(q)}`)
        .expect(200);
      expect(r.body.items.map((p: { id: string }) => p.id)).toEqual([siti.id]);
    }
    const withDob = await as('daftar').get('/api/v1/patients?q=siti&birthDate=1985-07-21').expect(200);
    expect(withDob.body.items.map((p: { id: string }) => p.id)).toEqual([siti.id]);
    await as('daftar').get('/api/v1/patients?q=12345').expect(400);
  });

  it('setiap pasien yang tampil di hasil tercatat (search + patientId), tanpa teks pencarian', async () => {
    const before = (await audits({ action: 'search', patientId: siti.id })).length;
    await as('kasir').get(`/api/v1/patients?q=${sitiNik}`).expect(200);
    const after = await audits({ action: 'search', patientId: siti.id });
    expect(after.length).toBe(before + 1);
    expect(after.at(-1)).toMatchObject({ actorUserId: u.kasir?.id, details: { by: 'nik' } });
    const all = await audits({ action: 'search' });
    expect(jsonText(all)).not.toMatch(new RegExp(`${sitiNik}|nurhal`, 'i'));
  });
});

describe('detail, identitas utuh, dan ABAC', () => {
  let p: { id: string; mrn: string };
  const n = nik();

  beforeAll(async () => {
    p = (
      await as('daftar')
        .post('/api/v1/patients', {
          name: 'Dewi Kartika',
          sex: 'female',
          birthDate: '1979-12-01',
          phone: '081200009876',
          identifiers: { nik: n },
        })
        .expect(201)
    ).body;
  });

  it('detail diaudit (read); NIK/no. HP utuh hanya lewat reveal yang diaudit dan berizin', async () => {
    await as('rm').get(`/api/v1/patients/${p.id}`).expect(200);
    expect(await audits({ action: 'read', resourceType: 'patient', patientId: p.id })).toHaveLength(1);

    const nikRes = await as('daftar').get(`/api/v1/patients/${p.id}/reveal?field=nik`).expect(200);
    expect(nikRes.body).toEqual({ field: 'nik', value: n });
    const phone = await as('daftar').get(`/api/v1/patients/${p.id}/reveal?field=phone`).expect(200);
    expect(phone.body.value).toBe('081200009876');
    const reveals = await audits({ patientId: p.id, action: 'read', resourceType: 'patient_identifier' });
    expect(reveals.at(-1)?.details).toEqual({ field: 'nik', reveal: true });
    await as('daftar').get(`/api/v1/patients/${p.id}/reveal?field=paspor`).expect(404);

    // Kasir boleh membaca data pasien (lingkup semua) tetapi tidak membuka NIK utuh.
    await as('kasir').get(`/api/v1/patients/${p.id}`).expect(200);
    await as('kasir').get(`/api/v1/patients/${p.id}/reveal?field=nik`).expect(403);
  });

  it('perawat tanpa relasi ditolak (penolakan tercatat); relasi aktif atau akses darurat membuka akses', async () => {
    const denied = await as('perawat').get(`/api/v1/patients/${p.id}`).expect(403);
    expect(denied.body.details).toEqual({ breakGlassAvailable: true });
    const [d] = await audits({ action: 'access_denied', patientId: p.id, actorUserId: u.perawat?.id });
    expect(d).toMatchObject({
      outcome: 'denied',
      resourceType: 'patient',
      details: { scope: 'relationship' },
    });
    const hidden = await as('perawat').get('/api/v1/patients?q=Dewi%20Kartika').expect(200);
    expect(hidden.body.items).toEqual([]);

    // valid_from eksplisit 1 menit lalu: bawaan `now()` Prisma diisi jam proses tes, sedangkan pencarian
    // membandingkan dengan jam Postgres; jam kontainer DB bisa tertinggal beberapa puluh ms dari host.
    await withTenant(testDb(), T.id, (tx) =>
      tx.accessRelationship.create({
        data: {
          id: newId(),
          tenantId: T.id,
          userId: u.perawat?.id as string,
          patientId: p.id,
          kind: 'dpjp',
          validFrom: new Date(Date.now() - 60_000),
        },
      }),
    );
    await as('perawat').get(`/api/v1/patients/${p.id}`).expect(200);
    const found = await as('perawat').get('/api/v1/patients?q=Dewi%20Kartika').expect(200);
    expect(found.body.items.map((x: { id: string }) => x.id)).toEqual([p.id]);
    await as('perawat').get(`/api/v1/patients?q=${p.mrn}`).expect(200);

    const other = await createTestPatient(T.id, { name: 'Pasien IGD Lain' });
    await as('perawat').get(`/api/v1/patients/${other.id}`).expect(403);
    await as('perawat')
      .post('/api/v1/authz/break-glass', {
        patientId: other.id,
        reason: 'Pasien tidak sadar di IGD, perlu riwayat alergi',
      })
      .expect(201);
    await as('perawat').get(`/api/v1/patients/${other.id}`).expect(200);
    // Perawat tidak berhak mengubah identitas pasien.
    await as('perawat').patch(`/api/v1/patients/${other.id}`, { name: 'Nama Lain' }).expect(403);
  });

  it('akses darurat untuk pasien yang tidak ada → 404', async () => {
    await as('perawat')
      .post('/api/v1/authz/break-glass', {
        patientId: newId(),
        reason: 'Pasien tidak sadar di IGD, perlu riwayat alergi',
      })
      .expect(404);
  });
});

describe('perubahan identitas', () => {
  it('ubah data: audit hanya nama field; kontak tetap terenkripsi', async () => {
    const p = (
      await as('daftar')
        .post('/api/v1/patients', { name: 'Hendra Wijaya', sex: 'male', birthDate: '1970-02-02' })
        .expect(201)
    ).body;
    const res = await as('rm')
      .patch(`/api/v1/patients/${p.id}`, { name: 'Hendra Wijaya Kusuma', phone: '+62 812 0000 1111' })
      .expect(200);
    expect(res.body).toMatchObject({ name: 'Hendra Wijaya Kusuma', phoneMasked: '0812•••1111' });
    const [upd] = await audits({ action: 'update', resourceType: 'patient', patientId: p.id });
    expect(upd?.details).toEqual({ fields: ['name', 'phone'] });
    expect(jsonText(upd)).not.toMatch(/Kusuma|1111/);
  });

  it('ganti NIK wajib alasan; nilai lama disimpan nonaktif; NIK milik pasien lain ditolak', async () => {
    const oldNik = nik();
    const p = (
      await as('daftar')
        .post('/api/v1/patients', {
          name: 'Maya Sari',
          sex: 'female',
          birthDate: '1988-08-08',
          identifiers: { nik: oldNik },
        })
        .expect(201)
    ).body;
    const newNik = nik();
    await as('rm').put(`/api/v1/patients/${p.id}/identifiers/nik`, { value: newNik }).expect(400);
    const res = await as('rm')
      .put(`/api/v1/patients/${p.id}/identifiers/nik`, {
        value: newNik,
        reason: 'Salah ketik saat registrasi, dicek ulang dengan KTP',
      })
      .expect(200);
    expect(res.body.identifiers).toEqual([
      expect.objectContaining({ system: 'nik', masked: `${newNik.slice(0, 4)}••••••••${newNik.slice(-4)}` }),
    ]);
    const rows = await withTenant(testDb(), T.id, (tx) =>
      tx.patientIdentifier.findMany({
        where: { patientId: p.id, system: 'nik' },
        orderBy: { createdAt: 'asc' },
      }),
    );
    expect(rows.map((r) => [r.active, r.deactivationReason])).toEqual([
      [false, 'Salah ketik saat registrasi, dicek ulang dengan KTP'],
      [true, null],
    ]);
    const [audit] = await audits({ action: 'update', resourceType: 'patient_identifier', patientId: p.id });
    expect(audit).toMatchObject({ details: { system: 'nik', replaced: true } });

    const other = (
      await as('daftar')
        .post('/api/v1/patients', { name: 'Lina Halim', sex: 'female', birthDate: '1991-01-01' })
        .expect(201)
    ).body;
    await as('rm').put(`/api/v1/patients/${other.id}/identifiers/nik`, { value: newNik }).expect(409);
    await as('rm').put(`/api/v1/patients/${other.id}/identifiers/nik`, { value: '123' }).expect(400);
  });
});

describe('izin dan isolasi tenant', () => {
  it('auditor mutu tanpa izin pasien; kasir hanya baca; RS lain tidak melihat pasien RS ini', async () => {
    // Penanda unik tes ini: NIK berwilayah 97 (tidak dipakai seed) + 4 digit acak, dan nama berakhiran huruf acak.
    // No. RM TIDAK unik antar-RS (penomoran per tenant), jadi bukan penanda isolasi.
    const markerNik = `999997540372${String(Math.floor(Math.random() * 10_000)).padStart(4, '0')}`;
    const marker = newId()
      .slice(-8)
      .replace(/\d/g, (d) => 'ghijklmnop'[Number(d)] ?? 'x');
    const name = `Fitri Handayani ${marker}`;
    const p = await createTestPatient(T.id, { name, identifiers: { nik: markerNik } });
    await as('auditor').get('/api/v1/patients?q=Fitri').expect(403);
    await as('auditor').get(`/api/v1/patients/${p.id}`).expect(403);
    await as('kasir')
      .post('/api/v1/patients', { name: 'Kasir Daftar', sex: 'male', birthDate: '1990-01-01' })
      .expect(403);
    await as('kasir').get('/api/v1/patients?q=Fitri%20Handayani').expect(200);

    // Kontrol positif di RS pemilik: penanda yang sama memang menemukan pasien ini.
    const ids = (r: request.Response) => (r.body.items as Array<{ id: string }>).map((i) => i.id);
    expect(ids(await as('daftar').get(`/api/v1/patients?q=${markerNik}`).expect(200))).toEqual([p.id]);
    expect(ids(await as('daftar').get(`/api/v1/patients?q=${p.mrn}`).expect(200))).toEqual([p.id]);

    // RS lain: detail 404; cari NIK penanda → kosong; cari RM/nama yang sama → tidak pernah memuat pasien RS ini
    // (RS lain boleh punya pasien sendiri dengan RM yang sama).
    await as('rsB').get(`/api/v1/patients/${p.id}`).expect(404);
    expect((await as('rsB').get(`/api/v1/patients?q=${markerNik}`).expect(200)).body.items).toEqual([]);
    for (const q of [p.mrn, encodeURIComponent(name)]) {
      const r = await as('rsB').get(`/api/v1/patients?q=${q}`).expect(200);
      expect(ids(r)).not.toContain(p.id);
      expect(jsonText(r.body)).not.toContain(marker);
    }
  });

  it('rantai hash audit tenant tetap utuh setelah semua aktivitas pasien', async () => {
    const result = await withTenant(testDb(), T.id, (tx) => verifyAuditChain(tx));
    expect(result.firstBrokenSeq).toBeNull();
    expect(result.checked).toBeGreaterThan(20);
  });
});
