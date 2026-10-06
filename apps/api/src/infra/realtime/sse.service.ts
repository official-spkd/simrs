import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import type { TenantTx } from '@simrs/db';
import type { Request, Response } from 'express';
import { sanitizeForLog } from '../../common/error.filter';
import { requestContext, type TenantRequestContext } from '../../common/request-context';
import { auditMetaOf, writeAudit } from '../audit-writer';
import { PrismaService } from '../prisma.service';
import { type NotificationSubscription, NOTIFY_CHANNEL, PgNotificationHub } from './pg-notification-hub';

/** Satu event SSE. `id` stabil dan terurut (mis. UUID v7 baris) karena klien mengirimnya balik di `Last-Event-ID`. */
export interface SseEvent<T = unknown> {
  id: string;
  /** Nama event (`event:`), mis. `queue.called`. */
  event: string;
  /** Diserialisasi JSON. Seminimal mungkin; PHI hanya di aliran staf yang diaudit saat berlangganan. */
  data: T;
}

/**
 * Definisi aliran untuk satu kanal `pg_notify`. Dibuat sekali per modul (konstanta atau provider), bukan per koneksi:
 * hasil `load` dibagi ke semua koneksi tenant yang sama selama beberapa detik.
 */
export interface SseChannel<T = unknown> {
  /** Kanal `pg_notify`, biasanya nama tabel (mis. `queue_calls`). */
  readonly name: string;
  /**
   * Baca baris `id` di transaksi pendek tenant pelanggan (RLS). `null` → tidak dikirim (tidak terlihat, sudah tidak
   * relevan). Hanya baca; jangan menulis.
   */
  load(tx: TenantTx, id: string): Promise<SseEvent<T> | null>;
  /**
   * Event setelah `afterId` (lama → baru), maksimal `limit`. Dipakai untuk `Last-Event-ID` dan setelah koneksi LISTEN
   * tersambung ulang. Tanpa ini klien menerima event `reset` dan wajib memuat ulang snapshot.
   */
  replay?(tx: TenantTx, afterId: string, limit: number): Promise<Array<SseEvent<T>>>;
}

export interface SseStreamOptions<T> {
  /** Saring per koneksi (mis. hanya layanan antrean milik display ini). */
  filter?: (event: SseEvent<T>) => boolean;
  /** Komentar `: ping` agar proxy tidak memutus koneksi diam. Bawaan 15 dtk. */
  heartbeatMs?: number;
  /**
   * Umur maksimum satu koneksi (bawaan 5 menit, dipendekkan acak hingga 20% agar tidak serempak). Setelahnya server
   * menutup; EventSource menyambung ulang dengan `Last-Event-ID`, sehingga sesi/izin diperiksa ulang secara berkala.
   */
  maxDurationMs?: number;
  /** Batas event yang diputar ulang; lebih dari ini → event `reset`. Bawaan 200. */
  replayLimit?: number;
  /**
   * Potret awal (mis. papan antrean) yang dikirim setelah LISTEN aktif dan setelah replay, TANPA `id:` (tidak menggeser
   * `Last-Event-ID` klien). Dijalankan di transaksi pendek bertenant dengan konteks permintaan, jadi repository
   * (`TenantDb`) bekerja seperti biasa; hanya baca. Galat → aliran ditutup (klien menyambung ulang).
   */
  initial?: () => Promise<Array<{ event: string; data: unknown }>>;
  /**
   * Batas aliran bersamaan per prinsipal di instans ini; aliran baru menutup yang PALING LAMA (event `superseded` +
   * `retry` panjang). Bawaan: perangkat `SSE_MAX_STREAMS_PER_DEVICE`, pengguna `SSE_MAX_STREAMS_PER_USER`; tanpa
   * prinsipal (mode header pengembang) tidak dibatasi.
   */
  maxPerPrincipal?: number;
  /** Kunci prinsipal pengganti (tes); bawaan dari konteks permintaan: tenant + perangkat, atau tenant + pengguna. */
  principalKey?: string;
}

export const SSE_HEARTBEAT_MS = 15_000;
export const SSE_MAX_DURATION_MS = 5 * 60_000;
export const SSE_REPLAY_LIMIT = 200;
/** Saran jeda sambung ulang untuk EventSource (`retry:`). */
export const SSE_RETRY_MS = 3_000;
/**
 * Aliran bersamaan per perangkat (TV/anjungan) per instans API. Satu TV normalnya satu aliran; dua memberi ruang untuk
 * tumpang tindih sesaat saat BFF menyambung ulang. Lebih dari itu (tab ganda, cookie yang disalin) → yang paling lama
 * ditutup.
 */
export const SSE_MAX_STREAMS_PER_DEVICE = 2;
/** Aliran bersamaan per pengguna staf (beberapa tab) per instans API. */
export const SSE_MAX_STREAMS_PER_USER = 5;
/** Jeda sambung ulang yang disarankan ke aliran yang digantikan, agar dua klien tidak saling menendang tiap detik. */
export const SSE_SUPERSEDED_RETRY_MS = 60_000;
/** Antrean tugas per koneksi; lebih dari ini klien terlalu lambat → koneksi ditutup (klien memutar ulang). */
const MAX_PENDING_TASKS = 500;
/** Data yang belum terkirim ke socket; lebih dari ini klien terlalu lambat → koneksi ditutup. */
const MAX_BUFFERED_BYTES = 1024 * 1024;
/** Lama hasil `load` dibagi antar-koneksi. */
const LOAD_SHARE_MS = 2_000;
const EVENT_NAME = /^[a-z][a-z0-9._-]{0,63}$/;
const EVENT_ID = /^[A-Za-z0-9._:-]{1,128}$/;

/**
 * ADR-0026 · Aliran Server-Sent Events di atas `PgNotificationHub`. Dipanggil dari handler `@TenantScoped()` +
 * `@NoRequestTransaction()` (otorisasi dan audit sudah selesai di transaksi pendek interceptor) dengan `@Req()` dan
 * `@Res()`:
 *
 * - tidak memegang transaksi atau koneksi pool selama streaming; setiap event dibaca di transaksi pendek
 *   `withTenant` tenant pelanggan (RLS),
 * - `Last-Event-ID` (header, atau query `lastEventId` untuk BFF) → `replay`; koneksi LISTEN putus → `replay` lagi,
 * - heartbeat tiap 15 dtk, `X-Accel-Buffering: no` untuk reverse proxy,
 * - berhenti dan melepas langganan saat klien putus, saat batas umur, atau saat aplikasi berhenti.
 *
 * Prinsipal pelanggan (staf sekarang; perangkat anjungan/TV setelah ADR-0027) cukup tercermin di konteks permintaan
 * (tenant + pelaku); helper ini tidak bergantung pada jenis prinsipal.
 */
@Injectable()
export class SseService implements OnModuleDestroy {
  private readonly logger = new Logger('SseService');
  private readonly connections = new Set<SseConnection>();
  private readonly loads = new WeakMap<SseChannel, Map<string, Promise<SseEvent | null>>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly hub: PgNotificationHub,
  ) {}

  /** Mulai aliran. Kembali segera setelah header terkirim; aliran berjalan sampai ditutup. */
  stream<T>(req: Request, res: Response, channel: SseChannel<T>, options: SseStreamOptions<T> = {}): void {
    const ctx = requestContext.getStore();
    if (!ctx) throw new Error('SseService.stream() di luar permintaan bertenant. Pasang @TenantScoped().');
    if (ctx.tx) {
      throw new Error('SseService.stream() di dalam transaksi. Pasang @NoRequestTransaction() (ADR-0026).');
    }
    if (!NOTIFY_CHANNEL.test(channel.name)) throw new Error(`Nama kanal SSE tidak sah: ${channel.name}`);
    const { tenantId, requestId } = ctx;
    const principal = options.principalKey ?? principalKeyOf(ctx);
    const replay = channel.replay?.bind(channel);
    const { initial } = options;
    const connection = new SseConnection({
      res,
      channel: channel.name,
      principal,
      // Event yang sampai ke filter selalu berasal dari kanal ini, jadi bertipe SseEvent<T>.
      filter: (options.filter as ((e: SseEvent) => boolean) | undefined) ?? (() => true),
      heartbeatMs: options.heartbeatMs ?? SSE_HEARTBEAT_MS,
      maxDurationMs: options.maxDurationMs ?? SSE_MAX_DURATION_MS,
      replayLimit: options.replayLimit ?? SSE_REPLAY_LIMIT,
      // Potret awal sering memuat PHI (mis. papan IGD: nama + RM): entri `TenantDb.audit()` di dalamnya ditulis di
      // transaksi yang sama, seperti versi REST-nya. Diulang setiap sambung ulang (umur aliran maks. 5 menit).
      initial: initial
        ? () =>
            this.prisma.forTenant(tenantId, (tx) => {
              const store: TenantRequestContext = { ...ctx, tx, audit: [], afterCommit: [] };
              return requestContext.run(store, async () => {
                const snapshot = await initial();
                await writeAudit(tx, tenantId, auditMetaOf(ctx), store.audit);
                return snapshot;
              });
            })
        : null,
      load: (id) => this.loadShared(channel, tenantId, id),
      replay: replay
        ? (afterId, limit) => this.prisma.forTenant(tenantId, (tx) => replay(tx, afterId, limit))
        : null,
      subscribe: (listener) => this.hub.subscribe(channel.name, tenantId, listener),
      onClose: (conn) => this.connections.delete(conn),
      onError: (err) =>
        this.logger.warn(
          { channel: channel.name, err: sanitizeForLog(err), requestId },
          'Aliran SSE dihentikan',
        ),
    });
    if (principal) {
      const max =
        options.maxPerPrincipal ??
        (ctx.actor.devicePrincipal ? SSE_MAX_STREAMS_PER_DEVICE : SSE_MAX_STREAMS_PER_USER);
      this.evictOldest(principal, Math.max(0, max - 1));
    }
    this.connections.add(connection);
    connection.start(req, lastEventId(req));
  }

  /** Sisakan paling banyak `keep` aliran prinsipal ini; yang paling lama (urutan masuk Set) ditutup lebih dulu. */
  private evictOldest(principal: string, keep: number): void {
    const mine = [...this.connections].filter((c) => c.principal === principal);
    for (const old of mine.slice(0, Math.max(0, mine.length - keep))) {
      this.logger.log({ channel: old.channel }, 'Aliran SSE lama ditutup: batas aliran per prinsipal');
      old.supersede();
    }
  }

  /** Jumlah aliran terbuka prinsipal ini di instans ini (tes dan metrik). */
  activeForPrincipal(principal: string): number {
    let n = 0;
    for (const c of this.connections) if (c.principal === principal) n += 1;
    return n;
  }

  /** Jumlah aliran terbuka di instans ini (opsional per kanal). Untuk tes dan metrik. */
  activeCount(channel?: string): number {
    if (channel === undefined) return this.connections.size;
    let n = 0;
    for (const c of this.connections) if (c.channel === channel) n += 1;
    return n;
  }

  onModuleDestroy(): void {
    for (const connection of [...this.connections]) connection.close();
  }

  /** Satu pembacaan per (kanal, tenant, id) untuk semua koneksi; dibuang setelah `LOAD_SHARE_MS`. */
  private loadShared(channel: SseChannel, tenantId: string, id: string): Promise<SseEvent | null> {
    let byChannel = this.loads.get(channel);
    if (!byChannel) {
      byChannel = new Map();
      this.loads.set(channel, byChannel);
    }
    const key = `${tenantId}:${id}`;
    const existing = byChannel.get(key);
    if (existing) return existing;
    const loading = this.prisma.forTenant(tenantId, (tx) => channel.load(tx, id));
    const map = byChannel;
    map.set(key, loading);
    const forget = () => {
      if (map.get(key) === loading) map.delete(key);
    };
    loading.then(
      () => setTimeout(forget, LOAD_SHARE_MS).unref(),
      () => forget(),
    );
    return loading;
  }
}

/** Kunci batas aliran: tenant + perangkat (ADR-0027) atau tenant + pengguna; `null` tanpa prinsipal. */
export function principalKeyOf(ctx: Pick<TenantRequestContext, 'tenantId' | 'actor'>): string | null {
  const device = ctx.actor.devicePrincipal?.id;
  if (device) return `${ctx.tenantId}:device:${device}`;
  return ctx.actor.userId ? `${ctx.tenantId}:user:${ctx.actor.userId}` : null;
}

/** `Last-Event-ID` dari header (EventSource) atau query `lastEventId` (BFF); nilai tak wajar diabaikan. */
function lastEventId(req: Request): string | null {
  const header = req.headers['last-event-id'];
  const query = req.query.lastEventId;
  const value = typeof header === 'string' && header ? header : typeof query === 'string' ? query : null;
  return value && EVENT_ID.test(value) ? value : null;
}

interface SseConnectionDeps {
  res: Response;
  channel: string;
  principal: string | null;
  filter: (event: SseEvent) => boolean;
  heartbeatMs: number;
  maxDurationMs: number;
  replayLimit: number;
  load: (id: string) => Promise<SseEvent | null>;
  replay: ((afterId: string, limit: number) => Promise<SseEvent[]>) | null;
  initial: (() => Promise<Array<{ event: string; data: unknown }>>) | null;
  subscribe: (listener: { notify(id: string): void; resync(): void }) => NotificationSubscription;
  onClose: (connection: SseConnection) => void;
  onError: (err: unknown) => void;
}

/** Satu koneksi SSE. Semua tugas (baca, putar ulang) berjalan berurutan agar urutan event terjaga. */
class SseConnection {
  readonly channel: string;
  readonly principal: string | null;
  private closed = false;
  private lastId: string | null = null;
  private readonly sent = new RecentIds(512);
  private chain: Promise<void> = Promise.resolve();
  private pending = 0;
  private heartbeat: NodeJS.Timeout | undefined;
  private deadline: NodeJS.Timeout | undefined;
  private subscription: NotificationSubscription | undefined;

  constructor(private readonly deps: SseConnectionDeps) {
    this.channel = deps.channel;
    this.principal = deps.principal;
  }

  start(req: Request, lastEventId: string | null): void {
    const { res } = this.deps;
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-transform');
    res.setHeader('Connection', 'keep-alive');
    // nginx dan sejenisnya: jangan menahan (buffer) aliran.
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    req.socket.setTimeout(0);
    req.socket.setNoDelay(true);
    req.socket.setKeepAlive(true);
    res.on('close', () => this.close());
    if (req.socket.destroyed) {
      // Klien sudah pergi sebelum pendengar terpasang.
      this.close();
      return;
    }
    this.write(`retry: ${SSE_RETRY_MS}\n\n`);

    this.heartbeat = setInterval(() => this.write(': ping\n\n'), this.deps.heartbeatMs);
    this.heartbeat.unref();
    const lifetime = Math.round(this.deps.maxDurationMs * (0.8 + Math.random() * 0.2));
    this.deadline = setTimeout(() => this.close(), lifetime);
    this.deadline.unref();

    this.lastId = lastEventId;
    let subscription: NotificationSubscription;
    try {
      subscription = this.deps.subscribe({
        notify: (id) => this.enqueue(() => this.deliver(id)),
        resync: () => this.enqueue(() => this.replay()),
      });
    } catch (err) {
      // Mis. aplikasi sedang berhenti: tutup; klien menyambung ulang ke instans lain.
      this.deps.onError(err);
      this.close();
      return;
    }
    this.subscription = subscription;
    // Putar ulang SETELAH LISTEN aktif: event yang commit sesudahnya datang lewat notifikasi (antre di belakang ini).
    this.enqueue(async () => {
      await subscription.ready;
      if (lastEventId) await this.replay();
      if (this.deps.initial) {
        for (const e of await this.deps.initial()) this.sendWithoutId(e.event, e.data);
      }
    });
  }

  /**
   * Digantikan aliran baru prinsipal yang sama: beri tahu klien (event tanpa `id`, Last-Event-ID tidak berubah) dan
   * sarankan jeda sambung ulang panjang, lalu tutup.
   */
  supersede(): void {
    this.write(
      `retry: ${SSE_SUPERSEDED_RETRY_MS}\nevent: superseded\ndata: ${JSON.stringify({ reason: 'too_many_streams' })}\n\n`,
    );
    this.close();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.heartbeat);
    clearTimeout(this.deadline);
    this.subscription?.unsubscribe();
    if (!this.deps.res.writableEnded) this.deps.res.end();
    this.deps.onClose(this);
  }

  private enqueue(task: () => Promise<void>): void {
    if (this.closed) return;
    if (this.pending >= MAX_PENDING_TASKS) {
      this.deps.onError(new Error('antrean SSE penuh'));
      this.close();
      return;
    }
    this.pending += 1;
    this.chain = this.chain
      .then(task)
      .catch((err: unknown) => {
        // Baca/putar ulang gagal (mis. pool penuh): tutup; klien menyambung ulang dengan Last-Event-ID.
        if (!this.closed) this.deps.onError(err);
        this.close();
      })
      .finally(() => {
        this.pending -= 1;
      });
  }

  private async deliver(id: string): Promise<void> {
    if (this.closed || this.sent.has(id)) return;
    const event = await this.deps.load(id);
    if (event && !this.closed) this.send(event);
  }

  private async replay(): Promise<void> {
    if (this.closed) return;
    const { replay, replayLimit } = this.deps;
    if (!replay || !this.lastId) {
      this.reset('replay_unavailable');
      return;
    }
    const events = await replay(this.lastId, replayLimit + 1);
    if (this.closed) return;
    if (events.length > replayLimit) {
      this.reset('replay_too_long');
      return;
    }
    for (const event of events) if (!this.sent.has(event.id)) this.send(event);
  }

  private send(event: SseEvent): void {
    if (!EVENT_ID.test(event.id) || !EVENT_NAME.test(event.event)) {
      throw new Error(`Event SSE tidak sah di kanal ${this.channel}`);
    }
    if (!this.deps.filter(event)) return;
    this.write(`id: ${event.id}\nevent: ${event.event}\ndata: ${JSON.stringify(event.data ?? null)}\n\n`);
    this.sent.add(event.id);
    this.lastId = event.id;
  }

  /** Potret awal: event bernama tanpa `id` (Last-Event-ID klien tidak berubah), tidak melewati filter. */
  private sendWithoutId(event: string, data: unknown): void {
    if (this.closed) return;
    if (!EVENT_NAME.test(event)) throw new Error(`Event SSE tidak sah di kanal ${this.channel}`);
    this.write(`event: ${event}\ndata: ${JSON.stringify(data ?? null)}\n\n`);
  }

  /** Klien wajib memuat ulang snapshot (event tanpa `id`, jadi Last-Event-ID klien tidak berubah). */
  private reset(reason: 'replay_unavailable' | 'replay_too_long'): void {
    this.write(`event: reset\ndata: ${JSON.stringify({ reason })}\n\n`);
  }

  private write(chunk: string): void {
    const { res } = this.deps;
    if (this.closed || res.writableEnded || res.destroyed) return;
    const flushed = res.write(chunk);
    if (!flushed && res.writableLength > MAX_BUFFERED_BYTES) {
      this.deps.onError(new Error('klien SSE terlalu lambat'));
      this.close();
    }
  }
}

/** Himpunan id terakhir yang terkirim (berbatas), untuk membuang duplikat antara putar ulang dan notifikasi. */
class RecentIds {
  private readonly ids = new Set<string>();
  constructor(private readonly max: number) {}
  has(id: string): boolean {
    return this.ids.has(id);
  }
  add(id: string): void {
    this.ids.add(id);
    if (this.ids.size > this.max) {
      const oldest = this.ids.values().next().value;
      if (oldest !== undefined) this.ids.delete(oldest);
    }
  }
}
