import { Injectable } from '@nestjs/common';
import type { TenantTx } from '@simrs/db';
import { type PendingAudit, requestContext, type TenantRequestContext } from '../common/request-context';

/**
 * Akses database untuk repository: SELALU transaksi bertenant milik permintaan saat ini.
 * Dipanggil di luar permintaan bertenant (lupa `@TenantScoped()`) → galat program, bukan akses tanpa RLS.
 */
@Injectable()
export class TenantDb {
  private context(): TenantRequestContext {
    const ctx = requestContext.getStore();
    if (!ctx) {
      throw new Error('Akses data di luar transaksi tenant. Pasang @TenantScoped() pada controller.');
    }
    return ctx;
  }

  /** Transaksi aktif (RLS dengan app.tenant_id permintaan ini). */
  tx(): TenantTx {
    return this.context().tx;
  }

  tenantId(): string {
    return this.context().tenantId;
  }

  actorUserId(): string | null {
    return this.context().actor.userId;
  }

  /**
   * Tambah entri audit dari service (mis. satu entri per pasien yang tampil di hasil pencarian).
   * Ditulis di transaksi yang sama sebelum commit; bila gagal, seluruh permintaan dibatalkan.
   */
  audit(entry: PendingAudit): void {
    this.context().audit.push(entry);
  }
}
