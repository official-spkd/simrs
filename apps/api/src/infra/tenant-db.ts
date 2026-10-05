import { Injectable, Logger } from '@nestjs/common';
import type { TenantTx } from '@simrs/db';
import {
  type PendingAudit,
  requestContext,
  runAfterCommitHooks,
  type TenantRequestContext,
} from '../common/request-context';
import { writeAudit } from './audit-writer';
import { PrismaService } from './prisma.service';

/**
 * Akses database untuk repository: SELALU transaksi bertenant milik permintaan saat ini.
 * Dipanggil di luar permintaan bertenant (lupa `@TenantScoped()`) → galat program, bukan akses tanpa RLS.
 */
@Injectable()
export class TenantDb {
  private readonly logger = new Logger(TenantDb.name);

  constructor(private readonly prisma: PrismaService) {}

  private context(): TenantRequestContext {
    const ctx = requestContext.getStore();
    if (!ctx) {
      throw new Error('Akses data di luar transaksi tenant. Pasang @TenantScoped() pada controller.');
    }
    return ctx;
  }

  /** Transaksi aktif (RLS dengan app.tenant_id permintaan ini). */
  tx(): TenantTx {
    const { tx } = this.context();
    if (!tx) {
      throw new Error(
        'Handler @NoRequestTransaction() tidak punya transaksi permintaan. Bungkus akses data dengan TenantDb.transaction().',
      );
    }
    return tx;
  }

  /** Apakah transaksi (permintaan atau pendek) sedang terbuka di konteks ini. */
  inTransaction(): boolean {
    return this.context().tx !== null;
  }

  tenantId(): string {
    return this.context().tenantId;
  }

  actorUserId(): string | null {
    return this.context().actor.userId;
  }

  actor() {
    return this.context().actor;
  }

  /** Request id permintaan ini (untuk log tanpa PHI). */
  requestId(): string | null {
    return this.context().requestId;
  }

  /** Lingkup izin endpoint ini (all | unit | relationship) untuk penyaringan data di service. */
  permissionScope() {
    return this.context().permissionScope;
  }

  /**
   * Tambah entri audit dari service (mis. satu entri per pasien yang tampil di hasil pencarian).
   * Ditulis di transaksi yang sama sebelum commit; bila gagal, seluruh permintaan dibatalkan.
   * Di handler `@NoRequestTransaction()` di luar transaksi pendek: ditulis setelah handler selesai.
   */
  audit(entry: PendingAudit): void {
    this.context().audit.push(entry);
  }

  /**
   * Jalankan `fn` setelah transaksi ini commit (lihat `TenantRequestContext.afterCommit`): transaksi permintaan, atau
   * transaksi pendek `TenantDb.transaction()` pada handler `@NoRequestTransaction()`.
   */
  afterCommit(fn: () => Promise<void> | void): void {
    this.context().afterCommit.push(fn);
  }

  /**
   * ADR-0025/0026 · Transaksi pendek bertenant untuk handler `@NoRequestTransaction()`. Di dalam `fn`, repository
   * (`TenantDb.tx()`), `TenantDb.audit()`, `TenantDb.afterCommit()`, dan event domain bekerja seperti biasa; audit
   * ditulis sebelum commit dan batal bersama datanya. Jangan memanggil sistem luar di dalam `fn` (koneksi pool
   * sedang dipegang). Di dalam transaksi permintaan atau transaksi pendek lain → galat program (tidak bersarang).
   */
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    const outer = this.context();
    if (outer.tx) {
      throw new Error(
        'TenantDb.transaction() hanya untuk handler @NoRequestTransaction() di luar transaksi lain.',
      );
    }
    const afterCommit: TenantRequestContext['afterCommit'] = [];
    const result = await this.prisma.forTenant(outer.tenantId, (tx) => {
      const inner: TenantRequestContext = { ...outer, tx, audit: [], afterCommit };
      return requestContext.run(inner, async () => {
        const value = await fn();
        await writeAudit(
          tx,
          outer.tenantId,
          {
            actorUserId: outer.actor.userId,
            actorRole: outer.actor.role,
            ip: outer.ip,
            userAgent: outer.userAgent,
            requestId: outer.requestId,
            device: outer.actor.devicePrincipal
              ? { id: outer.actor.devicePrincipal.id, kind: outer.actor.devicePrincipal.kind }
              : null,
          },
          inner.audit,
        );
        return value;
      });
    });
    // Sudah commit: kait dijalankan di konteks luar, galatnya tidak membatalkan apa pun (sama seperti interceptor).
    await runAfterCommitHooks(afterCommit, (m) => this.logger.error(m));
    return result;
  }
}
