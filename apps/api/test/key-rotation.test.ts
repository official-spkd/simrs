/**
 * P05 · Rotasi kunci kolom v2 lewat API (ADR-0015, pembaruan 5 Okt 2026). Tiga instans API memakai cincin berbeda:
 * - v1: hanya kunci format lama (sebelum rotasi);
 * - campuran: v2 aktif + v1 hanya baca (selama rotasi);
 * - v2: kunci lama sudah dipensiunkan (setelah job enkripsi ulang).
 * Diuji: login MFA, cari NIK/BPJS, NIK ganda ditolak, identifier sama tidak dianggap berubah, tulisan baru v2, batal
 * gabung setelah data dienkripsi ulang, dan PIN (lada berversi; PIN berkunci lama dicabut `key_rotated`).
 * Tenant fiktif baru: job hanya dijalankan untuk tenant ini.
 */
import { randomBytes } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { rotateTenantKeys, withTenant } from '@simrs/db';
import { newId } from '@simrs/shared';
import { fieldKeysFromEnv } from '@simrs/shared/node';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bearer,
  createTestApp,
  createTestTenant,
  createTestUser,
  login,
  type TestUser,
  testDb,
  type Tokens,
} from './helpers';

const v2Enc = randomBytes(32).toString('base64');
const v2Hash = randomBytes(32).toString('base64');
const MID = { FIELD_ENCRYPTION_KEYS: `v2:${v2Enc}`, FIELD_HASH_KEYS: `v2:${v2Hash}` };
const V2 = { ...MID, FIELD_ENCRYPTION_KEY: '', FIELD_HASH_KEY: '' };

let apps: Record<'v1' | 'mid' | 'v2', NestExpressApplication>;
let T: { id: string; code: string };
let unitId: string;
const u: Record<string, TestUser> = {};
const REASON = 'Data identitas dan KTP sama setelah dicek petugas RM';
const PIN = '730594';

const digits = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');
const http = (which: keyof typeof apps) => request(apps[which].getHttpServer());

/** Klien per instans × pengguna (login penuh di instans itu: rahasia MFA harus terbaca dengan cincinnya). */
async function as(which: keyof typeof apps, who: string) {
  const tok: Tokens = await login(apps[which], u[who] as TestUser);
  const auth = bearer(tok);
  return {
    tok,
    get: (url: string) => http(which).get(url).set(auth),
    post: (url: string, body: object) => http(which).post(url).set(auth).send(body),
    put: (url: string, body: object) => http(which).put(url).set(auth).send(body),
  };
}

const identifierRows = (patientId: string) =>
  withTenant(testDb(), T.id, (tx) =>
    tx.patientIdentifier.findMany({ where: { patientId }, orderBy: { createdAt: 'asc' } }),
  );

beforeAll(async () => {
  apps = { v1: await createTestApp(), mid: await createTestApp(MID), v2: await createTestApp(V2) };
  T = await createTestTenant();
  unitId = await withTenant(testDb(), T.id, async (tx) => {
    const facilityId = newId();
    const suffix = facilityId.slice(-6).toUpperCase();
    await tx.facility.create({
      data: { id: facilityId, tenantId: T.id, code: `F${suffix}`, name: 'Gedung uji' },
    });
    const unit = await tx.unit.create({
      data: {
        id: newId(),
        tenantId: T.id,
        facilityId,
        code: `M${suffix}`,
        name: 'Bangsal Melati',
        kind: 'rawat_inap',
      },
    });
    return unit.id;
  });
  // Satu pengguna per login (anti-replay TOTP: maks. dua login per pengguna per 30 detik). Semua dibuat sebelum
  // job, sehingga rahasia MFA-nya ikut dienkripsi ulang dan terbaca instans v2.
  for (const [who, role, unit] of [
    ['daftar1', 'petugas_pendaftaran', undefined],
    ['daftar2', 'petugas_pendaftaran', undefined],
    ['daftar3', 'petugas_pendaftaran', undefined],
    ['daftar4', 'petugas_pendaftaran', undefined],
    ['rm1', 'petugas_rm', undefined],
    ['rm2', 'petugas_rm', undefined],
    ['perawat', 'perawat', unitId],
  ] as const) {
    u[who] = await createTestUser(T.id, { roles: [{ code: role, unitId: unit }], tenantCode: T.code });
  }
});

afterAll(async () => {
  for (const a of Object.values(apps ?? {})) await a.close();
});

describe('rotasi kunci kolom lewat API (P05, ADR-0015)', () => {
  const nik1 = `9999${digits(12)}`;
  const bpjs1 = `0000${digits(9)}`;
  const nik2 = `9999${digits(12)}`;
  const state: { p1?: string; mrn1?: string; linkId?: string; a?: string; pinV1?: string; pinV2?: string } =
    {};

  it('sebelum → selama rotasi: data v1 tercari, NIK ganda ditolak, nilai sama tidak dianggap berubah, tulisan baru v2', async () => {
    const v1 = await as('v1', 'daftar1');
    const p1 = await v1
      .post('/api/v1/patients', {
        name: 'Ratna Sari Dewi',
        sex: 'female',
        birthDate: '1984-02-10',
        motherName: 'Suminah',
        address: 'Jl. Melati No. 3, Bandung',
        phone: '0812-3456-7001',
        identifiers: { nik: nik1, bpjs: bpjs1 },
      })
      .expect(201);
    state.p1 = p1.body.id;
    state.mrn1 = p1.body.mrn;
    expect((await identifierRows(p1.body.id)).every((r) => r.valueEnc.startsWith('v1.'))).toBe(true);

    const mid = await as('mid', 'daftar2');
    for (const q of [nik1, bpjs1]) {
      const found = await mid.get(`/api/v1/patients?q=${q}`).expect(200);
      expect(found.body.items.map((i: { id: string }) => i.id)).toEqual([p1.body.id]);
    }
    const dup = await mid
      .post('/api/v1/patients', {
        name: 'Ratna S. Dewi',
        sex: 'female',
        birthDate: '1984-02-10',
        identifiers: { nik: nik1 },
      })
      .expect(409);
    expect(dup.body.details).toMatchObject({ system: 'nik', patientId: p1.body.id, mrn: p1.body.mrn });
    // Nilai sama dengan hash v1 tersimpan: bukan penggantian (tanpa alasan, tanpa baris baru).
    await mid.put(`/api/v1/patients/${p1.body.id}/identifiers/nik`, { value: nik1 }).expect(200);
    expect(await identifierRows(p1.body.id)).toHaveLength(2);

    const p2 = await mid
      .post('/api/v1/patients', {
        name: 'Bambang Wijaya',
        sex: 'male',
        birthDate: '1979-11-02',
        identifiers: { nik: nik2 },
      })
      .expect(201);
    const [row] = await identifierRows(p2.body.id);
    expect(row?.valueEnc.startsWith('v2.')).toBe(true);
    expect(row?.valueHash).toMatch(/^v2:[0-9a-f]{64}$/);
    const found = await mid.get(`/api/v1/patients?q=${nik2}`).expect(200);
    expect(found.body.items.map((i: { id: string }) => i.id)).toEqual([p2.body.id]);
  });

  it('gabung sebelum rotasi; PIN didaftarkan dengan lada v1 (instans lama) dan v2 (instans baru)', async () => {
    const daftar = await as('v1', 'daftar3');
    const common = {
      sex: 'female',
      birthDate: '1966-05-21',
      motherName: 'Kartini',
      phone: `0812${digits(8)}`,
    };
    const a = await daftar
      .post('/api/v1/patients', {
        ...common,
        name: 'Siti Rahmawati',
        address: 'Jl. Kenanga No. 12, Jakarta Timur',
        identifiers: { nik: `9999${digits(12)}` },
      })
      .expect(201);
    const b = await daftar
      .post('/api/v1/patients', {
        ...common,
        name: 'Siti Rachmawati',
        address: 'Kenanga No.12, Jaktim',
        identifiers: { bpjs: `0000${digits(9)}` },
      })
      .expect(201);
    const [cand] = await withTenant(testDb(), T.id, (tx) =>
      tx.patientMatchCandidate.findMany({ where: { patientAId: a.body.id, patientBId: b.body.id } }),
    );
    if (!cand) throw new Error('pasangan tidak terdeteksi');
    const rm = await as('v1', 'rm1');
    const merged = await rm
      .post(`/api/v1/mpi/candidates/${cand.id}/merge`, { reason: REASON, takeFromB: ['address', 'bpjs'] })
      .expect(200);
    state.linkId = merged.body.linkId;
    state.a = a.body.id;

    const register = async (which: 'v1' | 'mid') => {
      const nurse = await as(which, 'perawat');
      const reg = await nurse
        .post('/api/v1/auth/pin/devices', {
          name: `Komputer nurse station ${which}`,
          pin: PIN,
          password: u.perawat?.password,
        })
        .expect(201);
      return reg.body as { id: string; token: string };
    };
    const d1 = await register('v1');
    const d2 = await register('mid');
    state.pinV1 = d1.token;
    state.pinV2 = d2.token;
    const keyIds = await withTenant(testDb(), T.id, (tx) =>
      tx.registeredDevice.findMany({
        where: { id: { in: [d1.id, d2.id] } },
        select: { id: true, pinKeyId: true },
      }),
    );
    expect(Object.fromEntries(keyIds.map((d) => [d.id, d.pinKeyId]))).toEqual({
      [d1.id]: 'v1',
      [d2.id]: 'v2',
    });
    // Selama v1 masih di cincin, PIN lama tetap berlaku.
    await http('mid').post('/api/v1/auth/pin/login').send({ deviceToken: d1.token, pin: PIN }).expect(200);
  });

  it('job enkripsi ulang lalu kunci lama dipensiunkan: login, cari, buka identitas, NIK ganda, batal gabung tetap jalan', async () => {
    const keys = fieldKeysFromEnv({ ...process.env, ...MID });
    const report = await rotateTenantKeys(testDb(), T.id, keys, { pauseMs: 0 });
    expect(report.targets.every((t) => t.failed === 0 && t.remaining === 0)).toBe(true);

    const daftar = await as('v2', 'daftar4');
    const found = await daftar.get(`/api/v1/patients?q=${nik1}`).expect(200);
    expect(found.body.items.map((i: { id: string }) => i.id)).toEqual([state.p1]);
    const rm = await as('v2', 'rm2');
    const reveal = await rm.get(`/api/v1/patients/${state.p1}/reveal?field=nik`).expect(200);
    expect(reveal.body.value).toBe(nik1);
    await daftar
      .post('/api/v1/patients', {
        name: 'Ratna Dewi',
        sex: 'female',
        birthDate: '1984-02-10',
        identifiers: { nik: nik1 },
      })
      .expect(409);

    // Salinan alamat/BPJS di A dan B dienkripsi ulang terpisah (IV berbeda): tetap dikenali "masih dari B".
    const undo = await rm
      .post(`/api/v1/mpi/links/${state.linkId}/undo`, {
        reason: 'Ternyata dua orang berbeda setelah dicek KTP',
      })
      .expect(200);
    expect(undo.body).toEqual({ restored: ['address', 'bpjs'], kept: [] });
    const a = await rm.get(`/api/v1/patients/${state.a}`).expect(200);
    expect(a.body.address).toBe('Jl. Kenanga No. 12, Jakarta Timur');
    expect(a.body.identifiers.map((i: { system: string }) => i.system)).toEqual(['nik']);
  });

  it('PIN berlada v2 tetap berlaku; PIN berlada v1 dicabut key_rotated dan tercatat, bukan gagal diam-diam', async () => {
    await http('v2').post('/api/v1/auth/pin/login').send({ deviceToken: state.pinV2, pin: PIN }).expect(200);
    const res = await http('v2')
      .post('/api/v1/auth/pin/login')
      .send({ deviceToken: state.pinV1, pin: PIN })
      .expect(401);
    expect(res.body.details).toEqual({ pin: 'revoked' });
    const id = (state.pinV1 ?? '').split('.')[2] as string;
    const row = await withTenant(testDb(), T.id, (tx) =>
      tx.registeredDevice.findUniqueOrThrow({ where: { id } }),
    );
    expect(row.revokedReason).toBe('key_rotated');
    const failed = await withTenant(testDb(), T.id, (tx) =>
      tx.auditEvent.findFirst({
        where: { action: 'login_failed', actorUserId: u.perawat?.id },
        orderBy: { seq: 'desc' },
      }),
    );
    expect(failed?.details).toMatchObject({
      method: 'pin',
      reason: 'pin_key_retired',
      deviceId: id,
      pinKeyId: 'v1',
    });
    // Sekali dicabut, percobaan berikutnya ditolak seperti PIN dicabut biasa.
    await http('v2').post('/api/v1/auth/pin/login').send({ deviceToken: state.pinV1, pin: PIN }).expect(401);
  });
});
