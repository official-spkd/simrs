/**
 * P03 · DoD fase 1: "Matriks izin: tes otomatis untuk ≥ 10 kombinasi peran × aksi × relasi" dan
 * "Break-the-glass mencatat alasan dan muncul di laporan".
 */
import type { NestExpressApplication } from '@nestjs/platform-express';
import { type TenantTx, withTenant } from '@simrs/db';
import { newId } from '@simrs/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bearer,
  createTestApp,
  createTestTenant,
  createTestUser,
  login,
  TENANT_A,
  type Tokens,
  testDb,
} from './helpers';

let app: NestExpressApplication;
const http = () => request(app.getHttpServer());
const t: Record<string, Tokens> = {};
const ids: Record<string, string> = {};

beforeAll(async () => {
  app = await createTestApp();
  for (const code of [
    'admin_tenant',
    'petugas_pendaftaran',
    'perawat',
    'petugas_privasi',
    'auditor_mutu',
    'kasir',
  ]) {
    const u = await createTestUser(TENANT_A, { roles: [{ code }] });
    ids[code] = u.id;
    t[code] = await login(app, u);
  }
});

afterAll(async () => {
  await app?.close();
});

const as = (role: string) => ({
  get: (url: string) =>
    http()
      .get(url)
      .set(bearer(t[role] as Tokens)),
  post: (url: string, body: object = {}) =>
    http()
      .post(url)
      .set(bearer(t[role] as Tokens))
      .send(body),
  put: (url: string, body: object) =>
    http()
      .put(url)
      .set(bearer(t[role] as Tokens))
      .send(body),
  patch: (url: string, body: object) =>
    http()
      .patch(url)
      .set(bearer(t[role] as Tokens))
      .send(body),
});
/** Baris audit sebagai teks (kolom `seq` bertipe bigint) untuk memastikan tidak ada rahasia yang bocor. */
const asText = (v: unknown) =>
  JSON.stringify(v, (_k, x: unknown) => (typeof x === 'bigint' ? x.toString() : x));
const loginStep1 = (u: { tenantCode: string; username: string }, password: string) =>
  http().post('/api/v1/auth/login').send({ tenantCode: u.tenantCode, username: u.username, password });

/** Tunggu sampai minimal `n` transaksi sedang menunggu kunci (batas ~5 detik). */
async function waitForLockWaiters(tx: TenantTx, n: number) {
  for (let i = 0; i < 100; i++) {
    const [row] = await tx.$queryRaw<
      Array<{ n: number }>
    >`SELECT count(*)::int AS n FROM pg_locks WHERE NOT granted`;
    if ((row?.n ?? 0) >= n) return;
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe('matriks izin (peran × aksi)', () => {
  it.each([
    ['admin_tenant', 'get', '/api/v1/iam/users', 200],
    ['perawat', 'get', '/api/v1/iam/users', 403],
    ['petugas_privasi', 'get', '/api/v1/iam/users', 200],
    ['admin_tenant', 'get', '/api/v1/iam/roles', 200],
    ['petugas_privasi', 'get', '/api/v1/iam/roles', 403],
    ['auditor_mutu', 'get', '/api/v1/audit/events?limit=1', 200],
    ['perawat', 'get', '/api/v1/audit/events?limit=1', 403],
    ['kasir', 'get', '/api/v1/audit/verify', 403],
    ['admin_tenant', 'get', '/api/v1/settings', 200],
    ['kasir', 'get', '/api/v1/settings', 403],
    ['perawat', 'get', '/api/v1/facility/units?limit=1', 200],
    ['auditor_mutu', 'get', '/api/v1/authz/break-glass', 403],
    ['petugas_privasi', 'get', '/api/v1/authz/break-glass', 200],
  ] as const)('%s %s %s → %i', async (role, method, url, status) => {
    const res = await as(role)[method](url);
    expect(res.status).toBe(status);
  });

  it.each([
    ['admin_tenant', 201],
    ['petugas_pendaftaran', 403],
    ['perawat', 403],
  ] as const)('%s menulis struktur RS → %i', async (role, status) => {
    const f = await as(role).post('/api/v1/facility/facilities', {
      code: `F-${newId().slice(-8).toUpperCase()}`,
      name: 'Uji izin',
    });
    expect(f.status).toBe(status);
  });

  it('penolakan akses tercatat di audit (pelaku, peran, sumber)', async () => {
    const requestId = `uji-${newId()}`;
    await as('perawat').get('/api/v1/iam/users').set('X-Request-Id', requestId).expect(403);
    const [row] = await withTenant(testDb(), TENANT_A, (tx) =>
      tx.auditEvent.findMany({ where: { requestId } }),
    );
    expect(row).toMatchObject({
      action: 'access_denied',
      outcome: 'denied',
      actorUserId: ids.perawat,
      actorRole: 'perawat',
      resourceType: 'iam.users',
    });
  });
});

describe('relasi pasien (ABAC) dan akses darurat', () => {
  it.each([
    ['petugas_pendaftaran', true, 'role'],
    ['perawat', false, null],
    ['kasir', true, 'role'],
  ] as const)('%s tanpa relasi → allowed=%s', async (role, allowed, basis) => {
    const res = await as(role).get(`/api/v1/authz/patients/${newId()}/access`).expect(200);
    expect(res.body).toEqual({ allowed, basis });
  });

  it('auditor tanpa izin baca pasien → 403', async () => {
    await as('auditor_mutu').get(`/api/v1/authz/patients/${newId()}/access`).expect(403);
  });

  it('perawat dengan relasi aktif → boleh; relasi berakhir → tidak', async () => {
    const patientId = newId();
    await withTenant(testDb(), TENANT_A, (tx) =>
      tx.accessRelationship.create({
        data: {
          id: newId(),
          tenantId: TENANT_A,
          userId: ids.perawat as string,
          patientId,
          kind: 'perawat_penanggung_jawab',
        },
      }),
    );
    expect((await as('perawat').get(`/api/v1/authz/patients/${patientId}/access`)).body).toEqual({
      allowed: true,
      basis: 'relationship',
    });
    const ended = newId();
    await withTenant(testDb(), TENANT_A, (tx) =>
      tx.accessRelationship.create({
        data: {
          id: newId(),
          tenantId: TENANT_A,
          userId: ids.perawat as string,
          patientId: ended,
          kind: 'dpjp',
          validFrom: new Date(Date.now() - 7_200_000),
          validUntil: new Date(Date.now() - 3_600_000),
        },
      }),
    );
    expect((await as('perawat').get(`/api/v1/authz/patients/${ended}/access`)).body.allowed).toBe(false);
  });

  it('akses darurat: alasan wajib, berlaku sementara, petugas privasi diberi tahu, tercatat, lalu ditinjau', async () => {
    const patientId = newId();
    await as('perawat').post('/api/v1/authz/break-glass', { patientId, reason: 'singkat' }).expect(400);
    const reason = 'Pasien tidak sadar di IGD, DPJP belum tiba, perlu riwayat alergi';
    const g = await as('perawat').post('/api/v1/authz/break-glass', { patientId, reason }).expect(201);
    expect(g.body.notified).toBeGreaterThanOrEqual(1);
    expect(new Date(g.body.expiresAt).getTime() - Date.now()).toBeGreaterThan(55 * 60_000);
    expect((await as('perawat').get(`/api/v1/authz/patients/${patientId}/access`)).body).toEqual({
      allowed: true,
      basis: 'break_glass',
    });

    const [audit] = await withTenant(testDb(), TENANT_A, (tx) =>
      tx.auditEvent.findMany({ where: { action: 'break_glass', patientId } }),
    );
    expect(audit).toMatchObject({ actorUserId: ids.perawat, reason, resourceType: 'patient' });
    const notes = await withTenant(testDb(), TENANT_A, (tx) =>
      tx.notification.findMany({ where: { recipientUserId: ids.petugas_privasi, kind: 'break_glass' } }),
    );
    expect(notes.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(notes)).not.toContain(patientId);

    const list = await as('petugas_privasi')
      .get('/api/v1/authz/break-glass?pending=true&limit=200')
      .expect(200);
    expect(list.body.map((x: { id: string }) => x.id)).toContain(g.body.id);
    await as('perawat').post(`/api/v1/authz/break-glass/${g.body.id}/review`, { outcome: 'sah' }).expect(403);
    await as('petugas_privasi')
      .post(`/api/v1/authz/break-glass/${g.body.id}/review`, { outcome: 'sah', note: 'Sesuai SOP IGD' })
      .expect(200);
    const after = await as('petugas_privasi')
      .get('/api/v1/authz/break-glass?pending=false&limit=200')
      .expect(200);
    expect(after.body.find((x: { id: string }) => x.id === g.body.id)).toMatchObject({
      reviewOutcome: 'sah',
    });
  });

  it('peran tanpa izin akses darurat ditolak', async () => {
    await as('auditor_mutu')
      .post('/api/v1/authz/break-glass', {
        patientId: newId(),
        reason: 'Alasan yang cukup panjang untuk lolos validasi',
      })
      .expect(403);
  });
});

describe('penugasan sesi', () => {
  it('tanpa penugasan → 403 dengan arahan memilih unit; daftar penugasan kosong', async () => {
    const u = await createTestUser(TENANT_A);
    const tok = await login(app, u);
    const res = await http().get('/api/v1/iam/users').set(bearer(tok)).expect(403);
    expect(res.body.message).toMatch(/Pilih unit kerja/);
    expect((await http().get('/api/v1/auth/assignments').set(bearer(tok)).expect(200)).body).toEqual([]);
  });

  it('dua penugasan → pilih salah satu; izin mengikuti penugasan terpilih', async () => {
    const u = await createTestUser(TENANT_A, { roles: [{ code: 'perawat' }, { code: 'admin_tenant' }] });
    const tok = await login(app, u);
    await http().get('/api/v1/iam/users').set(bearer(tok)).expect(403);
    const list = await http().get('/api/v1/auth/assignments').set(bearer(tok)).expect(200);
    expect(list.body).toHaveLength(2);
    const adminA = list.body.find((a: { roleCode: string }) => a.roleCode === 'admin_tenant');
    await http()
      .post('/api/v1/auth/assignment')
      .set(bearer(tok))
      .send({ assignmentId: adminA.id })
      .expect(200);
    await http().get('/api/v1/iam/users').set(bearer(tok)).expect(200);
    await http().post('/api/v1/auth/assignment').set(bearer(tok)).send({ assignmentId: newId() }).expect(404);
  });

  it('penugasan diakhiri admin → izin sesi yang sedang berjalan langsung hilang', async () => {
    const u = await createTestUser(TENANT_A, { roles: [{ code: 'auditor_mutu' }] });
    const tok = await login(app, u);
    await http().get('/api/v1/audit/events?limit=1').set(bearer(tok)).expect(200);
    const [a] = (await http().get('/api/v1/auth/assignments').set(bearer(tok))).body as Array<{ id: string }>;
    await as('admin_tenant')
      .post(`/api/v1/iam/assignments/${a?.id}/end`, { reason: 'Mutasi unit' })
      .expect(200);
    await http().get('/api/v1/audit/events?limit=1').set(bearer(tok)).expect(403);
  });
});

describe('manajemen pengguna dan matriks', () => {
  it('buat pengguna → sandi sementara sekali tampil; login pertama wajib daftar MFA', async () => {
    const username = `baru.${newId().slice(-10)}`;
    const created = await as('admin_tenant')
      .post('/api/v1/iam/users', {
        username,
        displayName: 'Perawat Baru Fiktif',
        assignments: [{ roleCode: 'perawat' }],
      })
      .expect(201);
    expect(created.body.temporaryPassword).toHaveLength(16);
    const l = await http()
      .post('/api/v1/auth/login')
      .send({ tenantCode: 'RSFA', username, password: created.body.temporaryPassword })
      .expect(200);
    expect(l.body).toMatchObject({ status: 'mfa_enrollment_required', mustChangePassword: true });
    const [audit] = await withTenant(testDb(), TENANT_A, (tx) =>
      tx.auditEvent.findMany({
        where: { action: 'create', resourceType: 'user', resourceId: created.body.id },
      }),
    );
    expect(audit).toBeDefined();
    expect(asText(audit)).not.toContain(created.body.temporaryPassword);
  });

  it('reset sandi mencabut sesi aktif; sandi lama mati, sandi sementara wajib diganti', async () => {
    const u = await createTestUser(TENANT_A, { roles: [{ code: 'kasir' }] });
    const tok = await login(app, u);
    const r = await as('admin_tenant').post(`/api/v1/iam/users/${u.id}/reset-password`).expect(200);
    await http().get('/api/v1/auth/me').set(bearer(tok)).expect(401);
    await loginStep1(u, u.password).expect(401);
    const l = await loginStep1(u, r.body.temporaryPassword).expect(200);
    expect(l.body.status).toBe('mfa_required');
    const [audit] = await withTenant(testDb(), TENANT_A, (tx) =>
      tx.auditEvent.findMany({ where: { resourceType: 'user_credential', resourceId: u.id } }),
    );
    expect(audit).toBeDefined();
    expect(asText(audit)).not.toContain(r.body.temporaryPassword);
  });

  it('menonaktifkan akun mencabut sesinya seketika dan menolak login berikutnya', async () => {
    const u = await createTestUser(TENANT_A, { roles: [{ code: 'kasir' }] });
    const tok = await login(app, u);
    await as('admin_tenant').patch(`/api/v1/iam/users/${u.id}`, { status: 'disabled' }).expect(200);
    await http().get('/api/v1/auth/me').set(bearer(tok)).expect(401);
    await loginStep1(u, u.password).expect(401);
    await as('admin_tenant').patch(`/api/v1/iam/users/${u.id}`, { status: 'active' }).expect(200);
    await loginStep1(u, u.password).expect(200);
  });

  it('penugasan yang belum mulai bisa dibatalkan (rentang kosong) dan alasannya tercatat', async () => {
    const u = await createTestUser(TENANT_A);
    const validFrom = new Date(Date.now() + 7 * 86_400_000).toISOString();
    const a = await as('admin_tenant')
      .post(`/api/v1/iam/users/${u.id}/assignments`, { roleCode: 'perawat', validFrom })
      .expect(201);
    const ended = await as('admin_tenant')
      .post(`/api/v1/iam/assignments/${a.body.id}/end`, { reason: 'Rotasi dibatalkan' })
      .expect(200);
    expect(ended.body.validUntil).toBe(validFrom);
    await as('admin_tenant')
      .post(`/api/v1/iam/assignments/${a.body.id}/end`, { reason: 'Rotasi dibatalkan' })
      .expect(409);
    const [audit] = await withTenant(testDb(), TENANT_A, (tx) =>
      tx.auditEvent.findMany({
        where: { resourceType: 'staff_assignment', resourceId: a.body.id, action: 'update' },
      }),
    );
    expect(audit?.reason).toBe('Rotasi dibatalkan');
  });

  it('ubah matriks: cabut audit.read dari auditor_mutu berlaku seketika; admin tidak bisa mencabut izin kelola akses', async () => {
    const roles = await as('admin_tenant').get('/api/v1/iam/roles').expect(200);
    const auditor = roles.body.roles.find((r: { code: string }) => r.code === 'auditor_mutu');
    const original = auditor.permissions as Array<{ resource: string; action: string; scope: string }>;
    try {
      const without = original.filter((g) => !(g.resource === 'audit' && g.action === 'read'));
      const res = await as('admin_tenant')
        .put('/api/v1/iam/roles/auditor_mutu/permissions', { grants: without })
        .expect(200);
      expect(res.body.removed).toContain('audit.read:all');
      await as('auditor_mutu').get('/api/v1/audit/events?limit=1').expect(403);
    } finally {
      await as('admin_tenant')
        .put('/api/v1/iam/roles/auditor_mutu/permissions', { grants: original })
        .expect(200);
    }
    await as('auditor_mutu').get('/api/v1/audit/events?limit=1').expect(200);
    const admin = roles.body.roles.find((r: { code: string }) => r.code === 'admin_tenant');
    const crippled = (admin.permissions as Array<{ resource: string; action: string }>).filter(
      (g) => !(g.resource === 'iam.roles' && g.action === 'write'),
    );
    await as('admin_tenant')
      .put('/api/v1/iam/roles/admin_tenant/permissions', { grants: crippled })
      .expect(409);
    await as('admin_tenant')
      .put('/api/v1/iam/roles/perawat/permissions', {
        grants: [{ resource: 'tidak.ada', action: 'read', scope: 'all' }],
      })
      .expect(400);
  });

  it('RS tidak bisa kehilangan admin terakhir; admin tidak bisa menonaktifkan dirinya', async () => {
    const T = await createTestTenant();
    const admin = await createTestUser(T.id, { roles: [{ code: 'admin_tenant' }], tenantCode: T.code });
    const tok = await login(app, admin);
    await http()
      .patch(`/api/v1/iam/users/${admin.id}`)
      .set(bearer(tok))
      .send({ status: 'disabled' })
      .expect(409);
    const [a] = (await http().get('/api/v1/auth/assignments').set(bearer(tok))).body as Array<{ id: string }>;
    const res = await http()
      .post(`/api/v1/iam/assignments/${a?.id}/end`)
      .set(bearer(tok))
      .send({ reason: 'Uji admin terakhir' })
      .expect(409);
    expect(res.body.message).toMatch(/minimal satu admin/);
  });

  it('izin kelola pengguna yang didelegasikan tidak bisa dipakai untuk eskalasi ke admin', async () => {
    const T = await createTestTenant();
    const admin = await createTestUser(T.id, { roles: [{ code: 'admin_tenant' }], tenantCode: T.code });
    const sdm = await createTestUser(T.id, { roles: [{ code: 'manajemen' }], tenantCode: T.code });
    const ta = await login(app, admin);
    const roles = await http().get('/api/v1/iam/roles').set(bearer(ta)).expect(200);
    const manajemen = roles.body.roles.find((r: { code: string }) => r.code === 'manajemen');
    const grants = [
      ...(manajemen.permissions as Array<{ resource: string; action: string; scope: string }>).filter(
        (g) => g.resource !== 'iam.users',
      ),
      { resource: 'iam.users', action: 'read', scope: 'all' },
      { resource: 'iam.users', action: 'write', scope: 'all' },
    ];
    await http().put('/api/v1/iam/roles/manajemen/permissions').set(bearer(ta)).send({ grants }).expect(200);

    const ts = await login(app, sdm);
    const asSdm = (method: 'post' | 'patch', url: string, body: object = {}) =>
      http()[method](url).set(bearer(ts)).send(body);
    const uname = () => `sdm.${newId().slice(-10)}`;
    // Boleh: kelola staf biasa.
    const staff = await asSdm('post', '/api/v1/iam/users', {
      username: uname(),
      displayName: 'Perawat Fiktif',
      assignments: [{ roleCode: 'perawat' }],
    }).expect(201);
    await asSdm('post', `/api/v1/iam/users/${staff.body.id}/reset-password`).expect(200);
    // Tidak boleh: membuat admin, menyentuh akun admin, mencabut peran admin, atau menambah peran ke diri sendiri.
    const escalate = uname();
    await asSdm('post', '/api/v1/iam/users', {
      username: escalate,
      displayName: 'Admin Gelap',
      assignments: [{ roleCode: 'admin_tenant' }],
    }).expect(403);
    await asSdm('post', `/api/v1/iam/users/${staff.body.id}/assignments`, {
      roleCode: 'admin_tenant',
    }).expect(403);
    await asSdm('post', `/api/v1/iam/users/${admin.id}/reset-password`).expect(403);
    await asSdm('post', `/api/v1/iam/users/${admin.id}/reset-mfa`).expect(403);
    await asSdm('patch', `/api/v1/iam/users/${admin.id}`, { status: 'disabled' }).expect(403);
    const [adminAssignment] = (await http().get('/api/v1/auth/assignments').set(bearer(ta))).body as Array<{
      id: string;
    }>;
    await asSdm('post', `/api/v1/iam/assignments/${adminAssignment?.id}/end`, {
      reason: 'Coba cabut admin',
    }).expect(403);
    await asSdm('post', `/api/v1/iam/users/${sdm.id}/assignments`, { roleCode: 'perawat' }).expect(409);
    // Permintaan yang ditolak dibatalkan seluruhnya: akun "Admin Gelap" tidak tersimpan.
    const list = await http().get(`/api/v1/iam/users?search=${escalate}`).set(bearer(ta)).expect(200);
    expect(list.body.items).toEqual([]);
  });

  it('aturan admin terakhir tidak menghalangi menonaktifkan staf biasa', async () => {
    // RS tanpa admin aktif (mis. baru dibuat): menonaktifkan staf non-admin tetap boleh.
    const T = await createTestTenant();
    const staff = await createTestUser(T.id, { roles: [{ code: 'perawat' }], tenantCode: T.code });
    await http()
      .patch(`/api/v1/iam/users/${staff.id}`)
      .set('X-Tenant-Id', T.id)
      .send({ status: 'disabled' })
      .expect(200);
  });

  it('dua admin terakhir saling menonaktifkan bersamaan → hanya satu yang berhasil', async () => {
    const T = await createTestTenant();
    const [a, b] = await Promise.all(
      [0, 1].map(() => createTestUser(T.id, { roles: [{ code: 'admin_tenant' }], tenantCode: T.code })),
    );
    if (!a || !b) throw new Error('admin uji tidak terbentuk');
    const [ta, tb] = [await login(app, a), await login(app, b)];
    // Paksa tumpang tindih: tahan kunci baris kedua pengguna sampai kedua permintaan sedang menunggu,
    // sehingga keduanya sudah melewati login/izin dan berebut di pemeriksaan "admin terakhir".
    let pending: Promise<request.Response[]> | undefined;
    await withTenant(testDb(), T.id, async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id IN (${a.id}::uuid, ${b.id}::uuid) FOR NO KEY UPDATE`;
      pending = Promise.all([
        http()
          .patch(`/api/v1/iam/users/${b.id}`)
          .set(bearer(ta))
          .send({ status: 'disabled' })
          .then((r) => r),
        http()
          .patch(`/api/v1/iam/users/${a.id}`)
          .set(bearer(tb))
          .send({ status: 'disabled' })
          .then((r) => r),
      ]);
      await waitForLockWaiters(tx, 2);
    });
    const results = await (pending as Promise<request.Response[]>);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const active = await withTenant(testDb(), T.id, (tx) => tx.user.count({ where: { status: 'active' } }));
    expect(active).toBe(1);
  });

  it('isolasi tenant: admin RS lain tidak melihat pengguna RS A', async () => {
    const T = await createTestTenant();
    const otherAdmin = await createTestUser(T.id, { roles: [{ code: 'admin_tenant' }], tenantCode: T.code });
    const tok = await login(app, otherAdmin);
    const list = await http().get('/api/v1/iam/users?limit=200').set(bearer(tok)).expect(200);
    expect(list.body.items.map((u: { id: string }) => u.id)).toEqual([otherAdmin.id]);
    await http()
      .patch(`/api/v1/iam/users/${ids.perawat}`)
      .set(bearer(tok))
      .send({ displayName: 'Diambil alih' })
      .expect(404);
  });
});
