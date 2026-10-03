/**
 * Tes integrasi RLS (Definisi selesai fase 0). Butuh Postgres dari docker compose.
 * Migrasi dijalankan ke simrs_test sebagai migrator di globalSetup; tes berjalan sebagai simrs_app (tanpa BYPASSRLS).
 */
import { newId } from '@simrs/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  claimDueOutbox,
  createPrismaClient,
  enqueueOutbox,
  isTenantRequiredError,
  listActiveTenantIds,
  recordOutboxAttempt,
  withTenant,
  type PrismaClient,
} from '../src/index';
import { SEED_TENANTS } from '../src/seed-data';
import { testDbUrls } from '../src/testing';

const [A, B] = SEED_TENANTS;
let app: PrismaClient;

beforeAll(() => {
  app = createPrismaClient({ connectionString: testDbUrls().app, max: 4 });
});

afterAll(async () => {
  await app.$disconnect();
});

describe('RLS isolasi tenant', () => {
  it('query tanpa app.tenant_id gagal dengan TENANT_REQUIRED', async () => {
    const err = await app.outboxMessage.findMany().catch((e: unknown) => e);
    expect(isTenantRequiredError(err)).toBe(true);
    const err2 = await app.tenant.findMany().catch((e: unknown) => e);
    expect(isTenantRequiredError(err2)).toBe(true);
  });

  it('tenant A tidak melihat baris tenant B, meski ID-nya ditebak', async () => {
    const key = `rls-${newId()}`;
    const msgB = await withTenant(app, B.id, (tx) =>
      enqueueOutbox(tx, B.id, { target: 'satusehat', operation: 'ping', idempotencyKey: key, payload: {} }),
    );
    const seenByA = await withTenant(app, A.id, (tx) =>
      tx.outboxMessage.findUnique({ where: { id: msgB.id } }),
    );
    expect(seenByA).toBeNull();
    const seenByB = await withTenant(app, B.id, (tx) =>
      tx.outboxMessage.findUnique({ where: { id: msgB.id } }),
    );
    expect(seenByB?.id).toBe(msgB.id);
    const tenantsSeenByA = await withTenant(app, A.id, (tx) => tx.tenant.findMany());
    expect(tenantsSeenByA.map((t) => t.id)).toEqual([A.id]);
  });

  it('tenant A tidak bisa menulis baris atas nama tenant B (WITH CHECK)', async () => {
    const err = await withTenant(app, A.id, (tx) =>
      enqueueOutbox(tx, B.id, {
        target: 'bpjs',
        operation: 'ping',
        idempotencyKey: `x-${newId()}`,
        payload: {},
      }),
    ).catch((e: unknown) => e);
    expect(String(err)).toMatch(/row-level security/i);
  });

  it('tenant A tidak bisa mengubah baris tenant B', async () => {
    const msgB = await withTenant(app, B.id, (tx) =>
      enqueueOutbox(tx, B.id, {
        target: 'tte',
        operation: 'ping',
        idempotencyKey: `u-${newId()}`,
        payload: {},
      }),
    );
    const res = await withTenant(app, A.id, (tx) =>
      tx.outboxMessage.updateMany({ where: { id: msgB.id }, data: { status: 'sent' } }),
    );
    expect(res.count).toBe(0);
  });

  it('daftar tenant aktif untuk worker hanya berisi ID', async () => {
    const ids = await listActiveTenantIds(app);
    expect(ids).toEqual(expect.arrayContaining([A.id, B.id]));
  });
});

describe('audit_events append-only', () => {
  it('UPDATE dan DELETE ditolak untuk role aplikasi', async () => {
    const id = newId();
    await withTenant(app, A.id, (tx) =>
      tx.auditEvent.create({ data: { id, tenantId: A.id, resourceType: 'system', action: 'test' } }),
    );
    const upd = await withTenant(app, A.id, (tx) =>
      tx.auditEvent.update({ where: { id }, data: { action: 'diubah' } }),
    ).catch((e: unknown) => e);
    expect(String(upd)).toMatch(/permission denied|APPEND_ONLY/i);
    const del = await withTenant(app, A.id, (tx) => tx.auditEvent.delete({ where: { id } })).catch(
      (e: unknown) => e,
    );
    expect(String(del)).toMatch(/permission denied|APPEND_ONLY/i);
  });
});

describe('outbox', () => {
  it('idempoten per idempotency key, retry eksponensial, lalu DLQ', async () => {
    const key = `dlq-${newId()}`;
    const env = { target: 'bpjs' as const, operation: 'ping', idempotencyKey: key, payload: { n: 1 } };
    const first = await withTenant(app, A.id, (tx) => enqueueOutbox(tx, A.id, env));
    const again = await withTenant(app, A.id, (tx) => enqueueOutbox(tx, A.id, env));
    expect(again.id).toBe(first.id);

    let now = new Date(Date.now() + 1000);
    for (let i = 1; i <= 3; i++) {
      const claimed = await withTenant(app, A.id, (tx) => claimDueOutbox(tx, 50, now));
      const msg = claimed.find((m) => m.id === first.id);
      expect(msg, `percobaan ${i} harus mengambil pesan`).toBeDefined();
      const updated = await withTenant(app, A.id, (tx) =>
        recordOutboxAttempt(
          tx,
          msg!,
          { ok: false, statusCode: 503, durationMs: 5 },
          { now, maxAttempts: 3, random: () => 1 },
        ),
      );
      if (i < 3) {
        expect(updated.status).toBe('failed');
        expect(updated.nextAttemptAt.getTime() - now.getTime()).toBe(1000 * 2 ** (i - 1));
        now = new Date(updated.nextAttemptAt.getTime() + 1);
      } else {
        expect(updated.status).toBe('dead');
        expect(updated.deadAt).not.toBeNull();
      }
    }
    const attempts = await withTenant(app, A.id, (tx) =>
      tx.deliveryAttempt.count({ where: { outboxMessageId: first.id } }),
    );
    expect(attempts).toBe(3);
  });
});

describe('outbox lease', () => {
  it('pesan processing yang lease-nya habis diambil ulang (worker mati di tengah kirim)', async () => {
    const msg = await withTenant(app, A.id, (tx) =>
      enqueueOutbox(tx, A.id, {
        target: 'tte',
        operation: 'ping',
        idempotencyKey: `lease-${newId()}`,
        payload: {},
      }),
    );
    const t0 = new Date(Date.now() + 1000);
    const first = await withTenant(app, A.id, (tx) => claimDueOutbox(tx, 50, t0, 30_000));
    expect(first.map((m) => m.id)).toContain(msg.id);
    const during = await withTenant(app, A.id, (tx) =>
      claimDueOutbox(tx, 50, new Date(t0.getTime() + 10_000), 30_000),
    );
    expect(during.map((m) => m.id)).not.toContain(msg.id);
    const after = await withTenant(app, A.id, (tx) =>
      claimDueOutbox(tx, 50, new Date(t0.getTime() + 31_000), 30_000),
    );
    expect(after.map((m) => m.id)).toContain(msg.id);
  });
});
