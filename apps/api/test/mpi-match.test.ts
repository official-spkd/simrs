/**
 * P05 · Tinjauan rekam medis ganda (layar MPI) lewat API: antrean hasil deteksi saat pendaftaran, banding
 * atribut, gabung berjejak, batal ≤ 30 hari, "bukan orang yang sama", keputusan serentak, izin, dan audit.
 * Tenant fiktif baru; setiap pasangan memakai tanggal lahir, ibu, dan no. HP sendiri agar tidak saling cocok.
 */
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createPrismaClient, type PrismaClient, withTenant } from '@simrs/db';
import { testDbUrls } from '@simrs/db/testing';
import { newId } from '@simrs/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
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
let owner: PrismaClient;
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
  };
};
const digits = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');
const REASON = 'Dikonfirmasi dengan KTP dan wawancara pasien di loket';
const MOTHERS = ['Aminah', 'Sumiati', 'Halimah', 'Rukmini', 'Sulastri', 'Juwariyah', 'Painem', 'Tukiyem'];

let seq = 0;
/**
 * Pasangan kemungkinan duplikat: A lebih dulu (NIK), B kemudian (ejaan beda, BPJS + IHS). `mother` yang sama
 * untuk beberapa pasangan membuat pasangan-pasangan itu juga saling mirip (kandidat silang).
 */
async function pair(mother?: string) {
  seq += 1;
  const dob = `19${String(40 + seq * 3).padStart(2, '0')}-0${(seq % 9) + 1}-1${seq % 9}`;
  const common = {
    sex: 'female',
    birthDate: dob,
    motherName: mother ?? MOTHERS[seq % MOTHERS.length],
    phone: `0812${digits(8)}`,
    identifiers: {},
  };
  const a = await as('daftar')
    .post('/api/v1/patients', {
      ...common,
      name: 'Siti Rahmawati',
      address: 'Jl. Kenanga No. 12, Jakarta Timur',
      identifiers: { nik: `9999${digits(12)}` },
    })
    .expect(201);
  const b = await as('daftar')
    .post('/api/v1/patients', {
      ...common,
      name: 'Siti Rachmawati',
      address: 'Kenanga No.12, Jaktim',
      identifiers: { bpjs: `0000${digits(9)}`, ihs: `P${digits(11)}` },
    })
    .expect(201);
  const [cand] = await withTenant(testDb(), T.id, (tx) =>
    tx.patientMatchCandidate.findMany({ where: { patientAId: a.body.id, patientBId: b.body.id } }),
  );
  if (!cand) throw new Error('Pasangan tidak terdeteksi saat pendaftaran');
  return { a: a.body, b: b.body, candId: cand.id };
}

const audits = (where: Record<string, unknown>) =>
  withTenant(testDb(), T.id, (tx) => tx.auditEvent.findMany({ where, orderBy: { seq: 'asc' } }));

beforeAll(async () => {
  app = await createTestApp();
  owner = createPrismaClient({ connectionString: testDbUrls().migrator, max: 1 });
  T = await createTestTenant();
  for (const [who, role] of [
    ['rm', 'petugas_rm'],
    ['rm2', 'petugas_rm'],
    ['daftar', 'petugas_pendaftaran'],
    ['perawat', 'perawat'],
  ] as const) {
    u[who] = await createTestUser(T.id, { roles: [{ code: role }], tenantCode: T.code });
    tok[who] = await login(app, u[who] as TestUser);
  }
});

afterAll(async () => {
  await owner.$disconnect();
  await app.close();
});

describe('antrean dan banding', () => {
  it('pasangan terdeteksi saat pendaftaran; antrean dan banding diaudit untuk kedua pasien', async () => {
    const p = await pair();
    const list = await as('rm').get('/api/v1/mpi/candidates?status=open').expect(200);
    const item = list.body.items.find((x: { id: string }) => x.id === p.candId);
    expect(item).toMatchObject({
      status: 'open',
      a: { id: p.a.id, mrn: p.a.mrn, name: 'Siti Rahmawati' },
      b: { id: p.b.id, mrn: p.b.mrn, name: 'Siti Rachmawati' },
      summary: 'Tanggal lahir, ibu kandung, no. HP, dan alamat sama; nama mirip',
    });
    expect(list.body.openCount).toBeGreaterThanOrEqual(1);

    const cmp = await as('rm').get(`/api/v1/mpi/candidates/${p.candId}`).expect(200);
    const row = (attr: string) => cmp.body.rows.find((r: { attribute: string }) => r.attribute === attr);
    expect(row('name')).toMatchObject({ a: 'Siti Rahmawati', b: 'Siti Rachmawati', match: 'mirip' });
    expect(row('birthDate')).toMatchObject({ match: 'sama' });
    expect(row('address')).toMatchObject({ match: 'sama' });
    expect(row('nik')).toMatchObject({ b: null, match: 'kosong' });
    // NIK A didaftarkan lewat API → verifikasi Dukcapil diantrekan otomatis.
    expect(row('nik').a).toMatch(/^9999••••••••\d{4} · menunggu Dukcapil$/);
    expect(row('bpjs')).toMatchObject({ a: null, match: 'kosong' });
    expect(cmp.body.impact.map((i: { n: number }) => i.n)).toEqual([0, 2, 0]);
    expect(
      await audits({ action: 'read', resourceType: 'patient_match', resourceId: p.candId }),
    ).toHaveLength(2);
  });

  it('hanya petugas rekam medis: pendaftaran dan perawat ditolak', async () => {
    await as('daftar').get('/api/v1/mpi/candidates').expect(403);
    await as('perawat').get('/api/v1/mpi/candidates').expect(403);
  });
});

describe('gabung', () => {
  it('B ditandai digabung, atribut pilihan dari B dipakai A, tidak ada data yang dihapus', async () => {
    const p = await pair();
    await as('rm')
      .post(`/api/v1/mpi/candidates/${p.candId}/merge`, { reason: 'singkat', takeFromB: [] })
      .expect(400);
    const res = await as('rm')
      .post(`/api/v1/mpi/candidates/${p.candId}/merge`, {
        reason: REASON,
        takeFromB: ['name', 'bpjs', 'ihs'],
      })
      .expect(200);
    expect(res.body).toMatchObject({
      survivor: { id: p.a.id, mrn: p.a.mrn },
      merged: { id: p.b.id, mrn: p.b.mrn },
      taken: ['name', 'bpjs', 'ihs'],
    });

    const b = await as('rm').get(`/api/v1/patients/${p.b.id}`).expect(200);
    expect(b.body).toMatchObject({ status: 'merged', mergedInto: { id: p.a.id, mrn: p.a.mrn } });
    expect(b.body.identifiers.map((i: { system: string }) => i.system)).toEqual(['bpjs', 'ihs']);
    const a = await as('rm').get(`/api/v1/patients/${p.a.id}`).expect(200);
    expect(a.body.name).toBe('Siti Rachmawati');
    expect(a.body.identifiers.map((i: { system: string }) => i.system)).toEqual(['bpjs', 'ihs', 'nik']);
    await as('rm').patch(`/api/v1/patients/${p.b.id}`, { name: 'Ubah B' }).expect(409);

    const link = await withTenant(testDb(), T.id, (tx) =>
      tx.patientLink.findUniqueOrThrow({ where: { id: res.body.linkId } }),
    );
    expect(link).toMatchObject({ survivorId: p.a.id, mergedId: p.b.id, reason: REASON, undoneAt: null });
    expect(link.survivorSnapshotEnc).toMatch(/^v1\./);
    expect(link.survivorSnapshotEnc).not.toContain('Rahmawati');

    const merges = await audits({ action: 'merge', resourceId: res.body.linkId });
    expect(merges.map((m) => m.patientId).sort()).toEqual([p.a.id, p.b.id].sort());
    expect(merges[0]).toMatchObject({ reason: REASON, resourceType: 'patient_link' });

    await as('rm').post(`/api/v1/mpi/candidates/${p.candId}/merge`, { reason: REASON }).expect(409);
    const decided = await as('rm').get('/api/v1/mpi/candidates?status=decided').expect(200);
    expect(decided.body.items.find((x: { id: string }) => x.id === p.candId)).toMatchObject({
      status: 'merged',
    });
  });

  it('setelah gabung: identitas B mengarah ke A, relasi ke B berlaku untuk A', async () => {
    const p = await pair();
    const bpjs = await as('rm').get(`/api/v1/patients/${p.b.id}/reveal?field=bpjs`).expect(200);
    await as('rm')
      .post(`/api/v1/mpi/candidates/${p.candId}/merge`, { reason: REASON, takeFromB: [] })
      .expect(200);

    // Cari dengan BPJS milik B: B digabung dan tidak diambil ke A → B tampil, dengan rujukan ke A.
    const found = await as('rm').get(`/api/v1/patients?q=${bpjs.body.value}`).expect(200);
    expect(found.body.items).toEqual([
      expect.objectContaining({ id: p.b.id, mergedInto: { id: p.a.id, mrn: p.a.mrn } }),
    ]);
    // Pendaftaran baru dengan BPJS itu ditolak dan diarahkan ke RM A (yang dipertahankan).
    const dup = await as('daftar')
      .post('/api/v1/patients', {
        name: 'Siti R',
        sex: 'female',
        birthDate: '1990-01-01',
        identifiers: { bpjs: bpjs.body.value },
      })
      .expect(409);
    expect(dup.body.details).toMatchObject({ mrn: p.a.mrn, patientId: p.a.id });

    await withTenant(testDb(), T.id, (tx) =>
      tx.accessRelationship.create({
        data: {
          id: newId(),
          tenantId: T.id,
          userId: u.perawat?.id as string,
          patientId: p.b.id,
          kind: 'dpjp',
        },
      }),
    );
    await as('perawat').get(`/api/v1/patients/${p.a.id}`).expect(200);
    const mine = await as('perawat').get(`/api/v1/patients?q=${p.a.mrn}`).expect(200);
    expect(mine.body.items.map((x: { id: string }) => x.id)).toEqual([p.a.id]);
  });

  it('dua keputusan serentak pada pasangan yang sama: hanya satu berlaku', async () => {
    const p = await pair();
    const statuses = (
      await Promise.all([
        as('rm').post(`/api/v1/mpi/candidates/${p.candId}/merge`, { reason: REASON }),
        as('rm2').post(`/api/v1/mpi/candidates/${p.candId}/distinct`, { reason: REASON }),
      ])
    )
      .map((r) => r.status)
      .sort();
    expect(statuses).toEqual([200, 409]);
  });
});

describe('penggabungan serentak oleh beberapa petugas', () => {
  it('pasangan berbeda yang saling mirip digabung bersamaan: semua berhasil, tanpa deadlock', async () => {
    for (let round = 0; round < 3; round++) {
      const pairs = [await pair('Ngatini'), await pair('Ngatini'), await pair('Ngatini')];
      const results = await Promise.all(
        pairs.map((p, i) =>
          as(i % 2 === 0 ? 'rm' : 'rm2').post(`/api/v1/mpi/candidates/${p.candId}/merge`, {
            reason: REASON,
            takeFromB: ['name'],
          }),
        ),
      );
      expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    }
  });
});

describe('batal gabung', () => {
  it('B aktif lagi; nilai A dipulihkan kecuali yang diubah sesudahnya; pasangan kembali ke antrean', async () => {
    const p = await pair();
    const merged = await as('rm')
      .post(`/api/v1/mpi/candidates/${p.candId}/merge`, { reason: REASON, takeFromB: ['name', 'bpjs'] })
      .expect(200);
    await as('rm').patch(`/api/v1/patients/${p.a.id}`, { name: 'Siti Rahmawati Putri' }).expect(200);

    await as('rm').post(`/api/v1/mpi/links/${merged.body.linkId}/undo`, { reason: 'pendek' }).expect(400);
    const undo = await as('rm')
      .post(`/api/v1/mpi/links/${merged.body.linkId}/undo`, {
        reason: 'Ternyata dua orang berbeda setelah dicek ulang KTP',
      })
      .expect(200);
    expect(undo.body).toEqual({ restored: ['bpjs'], kept: ['name'] });

    const a = await as('rm').get(`/api/v1/patients/${p.a.id}`).expect(200);
    expect(a.body.name).toBe('Siti Rahmawati Putri');
    expect(a.body.identifiers.map((i: { system: string }) => i.system)).toEqual(['nik']);
    const b = await as('rm').get(`/api/v1/patients/${p.b.id}`).expect(200);
    expect(b.body).toMatchObject({ status: 'active', mergedInto: null });

    const cmp = await as('rm').get(`/api/v1/mpi/candidates/${p.candId}`).expect(200);
    expect(cmp.body.status).toBe('open');
    expect(cmp.body.link).toMatchObject({
      undoable: false,
      undoReason: 'Ternyata dua orang berbeda setelah dicek ulang KTP',
    });
    expect(await audits({ action: 'unmerge', resourceId: merged.body.linkId })).toHaveLength(2);
    await as('rm')
      .post(`/api/v1/mpi/links/${merged.body.linkId}/undo`, { reason: 'Coba batalkan sekali lagi' })
      .expect(409);
  });

  it('lewat 30 hari tidak bisa dibatalkan', async () => {
    const p = await pair();
    const merged = await as('rm')
      .post(`/api/v1/mpi/candidates/${p.candId}/merge`, { reason: REASON })
      .expect(200);
    // Mundurkan waktu penggabungan (hanya pemilik tabel; role aplikasi tidak bisa mengubah kolom ini).
    await withTenant(owner, T.id, (tx) =>
      tx.patientLink.update({
        where: { id: merged.body.linkId },
        data: { mergedAt: new Date(Date.now() - 31 * 86_400_000) },
      }),
    );
    const res = await as('rm')
      .post(`/api/v1/mpi/links/${merged.body.linkId}/undo`, { reason: 'Pembatalan yang sudah terlambat' })
      .expect(409);
    expect(res.body.message).toMatch(/30 hari/);
  });
});

describe('bukan orang yang sama', () => {
  it('tidak diusulkan lagi walau data berubah; keputusan bisa dibatalkan; tercatat untuk kedua pasien', async () => {
    const p = await pair();
    await as('rm')
      .post(`/api/v1/mpi/candidates/${p.candId}/distinct`, {
        reason: 'Kakak beradik kembar, dikonfirmasi keluarga',
      })
      .expect(200);
    await as('rm').patch(`/api/v1/patients/${p.b.id}`, { name: 'Siti Rahmawati' }).expect(200);
    const after = await withTenant(testDb(), T.id, (tx) =>
      tx.patientMatchCandidate.findUniqueOrThrow({ where: { id: p.candId } }),
    );
    expect(after.status).toBe('distinct');
    const reviews = await audits({ action: 'review', resourceType: 'patient_match', resourceId: p.candId });
    expect(reviews.map((r) => r.patientId).sort()).toEqual([p.a.id, p.b.id].sort());

    await as('rm')
      .post(`/api/v1/mpi/candidates/${p.candId}/reopen`, { reason: 'Keputusan keliru, perlu dicek ulang' })
      .expect(200);
    const cmp = await as('rm').get(`/api/v1/mpi/candidates/${p.candId}`).expect(200);
    expect(cmp.body).toMatchObject({ status: 'open', decision: null });
  });
});

describe('jam ABAC', () => {
  it('relasi yang baru dibuat langsung berlaku di pencarian, juga bila jam database tertinggal', async () => {
    const p = await pair();
    // Hanya Date dipalsukan: jam aplikasi 60 detik di depan Postgres (seperti VM/DB yang jamnya tertinggal).
    // `valid_from` bawaan Prisma diisi jam aplikasi, jadi pencarian harus memakai jam yang sama dengan detail.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 60_000);
    try {
      await withTenant(testDb(), T.id, (tx) =>
        tx.accessRelationship.create({
          data: {
            id: newId(),
            tenantId: T.id,
            userId: u.perawat?.id as string,
            patientId: p.a.id,
            kind: 'dpjp',
          },
        }),
      );
      await as('perawat').get(`/api/v1/patients/${p.a.id}`).expect(200);
      const found = await as('perawat').get(`/api/v1/patients?q=${p.a.mrn}`).expect(200);
      expect(found.body.items.map((x: { id: string }) => x.id)).toEqual([p.a.id]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('akses darurat yang baru diberikan langsung berlaku di pencarian nama dan RM, juga bila jam database tertinggal', async () => {
    // Cabang akses darurat (`granted_at`/`expires_at`, diisi `new Date()` aplikasi) dan jalur cari nama
    // (`idsByName`) memakai saringan yang sama; pasien bernama unik agar hasil cari nama pasti.
    const p = await createTestPatient(T.id, { name: 'Ratih Purbasari' });
    const ids = async (q: string) =>
      (
        (
          await as('perawat')
            .get(`/api/v1/patients?q=${encodeURIComponent(q)}`)
            .expect(200)
        ).body.items as Array<{
          id: string;
        }>
      ).map((x) => x.id);
    expect(await ids('Ratih Purbasari')).toEqual([]);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 60_000);
    try {
      await as('perawat')
        .post('/api/v1/authz/break-glass', {
          patientId: p.id,
          reason: 'Pasien tidak sadar di IGD, perlu riwayat alergi',
        })
        .expect(201);
      await as('perawat').get(`/api/v1/patients/${p.id}`).expect(200);
      expect(await ids('Ratih Purbasari')).toEqual([p.id]);
      expect(await ids(p.mrn)).toEqual([p.id]);
    } finally {
      vi.useRealTimers();
    }
  });
});
