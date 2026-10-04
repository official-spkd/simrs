/**
 * Tes integrasi RLS (Definisi selesai fase 0). Butuh Postgres dari docker compose.
 * Migrasi dijalankan ke simrs_test sebagai migrator di globalSetup; tes berjalan sebagai simrs_app (tanpa BYPASSRLS).
 */
import { newId } from '@simrs/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  claimDueOutbox,
  createPrismaClient,
  deferOutboxMessage,
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

describe('outbox · batas waktu dan penundaan', () => {
  async function claimed(key: string, now: Date) {
    const msg = await withTenant(app, A.id, (tx) =>
      enqueueOutbox(tx, A.id, { target: 'bpjs', operation: 'ping', idempotencyKey: key, payload: {} }),
    );
    const rows = await withTenant(app, A.id, (tx) => claimDueOutbox(tx, 50, now));
    const row = rows.find((m) => m.id === msg.id);
    expect(row).toBeDefined();
    return row!;
  }

  it('deadline: jadwal ulang yang jatuh pada/sesudah batas → DLQ; sebelum batas → tetap dicoba ulang', async () => {
    const now = new Date(Date.now() + 1000);
    const fail = { ok: false, statusCode: 503, error: 'HTTP 503', durationMs: 1 };
    const early = await claimed(`dl-${newId()}`, now);
    const kept = await withTenant(app, A.id, (tx) =>
      recordOutboxAttempt(tx, early, fail, {
        now,
        maxAttempts: Infinity,
        deadline: new Date(now.getTime() + 1001),
        random: () => 1,
      }),
    );
    expect(kept).toMatchObject({ status: 'failed', attempts: 1, lastError: 'HTTP 503' });
    expect(kept.nextAttemptAt.getTime() - now.getTime()).toBe(1000);

    const late = await claimed(`dl-${newId()}`, now);
    const dead = await withTenant(app, A.id, (tx) =>
      recordOutboxAttempt(tx, late, fail, {
        now,
        maxAttempts: Infinity,
        deadline: new Date(now.getTime() + 1000),
        random: () => 1,
      }),
    );
    expect(dead).toMatchObject({ status: 'dead', lastError: 'HTTP 503 · batas waktu coba ulang terlewati' });
  });

  it('capMs membatasi jeda; maxAttempts Infinity tidak pernah DLQ karena hitungan', async () => {
    const now = new Date(Date.now() + 1000);
    const row = await claimed(`cap-${newId()}`, now);
    const updated = await withTenant(app, A.id, (tx) =>
      recordOutboxAttempt(
        tx,
        { ...row, attempts: 40 },
        { ok: false, statusCode: 503, durationMs: 1 },
        { now, maxAttempts: Infinity, capMs: 7_000, random: () => 1 },
      ),
    );
    expect(updated.status).toBe('failed');
    expect(updated.nextAttemptAt.getTime() - now.getTime()).toBe(7_000);
  });

  it('urutan klaim pasti untuk pesan di milidetik yang sama: created_at lalu id', async () => {
    const at = new Date(Date.now() - 60_000);
    const ids = await withTenant(app, A.id, async (tx) => {
      const made = [];
      for (let i = 0; i < 3; i++) {
        made.push(
          await enqueueOutbox(tx, A.id, {
            target: 'bpjs',
            operation: 'ping',
            idempotencyKey: `order-${newId()}`,
            payload: {},
          }),
        );
      }
      await tx.outboxMessage.updateMany({
        where: { id: { in: made.map((m) => m.id) } },
        data: { createdAt: at, nextAttemptAt: at },
      });
      return made.map((m) => m.id);
    });
    const claimed = await withTenant(app, A.id, (tx) => claimDueOutbox(tx, 500, new Date()));
    const order = claimed.map((m) => m.id).filter((id) => ids.includes(id));
    expect(order).toEqual([...ids].sort());
  });

  it('penundaan tidak menambah percobaan dan tidak mencatat delivery_attempts', async () => {
    const now = new Date(Date.now() + 1000);
    const row = await claimed(`defer-${newId()}`, now);
    const until = new Date(now.getTime() + 30_000);
    const deferred = await withTenant(app, A.id, (tx) =>
      deferOutboxMessage(tx, row, { until, reason: 'menunggu task 1' }),
    );
    expect(deferred).toMatchObject({ status: 'pending', attempts: 0, lastError: 'ditunda: menunggu task 1' });
    expect(deferred.nextAttemptAt.toISOString()).toBe(until.toISOString());
    const count = await withTenant(app, A.id, (tx) =>
      tx.deliveryAttempt.count({ where: { outboxMessageId: row.id } }),
    );
    expect(count).toBe(0);
    const before = await withTenant(app, A.id, (tx) => claimDueOutbox(tx, 50, new Date(until.getTime() - 1)));
    expect(before.map((m) => m.id)).not.toContain(row.id);
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
