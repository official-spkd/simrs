/**
 * Data layar Audit (/sistem/audit): filter jejak, detail, temuan anomali + tinjauannya, ekspor paket bukti,
 * laporan harian akses darurat. Tenant fiktif baru agar temuan pasti.
 */
import type { NestExpressApplication } from '@nestjs/platform-express';
import { withTenant } from '@simrs/db';
import { jakartaParts, newId } from '@simrs/shared';
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
const http = () => request(app.getHttpServer());
const as = (who: string) => ({
  get: (url: string) =>
    http()
      .get(url)
      .set(bearer(tok[who] as Tokens)),
  post: (url: string, body: object = {}) =>
    http()
      .post(url)
      .set(bearer(tok[who] as Tokens))
      .send(body),
  put: (url: string, body: object) =>
    http()
      .put(url)
      .set(bearer(tok[who] as Tokens))
      .send(body),
});

/** Tanggal WIB hari ini, YYYY-MM-DD. */
function todayWib(offsetDays = 0): string {
  const p = jakartaParts(new Date(Date.now() + offsetDays * 86_400_000));
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** Sisipkan entri audit sintetis (waktu, seq, dan hash tetap diisi trigger server). */
function insertEvents(
  rows: Array<{ actor: TestUser; role: string; action: string; patientId?: string; reason?: string }>,
) {
  return withTenant(testDb(), T.id, async (tx) => {
    for (const r of rows) {
      await tx.auditEvent.create({
        data: {
          id: newId(),
          tenantId: T.id,
          actorUserId: r.actor.id,
          actorRole: r.role,
          patientId: r.patientId ?? null,
          resourceType: r.patientId ? 'patient' : 'session',
          resourceId: r.patientId ?? null,
          action: r.action,
          outcome: r.action === 'login_failed' || r.action === 'access_denied' ? 'denied' : 'success',
          reason: r.reason ?? null,
        },
      });
    }
  });
}

beforeAll(async () => {
  app = await createTestApp();
  T = await createTestTenant();
  for (const [key, code] of [
    ['admin', 'admin_tenant'],
    ['privasi', 'petugas_privasi'],
    ['perawat', 'perawat'],
    ['kasir', 'kasir'],
  ] as const) {
    u[key] = await createTestUser(T.id, { roles: [{ code }], tenantCode: T.code });
    tok[key] = await login(app, u[key] as TestUser);
  }
  // Ambang kecil + jendela "malam" yang mencakup jam sekarang (WIB), agar temuan muncul di tes.
  const now = jakartaParts(new Date());
  const h = Number(now.hour);
  const hhmm = (x: number) => `${String((x + 24) % 24).padStart(2, '0')}:00`;
  await as('admin').put('/api/v1/settings/audit.burst_threshold', { value: 2 }).expect(200);
  await as('admin').put('/api/v1/settings/audit.volume_threshold', { value: 2 }).expect(200);
  await as('admin')
    .put('/api/v1/settings/audit.night_hours', { value: { start: hhmm(h), end: hhmm(h + 1) } })
    .expect(200);
});

afterAll(async () => {
  await app?.close();
});

describe('jejak audit: filter dan detail', () => {
  it('filter kelompok aksi dan peran; nama pelaku ikut', async () => {
    await as('perawat').get('/api/v1/iam/users').expect(403);
    const akun = await as('privasi').get('/api/v1/audit/events?group=akun&limit=200').expect(200);
    const actions = new Set(akun.body.items.map((e: { action: string }) => e.action));
    expect(
      [...actions].every((a) =>
        [
          'login',
          'login_failed',
          'logout',
          'mfa_enrolled',
          'password_change',
          'session_revoked',
          'access_denied',
        ].includes(a as string),
      ),
    ).toBe(true);
    const denied = akun.body.items.find((e: { action: string }) => e.action === 'access_denied');
    expect(denied).toMatchObject({ actorRole: 'perawat', actor: { id: u.perawat?.id } });

    const byRole = await as('privasi').get('/api/v1/audit/events?actorRole=perawat&limit=200').expect(200);
    expect(byRole.body.items.length).toBeGreaterThan(0);
    expect(byRole.body.items.every((e: { actorRole: string }) => e.actorRole === 'perawat')).toBe(true);

    const future = new Date(Date.now() + 3_600_000).toISOString();
    const none = await as('privasi')
      .get(`/api/v1/audit/events?from=${encodeURIComponent(future)}`)
      .expect(200);
    expect(none.body.items).toEqual([]);
    await as('privasi').get('/api/v1/audit/events?group=bukan').expect(400);
  });

  it('detail per seq menyertakan hash berantai', async () => {
    const list = await as('privasi').get('/api/v1/audit/events?limit=2').expect(200);
    const seq = list.body.items[1].seq;
    const d = await as('privasi').get(`/api/v1/audit/events/${seq}`).expect(200);
    expect(d.body).toMatchObject({ seq, hash: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(d.body.prevHash).toMatch(/^[0-9a-f]{64}$/);
    await as('privasi').get('/api/v1/audit/events/999999999').expect(404);
    await as('privasi').get('/api/v1/audit/events/abc').expect(400);
  });
});

describe('temuan anomali', () => {
  it('lonjakan gagal masuk/akses ditolak, akses malam, volume, dan akses darurat belum ditinjau', async () => {
    await insertEvents([
      { actor: u.kasir as TestUser, role: 'kasir', action: 'login_failed' },
      { actor: u.kasir as TestUser, role: 'kasir', action: 'login_failed' },
      { actor: u.kasir as TestUser, role: 'kasir', action: 'login_failed' },
      { actor: u.kasir as TestUser, role: 'kasir', action: 'read', patientId: newId() },
      { actor: u.kasir as TestUser, role: 'kasir', action: 'read', patientId: newId() },
      // Perawat jaga malam: bukan anomali "di luar jam dinas".
      { actor: u.perawat as TestUser, role: 'perawat', action: 'read', patientId: newId() },
      // Tampil di hasil pencarian: dihitung untuk "di luar jam dinas", tidak untuk volume.
      { actor: u.admin as TestUser, role: 'admin_tenant', action: 'search', patientId: newId() },
      { actor: u.admin as TestUser, role: 'admin_tenant', action: 'search', patientId: newId() },
      { actor: u.admin as TestUser, role: 'admin_tenant', action: 'search', patientId: newId() },
    ]);
    await as('perawat').get('/api/v1/iam/users').expect(403);
    const patient = await createTestPatient(T.id);
    const grant = await as('perawat')
      .post('/api/v1/authz/break-glass', {
        patientId: patient.id,
        reason: 'Pasien henti napas di koridor, perlu riwayat alergi',
      })
      .expect(201);

    const res = await as('privasi').get('/api/v1/audit/anomalies?days=1').expect(200);
    const byKey = new Map(res.body.findings.map((f: { key: string }) => [f.key, f]));
    const day = todayWib();
    expect(byKey.get(`login_failed:${u.kasir?.id}:${day}`)).toMatchObject({ count: 3, kind: 'login_failed' });
    expect(byKey.get(`access_denied:${u.perawat?.id}:${day}`)).toMatchObject({ kind: 'access_denied' });
    expect(byKey.get(`night:${u.kasir?.id}:${day}`)).toMatchObject({ count: 2, kind: 'night' });
    expect(byKey.has(`night:${u.perawat?.id}:${day}`)).toBe(false);
    expect(byKey.get(`volume:${u.kasir?.id}:${day}`)).toMatchObject({ count: 2, severity: 'tinggi' });
    expect(byKey.get(`night:${u.admin?.id}:${day}`)).toMatchObject({ count: 3, kind: 'night' });
    expect(byKey.has(`volume:${u.admin?.id}:${day}`)).toBe(false);
    expect(byKey.get(`break_glass:${grant.body.id}`)).toMatchObject({
      grantId: grant.body.id,
      actor: { id: u.perawat?.id },
    });

    // Akses darurat yang sudah ditinjau keluar dari daftar temuan; tinjauan kedua ditolak.
    await as('privasi')
      .post(`/api/v1/authz/break-glass/${grant.body.id}/review`, { outcome: 'sah' })
      .expect(200);
    await as('privasi')
      .post(`/api/v1/authz/break-glass/${grant.body.id}/review`, { outcome: 'perlu_klarifikasi' })
      .expect(409);
    const after = await as('privasi').get('/api/v1/audit/anomalies?days=1').expect(200);
    expect(after.body.findings.map((f: { key: string }) => f.key)).not.toContain(
      `break_glass:${grant.body.id}`,
    );
  });

  it('tinjauan temuan tercatat sebagai entri audit; tidak bisa meninjau diri sendiri; butuh izin', async () => {
    const key = `login_failed:${u.kasir?.id}:${todayWib()}`;
    await as('kasir').post('/api/v1/audit/anomalies/review', { key, outcome: 'sah' }).expect(403);
    await as('privasi')
      .post('/api/v1/audit/anomalies/review', {
        key,
        outcome: 'perlu_klarifikasi',
        note: 'Konfirmasi ke kasir',
      })
      .expect(200);
    const res = await as('privasi').get('/api/v1/audit/anomalies?days=1').expect(200);
    const f = res.body.findings.find((x: { key: string }) => x.key === key);
    expect(f.review).toMatchObject({
      outcome: 'perlu_klarifikasi',
      note: 'Konfirmasi ke kasir',
      reviewerId: u.privasi?.id,
      reviewer: { id: u.privasi?.id, displayName: 'Pengguna Uji Fiktif' },
    });
    // Temuan yang sudah ditinjau diurutkan setelah yang belum.
    const firstReviewed = res.body.findings.findIndex((x: { review: unknown }) => x.review !== null);
    expect(res.body.findings.slice(firstReviewed).every((x: { review: unknown }) => x.review !== null)).toBe(
      true,
    );

    await insertEvents([
      { actor: u.privasi as TestUser, role: 'petugas_privasi', action: 'login_failed' },
      { actor: u.privasi as TestUser, role: 'petugas_privasi', action: 'login_failed' },
    ]);
    await as('privasi')
      .post('/api/v1/audit/anomalies/review', {
        key: `login_failed:${u.privasi?.id}:${todayWib()}`,
        outcome: 'sah',
      })
      .expect(409);
    await as('privasi')
      .post('/api/v1/audit/anomalies/review', { key: 'bukan:kunci', outcome: 'sah' })
      .expect(400);
  });
});

describe('riwayat tinjauan temuan', () => {
  let key: string;
  const extra: Record<string, TestUser> = {};
  const extraTok: Record<string, Tokens> = {};
  const asExtra = (who: string) => (url: string) =>
    http()
      .get(url)
      .set(bearer(extraTok[who] as Tokens));
  const historyUrl = (k: string) => `/api/v1/audit/anomalies/reviews?key=${encodeURIComponent(k)}`;

  beforeAll(async () => {
    for (const [name, code] of [
      ['privasi2', 'petugas_privasi'],
      ['auditor', 'auditor_mutu'],
      ['subjek', 'akuntan'],
    ] as const) {
      extra[name] = await createTestUser(T.id, { roles: [{ code }], tenantCode: T.code });
      extraTok[name] = await login(app, extra[name] as TestUser);
    }
    // Temuan "gagal masuk berulang" milik akun subjek (ambang uji = 2).
    await insertEvents([
      { actor: extra.subjek as TestUser, role: 'akuntan', action: 'login_failed' },
      { actor: extra.subjek as TestUser, role: 'akuntan', action: 'login_failed' },
    ]);
    key = `login_failed:${extra.subjek?.id}:${todayWib()}`;
  });

  it('terbaru dulu, keputusan terbaru berlaku (sama dengan temuan), tanpa PHI; pembukaan diaudit', async () => {
    const empty = await asExtra('auditor')(historyUrl(key)).expect(200);
    expect(empty.body).toEqual({ key, items: [] });

    await as('privasi')
      .post('/api/v1/audit/anomalies/review', { key, outcome: 'perlu_klarifikasi', note: 'Tanya akuntan' })
      .expect(200);
    await http()
      .post('/api/v1/audit/anomalies/review')
      .set(bearer(extraTok.privasi2 as Tokens))
      .send({ key, outcome: 'sah', note: 'Sudah dikonfirmasi: lupa sandi' })
      .expect(200);

    const res = await asExtra('auditor')(historyUrl(key)).expect(200);
    expect(res.body.key).toBe(key);
    const items = res.body.items as Array<Record<string, unknown>>;
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      outcome: 'sah',
      note: 'Sudah dikonfirmasi: lupa sandi',
      reviewer: { id: extra.privasi2?.id, displayName: 'Pengguna Uji Fiktif' },
      reviewerRole: 'petugas_privasi',
      effective: true,
    });
    expect(items[1]).toMatchObject({
      outcome: 'perlu_klarifikasi',
      note: 'Tanya akuntan',
      reviewer: { id: u.privasi?.id },
      effective: false,
    });
    expect(BigInt(items[0]?.seq as string)).toBeGreaterThan(BigInt(items[1]?.seq as string));
    expect((items[0]?.reviewedAt as string) >= (items[1]?.reviewedAt as string)).toBe(true);
    // Hanya peninjau, waktu, keputusan, dan catatan; tidak ada id pasien, IP, atau rincian lain.
    expect(Object.keys(items[0] as object).sort()).toEqual(
      ['effective', 'note', 'outcome', 'reviewedAt', 'reviewer', 'reviewerRole', 'seq'].sort(),
    );

    const anomalies = await asExtra('auditor')('/api/v1/audit/anomalies?days=1').expect(200);
    const finding = anomalies.body.findings.find((f: { key: string }) => f.key === key);
    expect(finding.review).toMatchObject({ outcome: 'sah', reviewer: { id: extra.privasi2?.id } });

    const reads = await withTenant(testDb(), T.id, (tx) =>
      tx.auditEvent.findMany({
        where: {
          action: 'read',
          resourceType: 'audit_anomaly',
          resourceId: key,
          actorUserId: extra.auditor?.id,
        },
        orderBy: { seq: 'asc' },
      }),
    );
    expect(reads.map((r) => r.details)).toEqual([{ count: 0 }, { count: 2 }]);
    expect(reads.every((r) => r.patientId === null && r.actorRole === 'auditor_mutu')).toBe(true);
    // Membaca riwayat tidak menambah entri tinjauan.
    const again = await asExtra('auditor')(historyUrl(key)).expect(200);
    expect(again.body.items).toHaveLength(2);
  });

  it('butuh izin baca audit; kunci divalidasi', async () => {
    await as('perawat').get(historyUrl(key)).expect(403);
    await as('kasir').get(historyUrl(key)).expect(403);
    await as('admin').get(historyUrl(key)).expect(200);
    await as('privasi').get('/api/v1/audit/anomalies/reviews').expect(400);
    await as('privasi').get(historyUrl('bukan:kunci')).expect(400);
    // Akses darurat punya tinjauan sendiri (final) di /authz/break-glass/:id.
    await as('privasi')
      .get(historyUrl(`break_glass:${newId()}`))
      .expect(400);
    await as('privasi')
      .get(`${historyUrl(key)}&extra=1`)
      .expect(400);
  });

  it('isolasi tenant: RS lain tidak melihat riwayat RS ini, dan tinjauannya tidak ikut', async () => {
    const other = await createTestTenant();
    const privasiLain = await createTestUser(other.id, {
      roles: [{ code: 'petugas_privasi' }],
      tenantCode: other.code,
    });
    const tokLain = await login(app, privasiLain);
    const seen = await http().get(historyUrl(key)).set(bearer(tokLain)).expect(200);
    expect(seen.body.items).toEqual([]);

    // Tinjauan dari RS lain hanya masuk jejak RS itu; riwayat RS ini tidak berubah.
    await http()
      .post('/api/v1/audit/anomalies/review')
      .set(bearer(tokLain))
      .send({ key, outcome: 'perlu_klarifikasi', note: 'Tinjauan RS lain' })
      .expect(200);
    const mine = await asExtra('auditor')(historyUrl(key)).expect(200);
    expect(mine.body.items).toHaveLength(2);
    expect(mine.body.items[0]).toMatchObject({ outcome: 'sah', effective: true });
    const theirs = await http().get(historyUrl(key)).set(bearer(tokLain)).expect(200);
    expect(theirs.body.items).toHaveLength(1);
    expect(theirs.body.items[0]).toMatchObject({ reviewer: { id: privasiLain.id }, effective: true });
  });
});

describe('paket bukti dan laporan akses darurat', () => {
  it('ekspor CSV: aman dari injeksi rumus, terurut seq, tercatat di audit; butuh izin ekspor', async () => {
    await insertEvents([
      { actor: u.kasir as TestUser, role: 'kasir', action: 'read', reason: '=HYPERLINK("x")' },
    ]);
    const from = new Date(Date.now() - 3_600_000).toISOString();
    const to = new Date(Date.now() + 60_000).toISOString();
    const qs = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    const res = await as('privasi').get(`/api/v1/audit/export?${qs}`).expect(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('attachment');
    const text = res.text;
    expect(text.charCodeAt(0)).toBe(0xfeff);
    const [header, ...rows] = text.slice(1).trim().split('\r\n');
    expect(header?.startsWith('"seq","waktu_server"')).toBe(true);
    expect(text).toContain(`"'=HYPERLINK(""x"")"`);
    const seqs = rows.map((r) => Number(r.split(',')[0]?.replaceAll('"', '')));
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));

    const audits = await withTenant(testDb(), T.id, (tx) =>
      tx.auditEvent.findMany({
        where: { action: 'export', resourceType: 'audit_event', actorUserId: u.privasi?.id },
      }),
    );
    expect(audits.at(-1)?.details).toMatchObject({ count: rows.length });

    await as('admin').get(`/api/v1/audit/export?${qs}`).expect(403);
    const old = new Date(Date.now() - 200 * 86_400_000).toISOString();
    await as('privasi')
      .get(`/api/v1/audit/export?from=${encodeURIComponent(old)}&to=${encodeURIComponent(to)}`)
      .expect(400);
  });

  it('laporan harian akses darurat: per tanggal WIB, dengan nama pemohon; detail diaudit', async () => {
    const { id: patientId } = await createTestPatient(T.id);
    const g = await as('perawat')
      .post('/api/v1/authz/break-glass', {
        patientId,
        reason: 'Pasien rujukan tidak sadar, perlu daftar obat rutin',
      })
      .expect(201);
    const today = await as('privasi')
      .get(`/api/v1/authz/break-glass?pending=false&date=${todayWib()}`)
      .expect(200);
    expect(today.body.find((x: { id: string }) => x.id === g.body.id)).toMatchObject({
      user: { id: u.perawat?.id, displayName: 'Pengguna Uji Fiktif' },
      reviewer: null,
    });
    const yesterday = await as('privasi')
      .get(`/api/v1/authz/break-glass?pending=false&date=${todayWib(-1)}`)
      .expect(200);
    expect(yesterday.body.map((x: { id: string }) => x.id)).not.toContain(g.body.id);

    const d = await as('privasi').get(`/api/v1/authz/break-glass/${g.body.id}`).expect(200);
    expect(d.body).toMatchObject({ id: g.body.id, reason: expect.stringContaining('rujukan') });
    const [audit] = await withTenant(testDb(), T.id, (tx) =>
      tx.auditEvent.findMany({
        where: { action: 'read', resourceType: 'break_glass', resourceId: g.body.id },
      }),
    );
    expect(audit?.patientId).toBe(d.body.patientId);
    await as('kasir').get(`/api/v1/authz/break-glass/${g.body.id}`).expect(403);
  });
});
