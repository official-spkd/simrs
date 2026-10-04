/**
 * P05 → I05 · Permintaan verifikasi NIK ke Dukcapil dari API: otomatis saat NIK dicatat, verifikasi ulang
 * manual, pesan outbox tanpa PHI dengan idempotency key deterministik. Pengiriman dan hasilnya diuji di worker.
 */
import type { NestExpressApplication } from '@nestjs/platform-express';
import { withTenant } from '@simrs/db';
import { DUKCAPIL_VERIFY_OPERATION } from '@simrs/shared';
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

let app: NestExpressApplication;
let T: { id: string; code: string };
const tok: Record<string, Tokens> = {};
const http = () => request(app.getHttpServer());
const as = (who: string) => {
  const auth = () => bearer(tok[who] as Tokens);
  return {
    post: (url: string, body: object = {}) => http().post(url).set(auth()).send(body),
    put: (url: string, body: object) => http().put(url).set(auth()).send(body),
  };
};
const nik = () => `999901540372${String(Math.floor(Math.random() * 10_000)).padStart(4, '0')}`;

const outbox = (identifierId: string) =>
  withTenant(testDb(), T.id, (tx) =>
    tx.outboxMessage.findMany({
      where: {
        operation: DUKCAPIL_VERIFY_OPERATION,
        payload: { path: ['identifierId'], equals: identifierId },
      },
      orderBy: { createdAt: 'asc' },
    }),
  );
const nikRow = (patientId: string) =>
  withTenant(testDb(), T.id, (tx) =>
    tx.patientIdentifier.findFirstOrThrow({ where: { patientId, system: 'nik', active: true } }),
  );

beforeAll(async () => {
  app = await createTestApp();
  T = await createTestTenant();
  for (const [who, role] of [
    ['daftar', 'petugas_pendaftaran'],
    ['kasir', 'kasir'],
  ] as const) {
    const user: TestUser = await createTestUser(T.id, { roles: [{ code: role }], tenantCode: T.code });
    tok[who] = await login(app, user);
  }
});

afterAll(async () => {
  await app.close();
});

describe('verifikasi NIK ke Dukcapil (lewat outbox)', () => {
  it('NIK baru diantrekan otomatis: status menunggu, payload hanya ID, kunci idempoten per permintaan', async () => {
    const n = nik();
    const p = await as('daftar')
      .post('/api/v1/patients', {
        name: 'Sri Lestari',
        sex: 'female',
        birthDate: '1972-03-14',
        identifiers: { nik: n },
      })
      .expect(201);
    const ident = await nikRow(p.body.id);
    expect(ident.verificationStatus).toBe('pending');
    const [msg] = await outbox(ident.id);
    expect(msg).toMatchObject({
      target: 'dukcapil',
      status: 'pending',
      idempotencyKey: `nik-verify:${ident.id}:1`,
      payload: { patientId: p.body.id, identifierId: ident.id },
    });
    expect(JSON.stringify(msg?.payload)).not.toContain(n);
  });

  it('verifikasi ulang: ditolak bila masih menunggu < 5 menit, lalu diantrekan dan diaudit', async () => {
    const p = await as('daftar')
      .post('/api/v1/patients', {
        name: 'Dewi Sartika',
        sex: 'female',
        birthDate: '1972-03-14',
        identifiers: { nik: nik() },
      })
      .expect(201);
    await as('daftar').post(`/api/v1/patients/${p.body.id}/identifiers/nik/verify`).expect(409);

    const ident = await nikRow(p.body.id);
    // Permintaan pertama sudah 10 menit tanpa hasil (mis. worker sempat mati).
    await withTenant(testDb(), T.id, (tx) =>
      tx.patientIdentifier.update({
        where: { id: ident.id },
        data: {
          verificationDetails: { requests: 1, requestedAt: new Date(Date.now() - 600_000).toISOString() },
        },
      }),
    );
    const res = await as('daftar').post(`/api/v1/patients/${p.body.id}/identifiers/nik/verify`).expect(202);
    expect(res.body.identifiers.find((i: { system: string }) => i.system === 'nik')).toMatchObject({
      verification: 'pending',
    });
    expect((await outbox(ident.id)).map((m) => m.idempotencyKey)).toEqual([
      `nik-verify:${ident.id}:1`,
      `nik-verify:${ident.id}:2`,
    ]);
    const audit = await withTenant(testDb(), T.id, (tx) =>
      tx.auditEvent.findFirst({ where: { action: 'verify', resourceId: ident.id } }),
    );
    expect(audit).toMatchObject({ patientId: p.body.id, details: { system: 'nik', requested: true } });
    await as('kasir').post(`/api/v1/patients/${p.body.id}/identifiers/nik/verify`).expect(403);
  });

  it('NIK diganti: NIK baru diantrekan, pasien tanpa NIK → 404', async () => {
    const p = await as('daftar')
      .post('/api/v1/patients', { name: 'Tanpa NIK', sex: 'male', birthDate: '1980-01-01' })
      .expect(201);
    await as('daftar').post(`/api/v1/patients/${p.body.id}/identifiers/nik/verify`).expect(404);
    await as('daftar').put(`/api/v1/patients/${p.body.id}/identifiers/nik`, { value: nik() }).expect(200);
    const ident = await nikRow(p.body.id);
    expect(ident.verificationStatus).toBe('pending');
    expect(await outbox(ident.id)).toHaveLength(1);
  });
});
