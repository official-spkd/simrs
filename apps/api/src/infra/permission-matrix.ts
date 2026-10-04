import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { roleGrants } from '@simrs/db';
import { isUuid, permissionKey, type PermissionScope } from '@simrs/shared';
import type { Redis } from 'ioredis';
import { API_ENV, type ApiEnv } from '../config/env';
import { PrismaService } from './prisma.service';
import { RedisService } from './redis.service';

/** Izin satu peran: `sumber.aksi` → lingkup. */
export type RoleGrants = ReadonlyMap<string, PermissionScope>;

export interface MatrixCacheOptions {
  /** Umur baris cache (ms); 0 = cache mati, setiap pemeriksaan membaca database. */
  ttlMs: number;
  /** Baca izin satu peran dari database (transaksi bertenant). */
  load: (tenantId: string, role: string) => Promise<RoleGrants>;
  /**
   * Cache hanya dipakai selama jalur invalidasi antar-instans hidup. Bila putus, setiap pemeriksaan membaca
   * database (tidak pernah memakai isi yang mungkin sudah usang tanpa batas).
   */
  live: () => boolean;
  now?: () => number;
}

interface Entry {
  grants: RoleGrants;
  expiresAt: number;
}

/**
 * P03 · Cache matriks izin di memori proses, per tenant × peran (logika murni; kabel Nest/Redis di
 * `PermissionMatrix`). Tenant adalah kunci terluar: pencarian selalu lewat tenant permintaan, jadi baris
 * tenant lain tidak pernah terbaca. Invalidasi menaikkan generasi tenant; hasil muat yang dimulai sebelum
 * invalidasi tidak disimpan (bisa saja membaca matriks lama sebelum perubahan di-commit).
 */
export class PermissionMatrixCache {
  private readonly tenants = new Map<string, Map<string, Entry>>();
  private readonly generations = new Map<string, number>();
  private epoch = 0;
  /** Penghitung untuk tes dan diagnosis. */
  readonly stats = { hits: 0, loads: 0 };

  constructor(private readonly opts: MatrixCacheOptions) {}

  private enabled(): boolean {
    return this.opts.ttlMs > 0 && this.opts.live();
  }

  private stamp(tenantId: string): string {
    return `${this.epoch}:${this.generations.get(tenantId) ?? 0}`;
  }

  async grants(tenantId: string, role: string): Promise<RoleGrants> {
    const now = (this.opts.now ?? Date.now)();
    if (this.enabled()) {
      const hit = this.tenants.get(tenantId)?.get(role);
      if (hit && hit.expiresAt > now) {
        this.stats.hits++;
        return hit.grants;
      }
    }
    const stamp = this.stamp(tenantId);
    this.stats.loads++;
    const grants = await this.opts.load(tenantId, role);
    if (this.enabled() && this.stamp(tenantId) === stamp) {
      let roles = this.tenants.get(tenantId);
      if (!roles) {
        roles = new Map();
        this.tenants.set(tenantId, roles);
      }
      roles.set(role, { grants, expiresAt: now + this.opts.ttlMs });
    }
    return grants;
  }

  /** Lingkup izin peran untuk sumber × aksi, atau null bila tidak berizin / peran nonaktif. */
  async scope(tenantId: string, role: string, resource: string, action: string) {
    return (await this.grants(tenantId, role)).get(permissionKey(resource, action)) ?? null;
  }

  /** Buang semua baris satu tenant; muat yang sedang berjalan untuk tenant itu tidak akan disimpan. */
  invalidateTenant(tenantId: string): void {
    this.generations.set(tenantId, (this.generations.get(tenantId) ?? 0) + 1);
    this.tenants.delete(tenantId);
  }

  /** Buang semua baris semua tenant (mis. jalur invalidasi baru tersambung lagi: pesan bisa terlewat). */
  clear(): void {
    this.epoch++;
    this.tenants.clear();
  }
}

/** Kanal Redis pub/sub untuk invalidasi matriks antar-instans API; isi pesan = ID tenant (tanpa PHI). */
export const MATRIX_INVALIDATION_CHANNEL = 'simrs:authz:matrix-invalidated';

/**
 * P03 · Pemeriksaan `@RequirePermission` memakai matriks dari cache, bukan satu transaksi database per
 * permintaan (ADR-0012, utang teknis P03).
 * - Kunci: tenant × kode peran; isi: seluruh izin peran (satu kueri saat meleset).
 * - Invalidasi eksplisit setelah commit perubahan matriks (`IamService` → `TenantDb.afterCommit`): seketika di
 *   instans ini, lalu disiarkan lewat Redis pub/sub ke instans lain.
 * - TTL (`AUTHZ_CACHE_TTL_SECONDS`, bawaan 30) sebagai jaring pengaman bila siaran terlewat, dan untuk
 *   perubahan dari luar API (mis. `pnpm db:sync-permissions`, yang hanya menambah izin).
 * - Cache hanya dipakai selama langganan Redis hidup. Redis mati/putus → setiap pemeriksaan membaca database;
 *   saat tersambung lagi seluruh cache dibuang (pesan selama putus bisa terlewat).
 * Penolakan tetap diaudit oleh interceptor seperti sebelumnya; cache hanya menghemat pembacaan matriks.
 */
@Injectable()
export class PermissionMatrix implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PermissionMatrix.name);
  private readonly ttlSeconds: number;
  readonly cache: PermissionMatrixCache;
  private subscriber: Redis | null = null;
  private publisher: Redis | null = null;
  private live = false;

  constructor(
    @Inject(API_ENV) env: ApiEnv,
    prisma: PrismaService,
    private readonly redis: RedisService,
  ) {
    this.ttlSeconds = env.AUTHZ_CACHE_TTL_SECONDS;
    this.cache = new PermissionMatrixCache({
      ttlMs: this.ttlSeconds * 1000,
      live: () => this.live,
      load: (tenantId, role) => prisma.forTenant(tenantId, (tx) => roleGrants(tx, role)),
    });
  }

  onModuleInit(): void {
    if (this.ttlSeconds === 0) return;
    // Koneksi sendiri: koneksi berlangganan tidak bisa dipakai perintah lain, dan klien bersama dipakai /ready.
    const sub = this.redis.client.duplicate({
      lazyConnect: true,
      autoResubscribe: false,
      enableOfflineQueue: false,
      maxRetriesPerRequest: null,
    });
    sub.on('error', () => {
      // Status Redis dilaporkan /ready; selama putus cache tidak dipakai (lihat `close`).
    });
    sub.on('ready', () => void this.subscribe(sub));
    sub.on('close', () => this.setLive(false));
    sub.on('message', (channel: string, message: string) => {
      if (channel === MATRIX_INVALIDATION_CHANNEL && isUuid(message)) this.cache.invalidateTenant(message);
    });
    this.subscriber = sub;
    sub.connect().catch(() => {
      // Tersambung ulang otomatis (retryStrategy ioredis); sampai itu pemeriksaan membaca database.
    });
    const pub = this.redis.client.duplicate({ enableOfflineQueue: false, maxRetriesPerRequest: 1 });
    pub.on('error', () => {
      // Kegagalan kirim ditangani di `invalidateTenant`.
    });
    this.publisher = pub;
  }

  private async subscribe(sub: Redis): Promise<void> {
    try {
      await sub.subscribe(MATRIX_INVALIDATION_CHANNEL);
      this.setLive(true);
    } catch {
      this.setLive(false);
    }
  }

  private setLive(live: boolean): void {
    this.live = live;
    this.cache.clear();
  }

  /** Jalur invalidasi antar-instans hidup (cache sedang dipakai). */
  isLive(): boolean {
    return this.live;
  }

  scope(tenantId: string, role: string, resource: string, action: string): Promise<PermissionScope | null> {
    return this.cache.scope(tenantId, role, resource, action);
  }

  /**
   * Matriks tenant berubah: buang cache instans ini lalu siarkan ke instans lain. Panggil SETELAH commit
   * (`TenantDb.afterCommit`); sebelum commit, permintaan lain bisa memuat ulang matriks lama ke cache.
   */
  async invalidateTenant(tenantId: string): Promise<void> {
    this.cache.invalidateTenant(tenantId);
    if (!this.publisher) return;
    try {
      await this.publisher.publish(MATRIX_INVALIDATION_CHANNEL, tenantId);
    } catch {
      this.logger.warn(
        `Invalidasi matriks izin tenant ${tenantId} tidak terkirim ke instans lain; berlaku paling lambat ${this.ttlSeconds} detik`,
      );
    }
  }

  onModuleDestroy(): void {
    this.subscriber?.disconnect();
    this.publisher?.disconnect();
    this.live = false;
  }
}
