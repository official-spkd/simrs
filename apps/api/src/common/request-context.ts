import { AsyncLocalStorage } from 'node:async_hooks';
import type { TenantTx } from '@simrs/db';
import type { AuditAction, AuditOutcome, DevicePrincipalKind, PermissionScope } from '@simrs/shared';

/** Satu entri audit yang akan ditulis di akhir transaksi permintaan. Tanpa PHI di `details`. */
export interface PendingAudit {
  action: AuditAction;
  resourceType: string;
  resourceId?: string | null;
  patientId?: string | null;
  reason?: string | null;
  outcome?: AuditOutcome;
  details?: Record<string, unknown>;
}

/** Peran pelaku pada mode header pengembang (APP_ENV=local saja): melewati matriks izin. */
export const DEV_ROLE = 'dev';

export interface RequestActor {
  userId: string | null;
  /** Kode peran dari penugasan aktif sesi; `DEV_ROLE` untuk mode header pengembang. */
  role: string | null;
  sessionId: string | null;
  /** Unit kerja yang dipilih saat login (diisi P03/layar Login). */
  unitId: string | null;
  /** Sesi masuk cepat dengan PIN (ADR-0024): perangkat ber-PIN yang dipakai; posisi terkunci. */
  deviceId?: string | null;
  /**
   * Prinsipal perangkat (ADR-0027): anjungan/TV yang memanggil endpoint `@DeviceScoped()`. Tanpa pengguna dan peran;
   * hanya izin tetap jenisnya. `null`/kosong untuk pelaku manusia.
   */
  devicePrincipal?: DevicePrincipal | null;
}

/** Perangkat terdaftar yang sedang memanggil API (ADR-0027). */
export interface DevicePrincipal {
  id: string;
  kind: DevicePrincipalKind;
  /** Izin tetap jenis perangkat (`DEVICE_GRANTS` katalog izin), bukan matriks peran. */
  permissions: readonly string[];
}

/**
 * Konteks satu permintaan bertenant: transaksi database (RLS aktif), pelaku, metadata, dan antrean audit.
 * Dibuat oleh `TenantTransactionInterceptor`; dibaca repository lewat `TenantDb`.
 */
export interface TenantRequestContext {
  tenantId: string;
  /**
   * Transaksi permintaan. `null` pada handler `@NoRequestTransaction()` (lookup sinkron ADR-0025, SSE ADR-0026)
   * di luar transaksi pendek `TenantDb.transaction()`: di sana `TenantDb.tx()` menolak dengan galat program.
   */
  tx: TenantTx | null;
  actor: RequestActor;
  requestId: string | null;
  ip: string | null;
  userAgent: string | null;
  /** Lingkup izin yang diberikan untuk endpoint ini (P03), null bila endpoint tanpa @RequirePermission. */
  permissionScope: PermissionScope | null;
  audit: PendingAudit[];
  /**
   * Dijalankan interceptor setelah transaksi permintaan COMMIT (tidak dijalankan bila batal), mis. invalidasi
   * cache matriks izin. Tidak boleh mengubah data atau memanggil sistem eksternal (pakai outbox).
   * Handler `@NoRequestTransaction()`: setelah transaksi pendek `TenantDb.transaction()` yang mendaftarkannya commit,
   * atau setelah handler selesai bila didaftarkan di luar transaksi pendek.
   */
  afterCommit: Array<() => Promise<void> | void>;
}

export const requestContext = new AsyncLocalStorage<TenantRequestContext>();

/**
 * Jalankan kait `afterCommit` berurutan setelah transaksinya commit. Galat hanya dicatat (jenisnya saja, tanpa PHI):
 * data sudah tersimpan, jadi respons tetap sukses. Dipakai interceptor permintaan dan `TenantDb.transaction()`.
 */
export async function runAfterCommitHooks(
  hooks: TenantRequestContext['afterCommit'],
  logError: (message: string) => void,
): Promise<void> {
  for (const fn of hooks) {
    try {
      await fn();
    } catch (err) {
      logError(`Kait setelah commit gagal: ${err instanceof Error ? err.name : typeof err}`);
    }
  }
}
