/**
 * ADR-0026 · SSE di atas satu koneksi LISTEN per instans. Kanal uji khusus run ini; baris yang "diberitahukan"
 * memakai `audit_events` (tabel ber-RLS yang boleh ditulis simrs_app) dengan `resource_type = 'sse_test'`, dan
 * `pg_notify` dipanggil di transaksi yang sama seperti trigger `app_notify_row()` nanti.
 */
import type { AddressInfo } from 'node:net';
import { Controller, Get, Query, Req, Res } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { type TenantTx, withTenant } from '@simrs/db';
import { newId } from '@simrs/shared';
import type { Request, Response } from 'express';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Audited } from '../src/common/audited.decorator';
import { NoRequestTransaction } from '../src/common/no-request-transaction.decorator';
import { RequirePermission } from '../src/common/require-permission.decorator';
import { TenantScoped } from '../src/common/tenant-scoped.decorator';
import {
  LISTEN_APPLICATION_NAME,
  type NotificationListener,
  parsePayload,
  PgNotificationHub,
} from '../src/infra/realtime/pg-notification-hub';
import {
  principalKeyOf,
  type SseChannel,
  type SseEvent,
  SSE_SUPERSEDED_RETRY_MS,
  SseService,
} from '../src/infra/realtime/sse.service';
import {
  bearer,
  createTestApp,
  createTestUser,
  login,
  TENANT_A,
  TENANT_B,
  type Tokens,
  testDb,
} from './helpers';

const CHANNEL = `sse_test_${newId().replace(/-/g, '').slice(-12)}`;
const OTHER_CHANNEL = `${CHANNEL}_b`;

interface TestData {
  group: string | null;
}

async function loadRow(tx: TenantTx, id: string): Promise<SseEvent<TestData> | null> {
  const row = await tx.auditEvent.findFirst({
    where: { id, resourceType: 'sse_test' },
    select: { id: true, resourceId: true },
  });
  return row ? { id: row.id, event: 'test.created', data: { group: row.resourceId } } : null;
}

const channel: SseChannel<TestData> = {
  name: CHANNEL,
  load: loadRow,
  async replay(tx, afterId, limit) {
    const rows = await tx.auditEvent.findMany({
      where: { resourceType: 'sse_test', id: { gt: afterId } },
      orderBy: { id: 'asc' },
      take: limit,
      select: { id: true, resourceId: true },
    });
    return rows.map((r) => ({ id: r.id, event: 'test.created', data: { group: r.resourceId } }));
  },
};
const channelWithoutReplay: SseChannel<TestData> = { name: CHANNEL, load: loadRow };

@TenantScoped()
@Controller('test-infra/sse')
class SseTestController {
  constructor(private readonly sse: SseService) {}

  @NoRequestTransaction()
  @RequirePermission('patient', 'read')
  @Audited({ action: 'read', resource: 'sse_test_stream' })
  @Get('stream')
  stream(
    @Req() req: Request,
    @Res() res: Response,
    @Query('group') group: string,
    @Query('heartbeatMs') heartbeatMs?: string,
    @Query('maxMs') maxMs?: string,
    @Query('replay') replay?: string,
    @Query('principal') principal?: string,
    @Query('maxPer') maxPer?: string,
  ) {
    this.sse.stream(req, res, replay === 'off' ? channelWithoutReplay : channel, {
      filter: (e) => e.data.group === group,
      heartbeatMs: heartbeatMs ? Number(heartbeatMs) : undefined,
      maxDurationMs: maxMs ? Number(maxMs) : undefined,
      replayLimit: 5,
      principalKey: principal,
      maxPerPrincipal: maxPer ? Number(maxPer) : undefined,
    });
  }

  /** Tanpa @NoRequestTransaction: helper menolak (transaksi permintaan tidak boleh dipegang selama streaming). */
  @Get('in-transaction')
  inTransaction(@Req() req: Request, @Res() res: Response) {
    this.sse.stream(req, res, channel);
  }
}

interface Frame {
  id?: string;
  event?: string;
  data?: unknown;
  comment?: string;
  retry?: number;
}

/** Klien SSE minimal di atas fetch (membaca aliran per potongan, memecah frame `\n\n`). */
class SseClient {
  readonly frames: Frame[] = [];
  ended = false;

  constructor(
    readonly res: globalThis.Response,
    private readonly controller: AbortController,
  ) {
    void this.pump();
  }

  get events(): Array<{ id?: string; event?: string; data?: unknown }> {
    return this.frames.filter((f) => f.event !== undefined);
  }

  ids(): string[] {
    return this.events.filter((e) => e.event === 'test.created').map((e) => e.id ?? '');
  }

  async waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
    const until = Date.now() + timeoutMs;
    while (!predicate()) {
      if (Date.now() > until) throw new Error(`waitFor timeout; frames=${JSON.stringify(this.frames)}`);
      await new Promise((r) => setTimeout(r, 10));
    }
  }

  close(): void {
    this.controller.abort();
  }

  private async pump(): Promise<void> {
    const body = this.res.body;
    if (!body) return;
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let i: number;
        while ((i = buffer.indexOf('\n\n')) >= 0) {
          this.frames.push(parseFrame(buffer.slice(0, i)));
          buffer = buffer.slice(i + 2);
        }
      }
    } catch {
      // dibatalkan klien
    } finally {
      this.ended = true;
    }
  }
}

function parseFrame(raw: string): Frame {
  const frame: Frame = {};
  for (const line of raw.split('\n')) {
    if (line.startsWith(':')) frame.comment = line.slice(1).trim();
    else if (line.startsWith('id: ')) frame.id = line.slice(4);
    else if (line.startsWith('event: ')) frame.event = line.slice(7);
    else if (line.startsWith('data: ')) frame.data = JSON.parse(line.slice(6));
    else if (line.startsWith('retry: ')) frame.retry = Number(line.slice(7));
  }
  return frame;
}

let app: NestExpressApplication;
let port: number;
let hub: PgNotificationHub;
let sse: SseService;
const clients: SseClient[] = [];
let tokens: Record<string, Tokens> = {};

async function connect(
  tenantId: string,
  query: Record<string, string>,
  headers: Record<string, string> = {},
  path = 'stream',
): Promise<SseClient> {
  const controller = new AbortController();
  const qs = new URLSearchParams(query).toString();
  const res = await fetch(`http://127.0.0.1:${port}/api/v1/test-infra/sse/${path}?${qs}`, {
    headers: { 'X-Tenant-Id': tenantId, ...headers },
    signal: controller.signal,
  });
  const client = new SseClient(res, controller);
  clients.push(client);
  return client;
}

/** Baris baru + pg_notify di transaksi yang sama (seperti trigger). `notifyTenant` untuk payload palsu. */
async function emit(tenantId: string, group: string, opts: { notifyTenant?: string; notify?: boolean } = {}) {
  const id = newId();
  await withTenant(testDb(), tenantId, async (tx) => {
    await tx.auditEvent.create({
      data: { id, tenantId, action: 'create', resourceType: 'sse_test', resourceId: group },
    });
    if (opts.notify !== false) {
      const payload = JSON.stringify({ tenant_id: opts.notifyTenant ?? tenantId, id });
      await tx.$executeRaw`SELECT pg_notify(${CHANNEL}, ${payload})`;
    }
  });
  return id;
}

async function notifyRaw(channelName: string, payload: string) {
  await testDb().$executeRaw`SELECT pg_notify(${channelName}, ${payload})`;
}

async function openTransactions(): Promise<number> {
  const [row] = await testDb().$queryRaw<Array<{ n: number }>>`
    SELECT count(*)::int AS n FROM pg_stat_activity
    WHERE datname = current_database() AND usename = 'simrs_app' AND state LIKE 'idle in transaction%'`;
  return row?.n ?? 0;
}

async function listenConnections(): Promise<number> {
  const [row] = await testDb().$queryRaw<Array<{ n: number }>>`
    SELECT count(*)::int AS n FROM pg_stat_activity
    WHERE datname = current_database() AND application_name = ${LISTEN_APPLICATION_NAME}`;
  return row?.n ?? 0;
}

const settle = (ms = 150) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  app = await createTestApp(
    {},
    { imports: [{ module: class SseTestModule {}, controllers: [SseTestController] }] },
  );
  await app.listen(0, '127.0.0.1');
  port = (app.getHttpServer().address() as AddressInfo).port;
  hub = app.get(PgNotificationHub);
  sse = app.get(SseService);
  tokens = {
    akuntan: await login(app, await createTestUser(TENANT_A, { roles: [{ code: 'akuntan' }] })),
  };
});

afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  for (let i = 0; i < 100 && (sse.activeCount() > 0 || hub.subscriberCount() > 0); i++) await settle(10);
});

afterAll(async () => {
  await app?.close();
});

describe('parsePayload', () => {
  it('hanya menerima { tenant_id, id } UUID', () => {
    const t = newId();
    const id = newId();
    expect(parsePayload(JSON.stringify({ tenant_id: t, id }))).toEqual({ tenantId: t, id });
    expect(parsePayload(JSON.stringify({ tenant_id: t.toUpperCase(), id }))).toEqual({ tenantId: t, id });
    expect(parsePayload('bukan json')).toBeNull();
    expect(parsePayload(JSON.stringify({ tenant_id: 'x', id }))).toBeNull();
    expect(parsePayload(JSON.stringify({ id }))).toBeNull();
    expect(parsePayload(JSON.stringify([t, id]))).toBeNull();
    expect(parsePayload(undefined)).toBeNull();
    expect(parsePayload(`{"tenant_id":"${t}","id":"${id}","x":"${'a'.repeat(600)}"}`)).toBeNull();
  });
});

describe('PgNotificationHub', () => {
  it('satu koneksi LISTEN per instans; fan-out hanya ke kanal + tenant yang sama', async () => {
    const got: Record<string, string[]> = { a: [], b: [], other: [] };
    const listener = (key: string): NotificationListener => ({
      notify: (id) => got[key]?.push(id),
      resync: () => undefined,
    });
    const subs = [
      hub.subscribe(CHANNEL, TENANT_A, listener('a')),
      hub.subscribe(CHANNEL, TENANT_B, listener('b')),
      hub.subscribe(OTHER_CHANNEL, TENANT_A, listener('other')),
    ];
    await Promise.all(subs.map((s) => s.ready));
    expect(hub.isConnected()).toBe(true);
    expect(await listenConnections()).toBe(1);

    const idA = newId();
    const idB = newId();
    await notifyRaw(CHANNEL, JSON.stringify({ tenant_id: TENANT_A, id: idA }));
    await notifyRaw(CHANNEL, 'payload rusak');
    await notifyRaw(CHANNEL, JSON.stringify({ tenant_id: TENANT_B, id: idB }));
    for (let i = 0; i < 100 && got.b?.length === 0; i++) await settle(10);
    expect(got).toEqual({ a: [idA], b: [idB], other: [] });

    for (const s of subs) s.unsubscribe();
    expect(hub.subscriberCount(CHANNEL)).toBe(0);
    await notifyRaw(CHANNEL, JSON.stringify({ tenant_id: TENANT_A, id: newId() }));
    await settle();
    expect(got.a).toEqual([idA]);
  });

  it('koneksi LISTEN putus → sambung ulang dengan backoff, LISTEN ulang, resync ke pelanggan', async () => {
    let resyncs = 0;
    const ids: string[] = [];
    const sub = hub.subscribe(CHANNEL, TENANT_A, {
      notify: (id) => ids.push(id),
      resync: () => (resyncs += 1),
    });
    await sub.ready;
    const pid = await hub.listenerBackendPid();
    expect(pid).toEqual(expect.any(Number));
    // simrs_app boleh menghentikan backend milik role-nya sendiri.
    await testDb().$executeRaw`SELECT pg_terminate_backend(${pid}::int)`;
    for (let i = 0; i < 500 && resyncs === 0; i++) await settle(10);
    expect(resyncs).toBe(1);
    expect(hub.isConnected()).toBe(true);
    expect(await hub.listenerBackendPid()).not.toBe(pid);

    const id = newId();
    await notifyRaw(CHANNEL, JSON.stringify({ tenant_id: TENANT_A, id }));
    for (let i = 0; i < 100 && ids.length === 0; i++) await settle(10);
    expect(ids).toEqual([id]);
    sub.unsubscribe();
  });
});

describe('principalKeyOf', () => {
  it('perangkat lebih dulu, lalu pengguna; tanpa keduanya tidak dibatasi', () => {
    const actor = { userId: null, role: null, sessionId: null, unitId: null };
    expect(principalKeyOf({ tenantId: 't', actor })).toBeNull();
    expect(principalKeyOf({ tenantId: 't', actor: { ...actor, userId: 'u' } })).toBe('t:user:u');
    expect(
      principalKeyOf({
        tenantId: 't',
        actor: { ...actor, devicePrincipal: { id: 'd', kind: 'queue_display', permissions: [] } },
      }),
    ).toBe('t:device:d');
  });
});

describe('SseService (HTTP)', () => {
  it('header aliran, retry, heartbeat, dan @Audited tetap tercatat', async () => {
    const requestId = newId();
    const c = await connect(TENANT_A, { group: newId(), heartbeatMs: '50' }, { 'X-Request-Id': requestId });
    expect(c.res.status).toBe(200);
    expect(c.res.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');
    expect(c.res.headers.get('cache-control')).toBe('no-store, no-transform');
    expect(c.res.headers.get('x-accel-buffering')).toBe('no');
    await c.waitFor(() => c.frames.filter((f) => f.comment === 'ping').length >= 2);
    expect(c.frames[0]).toEqual({ retry: 3000 });
    // @Audited ditulis di transaksi pendek tepat setelah aliran dibuka (bukan saat aliran berakhir).
    const readAudit = () =>
      withTenant(testDb(), TENANT_A, (tx) =>
        tx.auditEvent.findMany({ where: { requestId }, select: { action: true, resourceType: true } }),
      );
    let audit = await readAudit();
    for (let i = 0; i < 100 && audit.length === 0; i++) {
      await settle(20);
      audit = await readAudit();
    }
    expect(audit).toEqual([{ action: 'read', resourceType: 'sse_test_stream' }]);
    expect(c.ended).toBe(false);
  });

  it('pelanggan tenant A tidak pernah menerima event tenant B (termasuk payload palsu)', async () => {
    const group = newId();
    const a = await connect(TENANT_A, { group });
    const b = await connect(TENANT_B, { group });
    await a.waitFor(() => hub.subscriberCount(CHANNEL) === 2);

    const idA = await emit(TENANT_A, group);
    await a.waitFor(() => a.ids().length === 1);
    // Payload palsu: tenant B tetapi id baris tenant A → dibaca di konteks B, RLS menyembunyikannya.
    await emit(TENANT_A, group, { notifyTenant: TENANT_B });
    const idB = await emit(TENANT_B, group);
    await b.waitFor(() => b.ids().length === 1);
    await settle();

    expect(a.ids()).toEqual([idA]);
    expect(b.ids()).toEqual([idB]);
    expect(a.events[0]).toEqual({ id: idA, event: 'test.created', data: { group } });
  });

  it('Last-Event-ID memutar ulang event yang terlewat, lalu lanjut live tanpa duplikat', async () => {
    const group = newId();
    const first = await emit(TENANT_A, group, { notify: false });
    const missed = [
      await emit(TENANT_A, group, { notify: false }),
      await emit(TENANT_A, group, { notify: false }),
    ];
    const c = await connect(TENANT_A, { group }, { 'Last-Event-ID': first });
    await c.waitFor(() => c.ids().length === 2);
    expect(c.ids()).toEqual(missed);

    const live = await emit(TENANT_A, group);
    await c.waitFor(() => c.ids().length === 3);
    expect(c.ids()).toEqual([...missed, live]);

    // BFF bisa meneruskan posisi lewat query.
    const viaQuery = await connect(TENANT_A, { group, lastEventId: first });
    await viaQuery.waitFor(() => viaQuery.ids().length === 3);
    expect(viaQuery.ids()).toEqual([...missed, live]);
  });

  it('putar ulang terlalu panjang atau tidak didukung → event reset', async () => {
    const group = newId();
    const first = await emit(TENANT_A, group, { notify: false });
    for (let i = 0; i < 6; i++) await emit(TENANT_A, group, { notify: false });
    const tooLong = await connect(TENANT_A, { group }, { 'Last-Event-ID': first });
    await tooLong.waitFor(() => tooLong.events.some((e) => e.event === 'reset'));
    expect(tooLong.events).toEqual([{ event: 'reset', data: { reason: 'replay_too_long' } }]);

    const noReplay = await connect(TENANT_A, { group, replay: 'off' }, { 'Last-Event-ID': first });
    await noReplay.waitFor(() => noReplay.events.length === 1);
    expect(noReplay.events).toEqual([{ event: 'reset', data: { reason: 'replay_unavailable' } }]);
  });

  it('koneksi LISTEN putus → aliran memutar ulang dari event terakhir yang terkirim', async () => {
    const group = newId();
    const c = await connect(TENANT_A, { group });
    await c.waitFor(() => hub.subscriberCount(CHANNEL, TENANT_A) === 1);
    const e1 = await emit(TENANT_A, group);
    await c.waitFor(() => c.ids().length === 1);

    const pid = await hub.listenerBackendPid();
    await testDb().$executeRaw`SELECT pg_terminate_backend(${pid}::int)`;
    for (let i = 0; i < 100 && hub.isConnected(); i++) await settle(5);
    // Commit saat koneksi LISTEN putus: notifikasinya hilang, harus datang lewat putar ulang.
    const e2 = await emit(TENANT_A, group);
    await c.waitFor(() => c.ids().length === 2);
    const e3 = await emit(TENANT_A, group);
    await c.waitFor(() => c.ids().length === 3);
    expect(c.ids()).toEqual([e1, e2, e3]);
  });

  it('klien putus → langganan dan aliran dilepas', async () => {
    const c = await connect(TENANT_A, { group: newId() });
    await c.waitFor(() => hub.subscriberCount(CHANNEL, TENANT_A) === 1);
    expect(sse.activeCount(CHANNEL)).toBe(1);
    c.close();
    await c.waitFor(() => hub.subscriberCount(CHANNEL) === 0 && sse.activeCount() === 0);
  });

  it('batas umur koneksi → server menutup aliran dan melepas langganan', async () => {
    const c = await connect(TENANT_A, { group: newId(), maxMs: '200' });
    await c.waitFor(() => c.ended, 3_000);
    await c.waitFor(() => hub.subscriberCount(CHANNEL) === 0 && sse.activeCount() === 0);
  });

  it('batas aliran per prinsipal: aliran baru menutup yang paling lama (superseded + retry panjang); prinsipal lain tidak', async () => {
    const group = newId();
    const p1 = `${TENANT_A}:device:${newId()}`;
    const p2 = `${TENANT_A}:device:${newId()}`;
    const first = await connect(TENANT_A, { group, principal: p1, maxPer: '2' });
    await first.waitFor(() => sse.activeForPrincipal(p1) === 1);
    const second = await connect(TENANT_A, { group, principal: p1, maxPer: '2' });
    await second.waitFor(() => sse.activeForPrincipal(p1) === 2);
    const other = await connect(TENANT_A, { group, principal: p2, maxPer: '2' });
    await other.waitFor(() => sse.activeForPrincipal(p2) === 1);
    const third = await connect(TENANT_A, { group, principal: p1, maxPer: '2' });
    await first.waitFor(() => first.ended);
    expect(first.frames.at(-1)).toEqual({
      retry: SSE_SUPERSEDED_RETRY_MS,
      event: 'superseded',
      data: { reason: 'too_many_streams' },
    });
    await third.waitFor(() => sse.activeForPrincipal(p1) === 2);
    expect(second.ended).toBe(false);
    expect(other.ended).toBe(false);
    // Aliran yang tersisa tetap menerima event.
    const id = await emit(TENANT_A, group);
    for (const c of [second, third, other]) await c.waitFor(() => c.ids().includes(id));
  });

  it('tidak memegang transaksi atau koneksi pool selama streaming (12 aliran > pool 10)', async () => {
    const streams = await Promise.all(
      Array.from({ length: 12 }, () => connect(TENANT_A, { group: newId() })),
    );
    await streams[0]?.waitFor(() => sse.activeCount() === 12);
    // Transaksi pendek otorisasi/audit pembukaan aliran boleh masih selesai; yang dipegang selama streaming tidak
    // akan pernah turun ke 0.
    let open = await openTransactions();
    for (let i = 0; i < 100 && open > 0; i++) {
      await settle(20);
      open = await openTransactions();
    }
    expect(open).toBe(0);
    expect(sse.activeCount()).toBe(12);
    await request(app.getHttpServer())
      .get('/api/v1/tenancy/current')
      .set('X-Tenant-Id', TENANT_A)
      .expect(200);
    expect(await listenConnections()).toBe(1);
  });

  it('izin tetap ditegakkan sebelum aliran dibuka (403 JSON, tanpa langganan)', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/test-infra/sse/stream?group=x`, {
      headers: bearer(tokens.akuntan as Tokens),
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'FORBIDDEN' });
    expect(hub.subscriberCount(CHANNEL)).toBe(0);
  });

  it('dipakai tanpa @NoRequestTransaction → ditolak sebelum header terkirim', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/test-infra/sse/in-transaction`, {
      headers: { 'X-Tenant-Id': TENANT_A },
    });
    expect(res.status).toBe(500);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(sse.activeCount()).toBe(0);
  });
});
