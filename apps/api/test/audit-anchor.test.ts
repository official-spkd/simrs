/**
 * P04 · `/audit/verify` berbasis titik periksa + deteksi pemotongan ekor, dan temuan anomali dari ringkasan harian
 * (ADR-0072). Penyerang = superuser Postgres di database tes. Jangkar dibuat dengan fungsi yang sama dengan job
 * worker (`prepareAuditAnchor` + `recordAuditAnchor`), tanpa bucket WORM (diuji di apps/worker).
 */
import { randomBytes } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  pendingAuditSummaryDays,
  prepareAuditAnchor,
  readAuditAnomalySettings,
  recordAuditAnchor,
  summarizeAuditDay,
  withTenant,
} from '@simrs/db';
import { asTestSuperuser } from '@simrs/db/testing';
import { isoDateJakarta, newId } from '@simrs/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadApiEnv } from '../src/config/env';
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
const http = () => request(app.getHttpServer());
const KEY = () => process.env.AUDIT_ANCHOR_KEY ?? '';

interface Tenant {
  id: string;
  privasi: TestUser;
  tok: Tokens;
}

async function tenantWithAuditor(): Promise<Tenant> {
  const t = await createTestTenant();
  const privasi = await createTestUser(t.id, { roles: [{ code: 'petugas_privasi' }], tenantCode: t.code });
  return { id: t.id, privasi, tok: await login(app, privasi) };
}

const get = (t: Tenant, url: string) => http().get(url).set(bearer(t.tok));

async function anchorNow(tenantId: string): Promise<string | null> {
  const p = await withTenant(testDb(), tenantId, (tx) =>
    prepareAuditAnchor(tx, { tenantId, anchorKeyB64: KEY() }),
  );
  const doc = p.document;
  if (!doc) return null;
  await withTenant(testDb(), tenantId, (tx) => recordAuditAnchor(tx, doc, { objectKey: null }));
  return doc.seq;
}

beforeAll(async () => {
  app = await createTestApp();
});

afterAll(async () => {
  await app?.close();
});

describe('/audit/verify dengan titik periksa', () => {
  it('utuh: mulai dari jangkar sah terakhir; mode penuh menghitung ulang semua; pemeriksaan diaudit', async () => {
    const T = await tenantWithAuditor();
    const anchored = await anchorNow(T.id);
    expect(anchored).not.toBeNull();

    const cp = await get(T, '/api/v1/audit/verify').expect(200);
    expect(cp.body).toMatchObject({
      intact: true,
      mode: 'checkpoint',
      firstBrokenSeq: null,
      issues: [],
      issueCount: 0,
      checkpoint: { seq: anchored },
      anchors: { total: 1, verified: 1, keyConfigured: true, latestSeq: anchored },
    });
    const full = await get(T, '/api/v1/audit/verify?mode=full').expect(200);
    expect(full.body).toMatchObject({ intact: true, mode: 'full', checkpoint: null });
    expect(full.body.checked).toBeGreaterThan(cp.body.checked);
    expect(full.body.checked).toBe(Number(full.body.headSeq));

    await get(T, '/api/v1/audit/verify?mode=semua').expect(400);
    const logged = await withTenant(testDb(), T.id, (tx) =>
      tx.auditEvent.findFirst({
        where: { action: 'verify', resourceType: 'audit_chain' },
        orderBy: { seq: 'desc' },
        select: { details: true, actorUserId: true },
      }),
    );
    expect(logged).toMatchObject({
      actorUserId: T.privasi.id,
      details: { mode: 'full', intact: true, issues: [] },
    });
  });

  it('baris audit TERAKHIR dihapus superuser → TRUNCATION_DETECTED; jangkar dirusak → ANCHOR_TAMPERED', async () => {
    const T = await tenantWithAuditor();
    const anchored = await anchorNow(T.id);
    await asTestSuperuser(
      (tx) =>
        tx.$executeRaw`DELETE FROM audit_events WHERE tenant_id = ${T.id}::uuid AND seq = ${BigInt(anchored ?? '0')}`,
    );
    const res = await get(T, '/api/v1/audit/verify').expect(200);
    expect(res.body.intact).toBe(false);
    expect(res.body.issues).toContainEqual(
      expect.objectContaining({ code: 'TRUNCATION_DETECTED', seq: anchored }),
    );
    const logged = await withTenant(testDb(), T.id, (tx) =>
      tx.auditEvent.findFirst({
        where: { action: 'verify', resourceType: 'audit_chain' },
        orderBy: { seq: 'desc' },
        select: { details: true },
      }),
    );
    expect(logged?.details).toMatchObject({ intact: false, issues: ['TRUNCATION_DETECTED'] });
    // Entri verifikasi tadi menempati seq yang dipotong (hash lain) → tetap tidak utuh.
    const again = await get(T, '/api/v1/audit/verify?mode=full').expect(200);
    expect(again.body.intact).toBe(false);
    expect(again.body.issues.map((i: { code: string }) => i.code)).toContain('ANCHOR_MISMATCH');

    const U = await tenantWithAuditor();
    await anchorNow(U.id);
    await asTestSuperuser(
      (tx) =>
        tx.$executeRaw`UPDATE audit_anchors SET anchored_at = anchored_at - interval '1 day' WHERE tenant_id = ${U.id}::uuid`,
    );
    const tampered = await get(U, '/api/v1/audit/verify').expect(200);
    expect(tampered.body).toMatchObject({ intact: false, checkpoint: null });
    expect(tampered.body.issues.map((i: { code: string }) => i.code)).toEqual(['ANCHOR_TAMPERED']);
  });

  it('isolasi tenant: jangkar dan kerusakan RS lain tidak memengaruhi pemeriksaan RS ini', async () => {
    const A = await tenantWithAuditor();
    const B = await tenantWithAuditor();
    await anchorNow(A.id);
    await asTestSuperuser(
      (tx) => tx.$executeRaw`UPDATE audit_anchors SET hmac = repeat('0', 64) WHERE tenant_id = ${A.id}::uuid`,
    );
    expect((await get(A, '/api/v1/audit/verify').expect(200)).body.intact).toBe(false);
    const b = await get(B, '/api/v1/audit/verify').expect(200);
    expect(b.body).toMatchObject({ intact: true, anchors: { total: 0 } });
  });

  it('kunci jangkar: wajib di produksi dan harus berbeda dari kunci kolom', () => {
    const base = { ...process.env, APP_ENV: 'production', TRUST_PROXY: 'loopback', STORAGE_DRIVER: 's3' };
    expect(() => loadApiEnv({ ...base, AUDIT_ANCHOR_KEY: '' })).toThrow(/AUDIT_ANCHOR_KEY wajib/);
    expect(() => loadApiEnv({ ...base, AUDIT_ANCHOR_KEY: process.env.FIELD_HASH_KEY ?? '' })).toThrow(
      /harus berbeda/,
    );
    expect(
      loadApiEnv({ ...base, AUDIT_ANCHOR_KEY: randomBytes(32).toString('base64') }).AUDIT_ANCHOR_KEY,
    ).toBeDefined();
    expect(
      loadApiEnv({ ...process.env, APP_ENV: 'local', AUDIT_ANCHOR_KEY: '' }).AUDIT_ANCHOR_KEY,
    ).toBeUndefined();
  });
});

describe('temuan anomali dari ringkasan harian', () => {
  const DAY = 86_400_000;
  const dayAgo = (n: number) => isoDateJakarta(new Date(Date.now() - n * DAY));

  /** Entri bertanggal lampau: disisipkan role aplikasi, lalu waktunya digeser superuser (tenant uji sendiri). */
  async function pastEvents(
    tenantId: string,
    rows: Array<{ at: string; user: string; role: string; action: string; patientId?: string }>,
  ) {
    const ids = rows.map(() => newId());
    await withTenant(testDb(), tenantId, async (tx) => {
      for (const [i, r] of rows.entries()) {
        await tx.auditEvent.create({
          data: {
            id: ids[i] as string,
            tenantId,
            actorUserId: r.user,
            actorRole: r.role,
            patientId: r.patientId ?? null,
            resourceType: r.patientId ? 'patient' : 'session',
            action: r.action,
            outcome: r.action === 'login_failed' || r.action === 'access_denied' ? 'denied' : 'success',
          },
        });
      }
    });
    await asTestSuperuser(async (tx) => {
      for (const [i, r] of rows.entries()) {
        await tx.$executeRaw`UPDATE audit_events SET occurred_at = ${new Date(r.at)} WHERE id = ${ids[i]}::uuid`;
      }
    });
  }

  it('hasil layar sama persis sebelum dan sesudah ringkasan; tinjauan tetap melekat; RS lain tidak terpengaruh', async () => {
    const T = await tenantWithAuditor();
    await withTenant(testDb(), T.id, async (tx) => {
      await tx.tenantSetting.create({ data: { tenantId: T.id, key: 'audit.burst_threshold', value: 2 } });
      await tx.tenantSetting.create({ data: { tenantId: T.id, key: 'audit.volume_threshold', value: 2 } });
    });
    const kasir = await createTestUser(T.id, { roles: [{ code: 'kasir' }] });
    const rows = [];
    for (const n of [1, 2, 5, 9]) {
      const d = dayAgo(n);
      rows.push(
        { at: `${d}T08:0${n % 10}:00+07:00`, user: kasir.id, role: 'kasir', action: 'login_failed' },
        { at: `${d}T08:1${n % 10}:00+07:00`, user: kasir.id, role: 'kasir', action: 'login_failed' },
        {
          at: `${d}T23:0${n % 10}:00+07:00`,
          user: kasir.id,
          role: 'kasir',
          action: 'read',
          patientId: newId(),
        },
        {
          at: `${d}T23:1${n % 10}:00+07:00`,
          user: kasir.id,
          role: 'kasir',
          action: 'read',
          patientId: newId(),
        },
        { at: `${d}T14:0${n % 10}:00+07:00`, user: kasir.id, role: 'kasir', action: 'access_denied' },
      );
    }
    await pastEvents(T.id, rows);
    const key = `login_failed:${kasir.id}:${dayAgo(2)}`;
    await http()
      .post('/api/v1/audit/anomalies/review')
      .set(bearer(T.tok))
      .send({ key, outcome: 'sah', note: 'Lupa sandi setelah cuti' })
      .expect(200);

    const before = await get(T, '/api/v1/audit/anomalies?days=30').expect(200);
    expect(before.body.summarizedDays).toBe(0);
    expect(before.body.findings.length).toBe(12); // 4 hari × (gagal masuk, malam, volume)

    const settings = await withTenant(testDb(), T.id, (tx) => readAuditAnomalySettings(tx));
    const days = await withTenant(testDb(), T.id, (tx) =>
      pendingAuditSummaryDays(tx, settings, { now: new Date(), lookbackDays: 30, settleMs: 0 }),
    );
    for (const d of days) await withTenant(testDb(), T.id, (tx) => summarizeAuditDay(tx, T.id, d, settings));

    const after = await get(T, '/api/v1/audit/anomalies?days=30').expect(200);
    expect(after.body.summarizedDays).toBe(29);
    expect(after.body.findings).toEqual(before.body.findings);
    expect(after.body.since).toBe(before.body.since);
    expect(after.body.findings.find((f: { key: string }) => f.key === key)?.review).toMatchObject({
      outcome: 'sah',
      note: 'Lupa sandi setelah cuti',
    });
    for (const n of [1, 7, 90]) {
      const live = await get(T, `/api/v1/audit/anomalies?days=${n}`).expect(200);
      expect(live.body.findings.length).toBe(n === 1 ? 0 : n === 7 ? 9 : 12);
    }

    const other = await tenantWithAuditor();
    const res = await get(other, '/api/v1/audit/anomalies?days=30').expect(200);
    expect(res.body).toMatchObject({ summarizedDays: 0, findings: [] });
  });
});
