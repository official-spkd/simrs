import { Inject, Injectable, Logger, type OnModuleDestroy, Optional } from '@nestjs/common';
import { backoffDelayMs, isUuid } from '@simrs/shared';
import { Client, type Notification } from 'pg';
import { sanitizeForLog } from '../../common/error.filter';
import { API_ENV, type ApiEnv } from '../../config/env';

/** Nama kanal `pg_notify` yang sah: identifier Postgres huruf kecil (aman disisipkan tanpa parameter). */
export const NOTIFY_CHANNEL = /^[a-z][a-z0-9_]{0,62}$/;

/** `application_name` koneksi LISTEN, agar mudah dikenali di `pg_stat_activity`. */
export const LISTEN_APPLICATION_NAME = 'simrs-api-listen';

export const REALTIME_OPTIONS = Symbol('REALTIME_OPTIONS');

export interface RealtimeOptions {
  /** Basis dan batas backoff sambung ulang koneksi LISTEN (ms). */
  reconnectBaseMs: number;
  reconnectCapMs: number;
}

const DEFAULT_OPTIONS: RealtimeOptions = { reconnectBaseMs: 500, reconnectCapMs: 30_000 };

/** Pelanggan satu kanal + satu tenant. Dipanggil sinkron; jangan melempar dan jangan menunggu di sini. */
export interface NotificationListener {
  /** Baris baru `id` milik tenant pelanggan di kanal ini (payload `{ tenant_id, id }`). */
  notify(id: string): void;
  /** Koneksi LISTEN tersambung ulang: notifikasi selama putus bisa hilang, baca ulang dari id terakhir. */
  resync(): void;
}

export interface NotificationSubscription {
  /** Selesai saat LISTEN kanal ini aktif (bisa menunggu sambung ulang). Tidak pernah gagal. */
  ready: Promise<void>;
  unsubscribe(): void;
}

/**
 * ADR-0026 · SATU koneksi `LISTEN` per instans API (klien pg tersendiri, bukan dari pool Prisma), dibuka saat pelanggan
 * pertama datang. Notifikasi `pg_notify(kanal, '{"tenant_id":…,"id":…}')` (dipicu trigger tabel saat commit) diteruskan
 * hanya ke pelanggan kanal + tenant yang sama. Payload tanpa PHI; isi baris dibaca pelanggan lewat `withTenant` (RLS),
 * jadi payload palsu pun tidak membuka data tenant lain.
 *
 * Koneksi putus → sambung ulang dengan backoff eksponensial + jitter, LISTEN ulang semua kanal, lalu `resync()` ke
 * semua pelanggan. Koneksi ini wajib langsung ke Postgres atau lewat pooler mode sesi (LISTEN tidak jalan di mode
 * transaksi).
 */
@Injectable()
export class PgNotificationHub implements OnModuleDestroy {
  private readonly logger = new Logger('PgNotificationHub');
  private readonly options: RealtimeOptions;
  private readonly connectionString: string;
  /** Klien yang tersambung dan sudah LISTEN semua kanal di `listening`. */
  private client: Client | null = null;
  private listening = new Set<string>();
  private connecting = false;
  private everConnected = false;
  private attempt = 0;
  private timer: NodeJS.Timeout | undefined;
  private closed = false;
  /** Kanal yang diminta (di-LISTEN ulang setiap sambung). */
  private readonly channels = new Set<string>();
  /** `kanal:tenant` → pelanggan. */
  private readonly subscribers = new Map<string, Set<NotificationListener>>();
  /** Menunggu koneksi berikutnya selesai LISTEN. */
  private waiters: Array<() => void> = [];
  /** Kueri ke klien LISTEN dijalankan satu per satu (pg tidak menerima kueri bertumpuk di satu klien). */
  private queries: Promise<unknown> = Promise.resolve();

  constructor(
    @Inject(API_ENV) env: ApiEnv,
    @Optional() @Inject(REALTIME_OPTIONS) options?: Partial<RealtimeOptions>,
  ) {
    this.connectionString = env.DATABASE_URL;
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  subscribe(channel: string, tenantId: string, listener: NotificationListener): NotificationSubscription {
    if (!NOTIFY_CHANNEL.test(channel)) throw new Error(`Nama kanal notifikasi tidak sah: ${channel}`);
    if (!isUuid(tenantId)) throw new Error('Tenant pelanggan notifikasi tidak sah');
    if (this.closed) throw new Error('PgNotificationHub sudah ditutup');
    const key = subscriberKey(channel, tenantId.toLowerCase());
    let set = this.subscribers.get(key);
    if (!set) {
      set = new Set();
      this.subscribers.set(key, set);
    }
    set.add(listener);
    this.channels.add(channel);
    const ready = this.ensureListening(channel);
    return {
      ready,
      unsubscribe: () => {
        const current = this.subscribers.get(key);
        if (!current) return;
        current.delete(listener);
        if (current.size === 0) this.subscribers.delete(key);
      },
    };
  }

  /** Jumlah pelanggan (semua, per kanal, atau per kanal + tenant). Untuk tes dan metrik. */
  subscriberCount(channel?: string, tenantId?: string): number {
    let n = 0;
    for (const [key, set] of this.subscribers) {
      const [ch, tenant] = key.split(':');
      if (channel !== undefined && ch !== channel) continue;
      if (tenantId !== undefined && tenant !== tenantId.toLowerCase()) continue;
      n += set.size;
    }
    return n;
  }

  isConnected(): boolean {
    return this.client !== null;
  }

  /** PID backend koneksi LISTEN (diagnostik/tes), atau null bila belum tersambung. */
  async listenerBackendPid(): Promise<number | null> {
    const client = this.client;
    if (!client) return null;
    const res = await this.serial(() => client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid'));
    return res.rows[0]?.pid ?? null;
  }

  async onModuleDestroy(): Promise<void> {
    this.closed = true;
    clearTimeout(this.timer);
    const client = this.client;
    this.client = null;
    this.listening = new Set();
    if (client) await client.end().catch(() => undefined);
  }

  private async ensureListening(channel: string): Promise<void> {
    const client = this.client;
    if (client && this.listening.has(channel)) return;
    if (client) {
      try {
        await this.serial(async () => {
          if (this.client === client && !this.listening.has(channel))
            await client.query(`LISTEN "${channel}"`);
        });
        if (this.client === client) {
          this.listening.add(channel);
          return;
        }
      } catch (err) {
        this.lost(client, err);
      }
    }
    // Belum/tidak tersambung: tunggu koneksi berikutnya (yang LISTEN semua kanal yang diminta).
    const wait = new Promise<void>((resolve) => this.waiters.push(resolve));
    void this.connect();
    return wait;
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queries.then(fn, fn);
    this.queries = next.catch(() => undefined);
    return next;
  }

  private async connect(): Promise<void> {
    if (this.closed || this.connecting || this.client || this.timer) return;
    this.connecting = true;
    const client = new Client({
      connectionString: this.connectionString,
      application_name: LISTEN_APPLICATION_NAME,
      keepAlive: true,
    });
    client.on('notification', (msg) => this.dispatch(msg));
    client.on('error', (err) => this.lost(client, err));
    client.on('end', () => this.lost(client));
    try {
      await client.connect();
      const listening = new Set<string>();
      for (const channel of this.channels) {
        await client.query(`LISTEN "${channel}"`);
        listening.add(channel);
      }
      if (this.closed) {
        await client.end().catch(() => undefined);
        return;
      }
      this.client = client;
      this.listening = listening;
      this.attempt = 0;
      const reconnected = this.everConnected;
      this.everConnected = true;
      if (reconnected) this.logger.log('Koneksi LISTEN tersambung kembali');
      // Kanal yang diminta selama proses sambung berlangsung.
      for (const channel of this.channels) {
        if (!listening.has(channel)) void this.ensureListening(channel);
      }
      const waiters = this.waiters;
      this.waiters = [];
      for (const resolve of waiters) resolve();
      if (reconnected) this.resyncAll();
    } catch (err) {
      this.logger.warn({ err: sanitizeForLog(err), attempt: this.attempt + 1 }, 'Koneksi LISTEN gagal');
      client.removeAllListeners();
      client.on('error', () => undefined);
      await client.end().catch(() => undefined);
      this.connecting = false;
      this.scheduleReconnect();
      return;
    }
    this.connecting = false;
  }

  /** Koneksi aktif putus (galat/akhir). Klien lama atau yang masih dalam proses sambung diabaikan. */
  private lost(client: Client, err?: unknown): void {
    if (this.client !== client) return;
    this.client = null;
    this.listening = new Set();
    this.logger.warn({ err: err ? sanitizeForLog(err) : undefined }, 'Koneksi LISTEN terputus');
    client.removeAllListeners();
    client.on('error', () => undefined);
    void client.end().catch(() => undefined);
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.closed || this.timer) return;
    this.attempt += 1;
    const delay = backoffDelayMs(this.attempt, this.options.reconnectBaseMs, this.options.reconnectCapMs);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.connect();
    }, delay);
    this.timer.unref();
  }

  private dispatch(msg: Notification): void {
    const parsed = parsePayload(msg.payload);
    if (!parsed) {
      // Tanpa isi payload di log: bisa saja berisi data yang tidak semestinya.
      this.logger.warn({ channel: msg.channel }, 'Payload notifikasi tidak dikenali, diabaikan');
      return;
    }
    const set = this.subscribers.get(subscriberKey(msg.channel, parsed.tenantId));
    if (!set) return;
    for (const listener of [...set]) {
      try {
        listener.notify(parsed.id);
      } catch (err) {
        this.logger.error({ channel: msg.channel, err: sanitizeForLog(err) }, 'Pelanggan notifikasi gagal');
      }
    }
  }

  private resyncAll(): void {
    for (const set of this.subscribers.values()) {
      for (const listener of [...set]) {
        try {
          listener.resync();
        } catch (err) {
          this.logger.error({ err: sanitizeForLog(err) }, 'Pelanggan notifikasi gagal resync');
        }
      }
    }
  }
}

const subscriberKey = (channel: string, tenantId: string) => `${channel}:${tenantId}`;

/** Payload `{ "tenant_id": uuid, "id": uuid }` (lihat `app_notify_row()` di ADR-0026). Selain itu → null. */
export function parsePayload(payload: string | undefined): { tenantId: string; id: string } | null {
  if (!payload || payload.length > 512) return null;
  let value: unknown;
  try {
    value = JSON.parse(payload);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const { tenant_id: tenantId, id } = value as { tenant_id?: unknown; id?: unknown };
  if (typeof tenantId !== 'string' || typeof id !== 'string' || !isUuid(tenantId) || !isUuid(id)) return null;
  return { tenantId: tenantId.toLowerCase(), id: id.toLowerCase() };
}
