import type { PrismaClient } from '@simrs/db';

/** Konteks global setup untuk perangkat uji. */
export interface TestDeviceContext {
  /** Klien migrator ke DB tes (tanpa RLS), sama dengan global setup. */
  prisma: PrismaClient;
  /** Tenant RS uji (RSFA). */
  tenantId: string;
  /** Folder sementara slot E2E (`E2E_TMP_NAME`), tempat berkas rahasia uji seperti kredensial akun presentasi. */
  tmpDir: string;
}

/**
 * Titik perluasan global setup: mendaftarkan perangkat uji (anjungan, TV display) untuk E2E fase 2.
 *
 * Sengaja belum melakukan apa pun sampai prinsipal perangkat (ADR-0027, potongan 1b) tergabung. Setelah itu fungsi
 * ini mendaftarkan satu anjungan dan satu display per unit uji di `registered_devices` (tabel yang sama dengan PIN
 * 10c-2) secara idempoten, lalu menulis token/rahasia perangkat ke `tmpDir` (mode 0600, seperti
 * `DEMO_ACCOUNTS_FILE`) agar spesifikasi anjungan/display bisa membukanya sebagai perangkat, bukan akun staf.
 */
export function registerTestDevices(_ctx: TestDeviceContext): Promise<void> {
  return Promise.resolve();
}
