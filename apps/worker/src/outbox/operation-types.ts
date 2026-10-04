import type { OutboxMessage, TenantTx } from '@simrs/db';
import type { PatientCrypto } from '@simrs/shared/node';

/** Tipe bersama operasi outbox (dipisah dari peta operasi agar tidak ada impor melingkar). */

export type OutboxMessageLike = Pick<OutboxMessage, 'target' | 'operation' | 'idempotencyKey' | 'payload'>;

export interface HttpRequestSpec {
  method: 'POST' | 'PUT' | 'GET';
  /** Path relatif terhadap base URL sistem tujuan (lokal: MOCK_BASE_URL). */
  path: string;
  body?: unknown;
}

/** Konteks saat menyiapkan permintaan: baca data tenant (transaksi pendek tersendiri) dan kripto identitasnya. */
export interface OperationContext {
  tenantId: string;
  read<T>(fn: (tx: TenantTx) => Promise<T>): Promise<T>;
  crypto: PatientCrypto;
  /** No. HP staf (`users.phone_enc`) → bentuk baku `62…`. */
  decryptStaffPhone(stored: string): string;
  /** Alamat web untuk tautan di pesan (email/WhatsApp). */
  webBaseUrl: string;
}

/** `skip`: pesan tidak perlu dikirim lagi (mis. NIK sudah diganti); dicatat terkirim tanpa memanggil target. */
export type PreparedRequest = HttpRequestSpec | { skip: string };

/** Galat yang tidak akan sembuh dengan mencoba ulang (mis. isi pesan rusak): langsung DLQ. */
export class PermanentOperationError extends Error {
  override name = 'PermanentOperationError';
}

export interface OutboxOperation {
  /**
   * Bangun permintaan HTTP. Boleh membaca DB tenant lewat `ctx.read` (mis. mendekripsi NIK): payload pesan
   * cukup berisi ID, sehingga data pribadi tidak tersimpan di outbox. Dipanggil di luar transaksi pencatatan.
   */
  prepare(msg: OutboxMessageLike, ctx: OperationContext): PreparedRequest | Promise<PreparedRequest>;
  /** Respons memuat data pribadi: potongannya tidak disimpan di `delivery_attempts`. */
  sensitive?: boolean;
  /**
   * Proses respons sukses di transaksi yang SAMA dengan pencatatan percobaan (atomik). Melempar = percobaan
   * dicatat gagal permanen (DLQ) dan perubahan dari handler ini dibatalkan.
   */
  onSuccess?(tx: TenantTx, msg: OutboxMessage, responseBody: string): Promise<void>;
}
