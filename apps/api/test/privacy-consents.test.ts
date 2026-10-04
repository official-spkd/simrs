/**
 * P05 · Persetujuan privasi pasien (docs/05 §1, UU PDP): catat, cegah ganda, cabut dengan alasan, tidak pernah
 * dihapus; izin per peran + ABAC; setiap baca/ubah diaudit dengan patientId.
 */
import type { NestExpressApplication } from '@nestjs/platform-express';
import { withTenant } from '@simrs/db';
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
  testDb,
  type Tokens,
} from './helpers';

let app: NestExpressApplication;
let T: { id: string; code: string };
const tok: Record<string, Tokens> = {};
const http = () => request(app.getHttpServer());
const as = (who: string) => {
  const auth = () => bearer(tok[who] as Tokens);
  return {
    get: (url: string) => http().get(url).set(auth()),
    post: (url: string, body: object = {}) => http().post(url).set(auth()).send(body),
  };
};

beforeAll(async () => {
  app = await createTestApp();
  T = await createTestTenant();
  for (const [who, role] of [
    ['daftar', 'petugas_pendaftaran'],
    ['kasir', 'kasir'],
    ['perawat', 'perawat'],
  ] as const) {
    const user = await createTestUser(T.id, { roles: [{ code: role }], tenantCode: T.code });
    tok[who] = await login(app, user);
  }
});

afterAll(async () => {
  await app.close();
});

describe('persetujuan privasi', () => {
  it('catat, cegah ganda, cabut beralasan, catat ulang; riwayat utuh dan diaudit', async () => {
    const p = await createTestPatient(T.id, { name: 'Ratna Sari' });
    const base = `/api/v1/patients/${p.id}/consents`;
    const umum = await as('daftar').post(base, { kind: 'umum', note: 'Ditandatangani di loket' }).expect(201);
    expect(umum.body).toMatchObject({
      kind: 'umum',
      label: 'Persetujuan umum',
      active: true,
      recipient: null,
    });
    await as('daftar').post(base, { kind: 'umum' }).expect(409);

    await as('daftar').post(base, { kind: 'pembukaan_data' }).expect(400);
    await as('daftar').post(base, { kind: 'pembukaan_data', recipient: 'Asuransi Fiktif Sehat' }).expect(201);
    await as('daftar').post(base, { kind: 'pembukaan_data', recipient: 'asuransi fiktif sehat' }).expect(409);

    await as('daftar').post(`${base}/${umum.body.id}/revoke`, { reason: 'singkat' }).expect(400);
    const revoked = await as('daftar')
      .post(`${base}/${umum.body.id}/revoke`, { reason: 'Pasien mencabut persetujuan secara tertulis' })
      .expect(200);
    expect(revoked.body).toMatchObject({
      active: false,
      revokeReason: 'Pasien mencabut persetujuan secara tertulis',
    });
    await as('daftar')
      .post(`${base}/${umum.body.id}/revoke`, { reason: 'Coba cabut sekali lagi' })
      .expect(409);
    await as('daftar').post(base, { kind: 'umum' }).expect(201);

    const list = await as('kasir').get(base).expect(200);
    expect(list.body.map((c: { kind: string; active: boolean }) => [c.kind, c.active])).toEqual(
      expect.arrayContaining([
        ['umum', true],
        ['umum', false],
        ['pembukaan_data', true],
      ]),
    );
    expect(list.body).toHaveLength(3);

    const audits = await withTenant(testDb(), T.id, (tx) =>
      tx.auditEvent.findMany({ where: { resourceType: 'privacy_consent', patientId: p.id } }),
    );
    expect(audits.map((a) => a.action).sort()).toEqual(['create', 'create', 'create', 'deactivate', 'read']);
    expect(jsonText(audits)).not.toContain('Asuransi Fiktif');
    expect(audits.find((a) => a.action === 'deactivate')?.reason).toBe(
      'Pasien mencabut persetujuan secara tertulis',
    );
  });

  it('kasir hanya baca; perawat tanpa relasi ditolak; pasien lain → 404', async () => {
    const p = await createTestPatient(T.id);
    await as('kasir').post(`/api/v1/patients/${p.id}/consents`, { kind: 'umum' }).expect(403);
    await as('perawat').get(`/api/v1/patients/${p.id}/consents`).expect(403);
    const other = await createTestPatient(T.id);
    const c = await as('daftar').post(`/api/v1/patients/${p.id}/consents`, { kind: 'umum' }).expect(201);
    await as('daftar')
      .post(`/api/v1/patients/${other.id}/consents/${c.body.id}/revoke`, { reason: 'Salah pasien dicabut' })
      .expect(404);
  });
});
