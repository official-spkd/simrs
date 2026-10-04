import type { OutboxMessage, TenantTx } from '@simrs/db';
import type { BpjsRequest, PatientCrypto } from '@simrs/shared/node';

/** Tipe bersama operasi outbox (dipisah dari peta operasi agar tidak ada impor melingkar). */

export type OutboxMessageLike = Pick<OutboxMessage, 'target' | 'operation' | 'idempotencyKey' | 'payload'>;

export interface HttpRequestSpec {
  method: 'POST' | 'PUT' | 'GET';
  /** Path relatif terhadap base URL sistem tujuan (lokal: MOCK_BASE_URL). */
  path: string;
  body?: unknown;
}

/** Permintaan ke BPJS lewat `BpjsConnector` (tanda tangan + dekripsi). Bangun lewat `defineBpjsOperation`. */
export interface BpjsRequestSpec {
  bpjs: BpjsRequest;
}

/** Konteks saat menyiapkan permintaan: baca data tenant (transaksi pendek tersendiri) dan kripto identitasnya. */
export interface OperationContext {
  tenantId: string;
  read<T>(fn: (tx: TenantTx) => Promise<T>): Promise<T>;
  crypto: PatientCrypto;
  /** No. HP staf (`users.phone_enc`) → bentuk baku `62…`. */
  decryptStaffPhone(stored: string): string;
  /** Kode cadangan login (`login_challenges.otp_enc`) → 6 digit. */
  decryptLoginOtp(stored: string): string;
  /** Alamat web untuk tautan di pesan (email/WhatsApp). */
  webBaseUrl: string;
  /**
   * Pesan outbox lain milik tenant ini menurut kuncinya (mis. task ID sebelumnya untuk `defer.afterMessageId`).
   * `null` bila belum pernah diantrekan.
   */
  findMessage(key: {
    target: string;
    idempotencyKey: string;
  }): Promise<Pick<OutboxMessage, 'id' | 'status'> | null>;
}

/**
 * Tunda tanpa menghabiskan percobaan:
 * - `untilMs`: jatuh tempo lagi pada waktu ini (epoch milidetik);
 * - `afterMessageId`: tunggu pesan outbox lain (tenant sama) terkirim, mis. task ID 2 menunggu task 1. Bila pesan
 *   itu masuk DLQ atau tidak ada, pesan ini ikut DLQ (urutan tidak bisa dipenuhi).
 */
export type OutboxDefer = ({ untilMs: number } | { afterMessageId: string }) & {
  /** Alasan singkat tanpa PHI; tampil di `last_error` sebagai `ditunda: …`. */
  reason?: string;
};

/**
 * Hasil `prepare`:
 * - permintaan HTTP biasa (`HttpConnector`) atau `{ bpjs }` (`BpjsConnector`);
 * - `skip`: pesan tidak perlu dikirim lagi (mis. NIK sudah diganti); dicatat terkirim tanpa memanggil target;
 * - `defer`: belum waktunya dikirim (lihat `OutboxDefer`).
 */
export type PreparedRequest = HttpRequestSpec | BpjsRequestSpec | { skip: string } | { defer: OutboxDefer };

/** Galat yang tidak akan sembuh dengan mencoba ulang (mis. isi pesan rusak): langsung DLQ. */
export class PermanentOperationError extends Error {
  override name = 'PermanentOperationError';
}

/**
 * Kebijakan coba ulang per operasi. Tanpa kebijakan: 8 percobaan dengan jeda maks. 5 menit (ADR-0003), lalu DLQ.
 * `untilEndOfServiceDay`: dicoba sampai akhir hari layanan WIB dari saat pesan dibuat (00.00 WIB berikutnya),
 * lalu DLQ + kirim ulang manual (keputusan fase 2 #13, dipakai SEP dan task ID BPJS). Bila diisi bersama
 * `maxAttempts`, yang tercapai lebih dulu berlaku; tanpa `maxAttempts` hanya batas waktu yang berlaku.
 */
export interface RetryPolicy {
  maxAttempts?: number;
  /** Batas atas jeda backoff eksponensial (ms). */
  capMs?: number;
  untilEndOfServiceDay?: boolean;
}

export interface OutboxOperation {
  /**
   * Bangun permintaan HTTP. Boleh membaca DB tenant lewat `ctx.read` (mis. mendekripsi NIK): payload pesan
   * cukup berisi ID, sehingga data pribadi tidak tersimpan di outbox. Dipanggil di luar transaksi pencatatan.
   */
  prepare(msg: OutboxMessageLike, ctx: OperationContext): PreparedRequest | Promise<PreparedRequest>;
  /** Respons memuat data pribadi: potongannya tidak disimpan di `delivery_attempts`. */
  sensitive?: boolean;
  retry?: RetryPolicy;
  /**
   * Proses respons sukses di transaksi yang SAMA dengan pencatatan percobaan (atomik). Melempar = percobaan
   * dicatat gagal permanen (DLQ) dan perubahan dari handler ini dibatalkan.
   */
  onSuccess?(tx: TenantTx, msg: OutboxMessage, responseBody: string): Promise<void>;
  /**
   * Pesan masuk DLQ: tandai status domain (mis. SEP/tanda tangan "gagal") di transaksi yang SAMA dengan perpindahan
   * ke DLQ. `msg` sudah berstatus `dead` dengan `lastError`. Melempar = perubahan handler dibatalkan, pesan tetap
   * DLQ dan `lastError` diberi catatan `onDead gagal`.
   */
  onDead?(tx: TenantTx, msg: OutboxMessage): Promise<void>;
}
