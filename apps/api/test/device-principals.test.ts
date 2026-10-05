/**
 * ADR-0027 · Prinsipal perangkat anjungan/TV: pendaftaran oleh admin, penukaran kode sekali pakai, identitas,
 * izin tetap per jenis, penolakan di endpoint staf (403 + audit), pencabutan, isolasi tenant, batas laju per
 * perangkat, dan `deviceId` di `details` audit.
 */
import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { withTenant } from '@simrs/db';
import { newId } from '@simrs/shared';
import { blindIndex } from '@simrs/shared/node';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Audited } from '../src/common/audited.decorator';
import { DeviceScoped } from '../src/common/device-scoped.decorator';
import { RequirePermission } from '../src/common/require-permission.decorator';
import { generateEnrolmentCode } from '../src/modules/devices/devices.service';
import {
  bearer,
  createTestApp,
  createTestUser,
  jsonText,
  login,
  TENANT_A,
  TENANT_B,
  type Tokens,
  testDb,
} from './helpers';

@Controller('test-infra/device')
@DeviceScoped('queue.display.read')
class DisplayOnlyController {
  @Get('board')
  @Audited({ action: 'read', resource: 'test_board' })
  board() {
    return { ok: true };
  }
}

@Controller('test-infra/device-misassembled')
@DeviceScoped()
class MisassembledController {
  @Post()
  @HttpCode(200)
  @RequirePermission('patient', 'read')
  run() {
    return { ok: true };
  }
}

let app: NestExpressApplication;
const http = () => request(app.getHttpServer());
const t: Record<string, Tokens> = {};
const units: Record<string, string> = {};

async function createUnit(tenantId: string): Promise<string> {
  const facilityId = newId();
  const id = newId();
  const suffix = id.slice(-6).toUpperCase();
  await withTenant(testDb(), tenantId, async (tx) => {
    await tx.facility.create({ data: { id: facilityId, tenantId, code: `F${suffix}`, name: 'Gedung uji' } });
    await tx.unit.create({
      data: { id, tenantId, facilityId, code: `L${suffix}`, name: 'Lobi rawat jalan', kind: 'administrasi' },
    });
  });
  return id;
}

const auditRows = (tenantId: string, where: object) =>
  withTenant(testDb(), tenantId, (tx) => tx.auditEvent.findMany({ where, orderBy: { seq: 'asc' } }));

async function registerDevice(admin: Tokens, kind: 'kiosk' | 'display', unitId: string) {
  const res = await http()
    .post('/api/v1/iam/devices')
    .set(bearer(admin))
    .send({ kind, name: kind === 'kiosk' ? 'Anjungan lobi' : 'TV ruang tunggu', unitId })
    .expect(201);
  return res.body as { id: string; device: { status: string }; enrolmentCode: string };
}

function enrol(code: string, tenantCode = 'RSFA') {
  return http()
    .post('/api/v1/devices/enrol')
    .set('User-Agent', 'Chrome kiosk uji')
    .send({ tenantCode, code });
}

async function enrolled(admin: Tokens, kind: 'kiosk' | 'display', unitId = units.a as string) {
  const created = await registerDevice(admin, kind, unitId);
  const res = await enrol(created.enrolmentCode).expect(200);
  return { id: created.id, token: res.body.token as string };
}

const asDevice = (token: string) => ({ Authorization: `Bearer ${token}` });

beforeAll(async () => {
  app = await createTestApp(
    {},
    {
      imports: [
        { module: class DeviceTestModule {}, controllers: [DisplayOnlyController, MisassembledController] },
      ],
    },
  );
  units.a = await createUnit(TENANT_A);
  units.b = await createUnit(TENANT_B);
  t.adminA = await login(app, await createTestUser(TENANT_A, { roles: [{ code: 'admin_tenant' }] }));
  t.adminB = await login(app, await createTestUser(TENANT_B, { roles: [{ code: 'admin_tenant' }] }));
  t.perawat = await login(app, await createTestUser(TENANT_A, { roles: [{ code: 'perawat' }] }));
});

afterAll(async () => {
  await app?.close();
});

describe('pendaftaran perangkat oleh admin', () => {
  it('admin mendaftarkan anjungan: kode sekali tampil, status menunggu, audit tanpa kode', async () => {
    const res = await http()
      .post('/api/v1/iam/devices')
      .set(bearer(t.adminA as Tokens))
      .send({ kind: 'kiosk', name: 'Anjungan lobi utama', unitId: units.a })
      .expect(201);
    expect(res.body.enrolmentCode).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/);
    expect(res.body.device).toMatchObject({
      kind: 'kiosk',
      name: 'Anjungan lobi utama',
      status: 'pending',
      unit: { id: units.a, name: 'Lobi rawat jalan' },
      enrolledAt: null,
    });
    const rows = await auditRows(TENANT_A, { resourceType: 'registered_device', resourceId: res.body.id });
    expect(rows.map((r) => [r.action, r.details])).toEqual([['create', { kind: 'kiosk', unitId: units.a }]]);
    const code = (res.body.enrolmentCode as string).replace('-', '');
    expect(jsonText(rows)).not.toContain(code);
    const stored = await withTenant(testDb(), TENANT_A, (tx) =>
      tx.registeredDevice.findUniqueOrThrow({ where: { id: res.body.id } }),
    );
    expect(jsonText(stored)).not.toContain(code);
    expect(stored.tokenHash).toBeNull();
  });

  it('peran tanpa iam.users.write → 403; unit tenant lain atau tidak dikenal → 400', async () => {
    await http()
      .post('/api/v1/iam/devices')
      .set(bearer(t.perawat as Tokens))
      .send({ kind: 'kiosk', name: 'Anjungan', unitId: units.a })
      .expect(403);
    const res = await http()
      .post('/api/v1/iam/devices')
      .set(bearer(t.adminA as Tokens))
      .send({ kind: 'display', name: 'TV', unitId: units.b });
    expect(res.status).toBe(400);
    await http()
      .post('/api/v1/iam/devices')
      .set(bearer(t.adminA as Tokens))
      .send({ kind: 'staff_pin', name: 'PIN', unitId: units.a })
      .expect(400);
  });
});

describe('penukaran kode oleh perangkat', () => {
  it('kode benar (ketikan longgar) → token dv1 sekali; kode dipakai ulang atau salah → 401 + audit', async () => {
    const created = await registerDevice(t.adminA as Tokens, 'kiosk', units.a as string);
    const typed = created.enrolmentCode.toLowerCase().replace('-', ' ');
    const ok = await enrol(typed).expect(200);
    expect(ok.body.token).toMatch(/^dv1\./);
    expect(ok.body.device).toMatchObject({ id: created.id, kind: 'kiosk' });
    expect(ok.body.permissions).toEqual(['kiosk.use']);

    const again = await enrol(created.enrolmentCode);
    expect(again.status).toBe(401);
    expect(again.body.code).toBe('UNAUTHENTICATED');
    await enrol('ABCDE-FGHJK').expect(401);
    await enrol('bukan kode').expect(401);

    const login = await auditRows(TENANT_A, { resourceId: created.id, action: 'login' });
    expect(login.map((r) => r.details)).toEqual([
      { method: 'device_enrolment', deviceId: created.id, deviceKind: 'kiosk' },
    ]);
    const failures = await auditRows(TENANT_A, {
      action: 'login_failed',
      resourceType: 'registered_device',
      requestId: again.body.requestId,
    });
    expect(failures.map((r) => (r.details as { reason: string }).reason)).toEqual(['bad_code']);
    expect(jsonText(await auditRows(TENANT_A, { resourceId: created.id }))).not.toContain(ok.body.token);
  });

  it('kode milik RS lain tidak berlaku dengan kode RS ini', async () => {
    const created = await registerDevice(t.adminA as Tokens, 'display', units.a as string);
    await enrol(created.enrolmentCode, 'RSFB').expect(401);
    await enrol(created.enrolmentCode, 'RSXX').expect(401);
    await enrol(created.enrolmentCode, 'RSFA').expect(200);
  });

  it('kode kedaluwarsa → 401 dan tercatat code_expired', async () => {
    const id = newId();
    const code = generateEnrolmentCode();
    const createdAt = new Date(Date.now() - 20 * 60_000);
    await withTenant(testDb(), TENANT_A, (tx) =>
      tx.registeredDevice.create({
        data: {
          id,
          tenantId: TENANT_A,
          kind: 'kiosk',
          name: 'Anjungan lama',
          unitId: units.a,
          createdAt,
          expiresAt: new Date(createdAt.getTime() + 365 * 86_400_000),
          enrolExpiresAt: new Date(createdAt.getTime() + 15 * 60_000),
          enrolCodeHash: blindIndex(code, {
            hashKeyB64: process.env.FIELD_HASH_KEY ?? '',
            tenantId: TENANT_A,
            purpose: 'device_enrolment',
          }),
        },
      }),
    );
    const res = await enrol(code);
    expect(res.status).toBe(401);
    const rows = await auditRows(TENANT_A, { resourceId: id, action: 'login_failed' });
    expect(rows.map((r) => r.details)).toEqual([
      { method: 'device_enrolment', reason: 'code_expired', deviceId: id, deviceKind: 'kiosk' },
    ]);
  });
});

describe('sesi perangkat', () => {
  it('GET /devices/me: identitas + izin tetap; token staf → 403; tanpa token/header pengembang → 401', async () => {
    const kiosk = await enrolled(t.adminA as Tokens, 'kiosk');
    const me = await http().get('/api/v1/devices/me').set(asDevice(kiosk.token)).expect(200);
    expect(me.body).toMatchObject({
      id: kiosk.id,
      kind: 'kiosk',
      unit: { id: units.a },
      permissions: ['kiosk.use'],
    });
    await http()
      .get('/api/v1/devices/me')
      .set(bearer(t.adminA as Tokens))
      .expect(403);
    await http().get('/api/v1/devices/me').expect(401);
    await http().get('/api/v1/devices/me').set('X-Tenant-Id', TENANT_A).expect(401);
    // Rahasia salah dengan id benar.
    const forged = kiosk.token.replace(/\.[A-Za-z0-9_-]{43}$/, `.${'A'.repeat(43)}`);
    await http().get('/api/v1/devices/me').set(asDevice(forged)).expect(401);
  });

  it('perangkat di endpoint staf → 403 + access_denied dengan deviceId; token palsu → 401 tanpa audit', async () => {
    const display = await enrolled(t.adminA as Tokens, 'display');
    for (const path of ['/api/v1/iam/users', '/api/v1/tenancy/current', '/api/v1/patients?q=ab']) {
      const requestId = newId();
      const res = await http().get(path).set(asDevice(display.token)).set('X-Request-Id', requestId);
      expect(res.status).toBe(403);
      const rows = await auditRows(TENANT_A, { requestId });
      expect(rows.map((r) => [r.action, r.outcome, r.actorUserId, r.details])).toEqual([
        [
          'access_denied',
          'denied',
          null,
          { path: path.split('?')[0], deviceId: display.id, deviceKind: 'display' },
        ],
      ]);
    }
    const requestId = newId();
    const forged = `dv1.${TENANT_A}.${newId()}.${'A'.repeat(43)}`;
    await http().get('/api/v1/iam/users').set(asDevice(forged)).set('X-Request-Id', requestId).expect(401);
    expect(await auditRows(TENANT_A, { requestId })).toEqual([]);
  });

  it('izin tetap per jenis: display boleh papan, anjungan 403 + audit; audit endpoint perangkat membawa deviceId', async () => {
    const display = await enrolled(t.adminA as Tokens, 'display');
    const kiosk = await enrolled(t.adminA as Tokens, 'kiosk');
    const okId = newId();
    await http()
      .get('/api/v1/test-infra/device/board')
      .set(asDevice(display.token))
      .set('X-Request-Id', okId)
      .expect(200);
    expect((await auditRows(TENANT_A, { requestId: okId })).map((r) => [r.action, r.details])).toEqual([
      ['read', { deviceId: display.id, deviceKind: 'display' }],
    ]);
    const deniedId = newId();
    await http()
      .get('/api/v1/test-infra/device/board')
      .set(asDevice(kiosk.token))
      .set('X-Request-Id', deniedId)
      .expect(403);
    expect((await auditRows(TENANT_A, { requestId: deniedId })).map((r) => [r.action, r.details])).toEqual([
      ['access_denied', { permission: 'queue.display.read', deviceId: kiosk.id, deviceKind: 'kiosk' }],
    ]);
    // Matriks peran manusia tidak pernah berlaku untuk perangkat.
    await http().post('/api/v1/test-infra/device-misassembled').set(asDevice(kiosk.token)).expect(403);
  });

  it('pencabutan oleh admin berlaku di permintaan berikutnya; status di daftar; cabut ulang 409', async () => {
    const kiosk = await enrolled(t.adminA as Tokens, 'kiosk');
    await http().get('/api/v1/devices/me').set(asDevice(kiosk.token)).expect(200);
    await http()
      .post(`/api/v1/iam/devices/${kiosk.id}/revoke`)
      .set(bearer(t.adminA as Tokens))
      .expect(200);
    await http().get('/api/v1/devices/me').set(asDevice(kiosk.token)).expect(401);
    await http()
      .post(`/api/v1/iam/devices/${kiosk.id}/revoke`)
      .set(bearer(t.adminA as Tokens))
      .expect(409);
    const list = await http()
      .get('/api/v1/iam/devices?kind=kiosk&limit=200')
      .set(bearer(t.adminA as Tokens))
      .expect(200);
    const row = (list.body.items as Array<{ id: string; status: string }>).find((d) => d.id === kiosk.id);
    expect(row?.status).toBe('revoked');
    const audit = await auditRows(TENANT_A, { resourceId: kiosk.id, action: 'deactivate' });
    expect(audit.map((r) => r.details)).toEqual([{ reason: 'admin_revoked' }]);
  });

  it('isolasi tenant: admin RS lain tidak melihat atau mencabut; kode belum dipakai bisa dicabut', async () => {
    const pending = await registerDevice(t.adminA as Tokens, 'display', units.a as string);
    const listB = await http()
      .get('/api/v1/iam/devices?limit=200')
      .set(bearer(t.adminB as Tokens))
      .expect(200);
    expect((listB.body.items as Array<{ id: string }>).some((d) => d.id === pending.id)).toBe(false);
    await http()
      .post(`/api/v1/iam/devices/${pending.id}/revoke`)
      .set(bearer(t.adminB as Tokens))
      .expect(404);
    await http()
      .post(`/api/v1/iam/devices/${pending.id}/revoke`)
      .set(bearer(t.adminA as Tokens))
      .expect(200);
    await enrol(pending.enrolmentCode).expect(401);
  });
});

describe('batas laju per perangkat', () => {
  it('USER_RATE_LIMIT_PER_MIN berlaku per perangkat', async () => {
    const limited = await createTestApp({ USER_RATE_LIMIT_PER_MIN: '3' });
    try {
      const created = await registerDevice(t.adminA as Tokens, 'display', units.a as string);
      const res = await request(limited.getHttpServer())
        .post('/api/v1/devices/enrol')
        .send({ tenantCode: 'RSFA', code: created.enrolmentCode })
        .expect(200);
      const statuses: number[] = [];
      for (let i = 0; i < 4; i++) {
        const r = await request(limited.getHttpServer())
          .get('/api/v1/devices/me')
          .set(asDevice(res.body.token));
        statuses.push(r.status);
      }
      expect(statuses).toEqual([200, 200, 200, 429]);
    } finally {
      await limited.close();
    }
  });
});
