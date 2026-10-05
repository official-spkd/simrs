import type { TenantTx } from '@simrs/db';
import type { ComponentCode } from '@simrs/shared';

/**
 * Jadwal job berkala (P11):
 * - `everyMs`: tiap selang waktu (mis. tandai no-show tiap 5 menit);
 * - `dailyAt`: sekali sehari pada jam WIB `HH:MM` (mis. bangkitkan sesi jadwal pukul 01:00).
 */
export type PeriodicSchedule = { everyMs: number } | { dailyAt: string };

export interface PeriodicJobContext {
  tenantId: string;
  /** Saat jadwal jatuh; sama untuk semua tenant dalam satu putaran. Pakai ini, bukan `new Date()`. */
  now: Date;
  /** Transaksi ber-RLS untuk tenant ini (boleh dipanggil berkali-kali; job besar sebaiknya dipotong per batch). */
  tx<T>(fn: (tx: TenantTx) => Promise<T>): Promise<T>;
}

/**
 * Job berkala per tenant. Dijalankan sekali per tenant aktif setiap jadwal jatuh, berurutan, satu job pada satu
 * waktu. WAJIB idempoten: jadwal bisa terlewat (worker mati) atau terulang (worker restart). Efek ke sistem luar
 * lewat outbox (`enqueueOutbox` di transaksi yang sama), tidak pernah dipanggil langsung.
 */
export interface PeriodicJob {
  schedule: PeriodicSchedule;
  /** Hanya tenant yang modul ini aktif (`tenant_modules`); tanpa ini semua tenant aktif. */
  module?: ComponentCode;
  run(ctx: PeriodicJobContext): Promise<void>;
}

export interface PeriodicRunSummary {
  job: string;
  tenants: number;
  ok: number;
  skipped: number;
  failed: number;
}
