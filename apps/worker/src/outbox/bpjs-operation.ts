import type { OutboxMessage, TenantTx } from '@simrs/db';
import type { BpjsRejectionCode } from '@simrs/shared';
import type { BpjsRequest } from '@simrs/shared/node';
import type { z } from 'zod';
import { bpjsDeliverySchema } from './bpjs-connector';
import {
  type OperationContext,
  type OutboxDefer,
  type OutboxMessageLike,
  type OutboxOperation,
  PermanentOperationError,
  type RetryPolicy,
} from './operation-types';
import { SERVICE_DAY_RETRY } from './retry-policy';

/** Penolakan bisnis BPJS (HTTP 200 + `metaData.code` ≠ 200), sudah dipetakan ke kode internal stabil. */
export interface BpjsRejection {
  code: BpjsRejectionCode;
  /** Kode asli BPJS (biasanya `201`). */
  bpjsCode: string;
  /** Pesan asli BPJS; bisa menyebut data peserta, jangan ditulis ke log. */
  message: string;
}

export type BpjsPrepared = BpjsRequest | { skip: string } | { defer: OutboxDefer };

export interface BpjsOperationDefinition<R> {
  /** Payload pesan hanya ID; data dibaca lewat `ctx.read` (ADR-0017). Path relatif terhadap layanan. */
  prepare(msg: OutboxMessageLike, ctx: OperationContext): BpjsPrepared | Promise<BpjsPrepared>;
  /**
   * Skema kontrak isi `response` dari `@simrs/shared` (mis. `vclaimSepInsertResponseSchema`,
   * `antreanListTaskResponseSchema`), divalidasi `BpjsClient` setelah dekripsi; tidak cocok = `BPJS_PROTOCOL` (DLQ).
   * Tanpa skema: VClaim diterima apa adanya (`unknown`), Antrean/Aplicare tanpa isi (`undefined`).
   */
  response?: z.ZodType<R>;
  /** Sukses, di transaksi yang sama dengan pencatatan terkirim. */
  onAccepted?(tx: TenantTx, msg: OutboxMessage, response: R): Promise<void>;
  /**
   * Ditolak BPJS: catat status domain "ditolak" + kodenya (mis. SEP `rejected`, `BPJS_SEP_GANDA`). Pesan tetap
   * terkirim (bukan retry/DLQ). Tanpa handler ini penolakan dianggap galat permanen (DLQ) agar tidak hilang diam-diam.
   */
  onRejected?(tx: TenantTx, msg: OutboxMessage, rejection: BpjsRejection): Promise<void>;
  onDead?(tx: TenantTx, msg: OutboxMessage): Promise<void>;
  /** Bawaan `SERVICE_DAY_RETRY` (sampai akhir hari layanan WIB, keputusan fase 2 #13). */
  retry?: RetryPolicy;
  /** Bawaan `true`: respons BPJS umumnya memuat data peserta. */
  sensitive?: boolean;
}

/**
 * Bangun operasi outbox BPJS: permintaan dikirim `BpjsConnector` (tanda tangan + dekripsi + pemetaan `metaData`),
 * hasilnya dibagi ke `onAccepted`/`onRejected` secara atomik. Daftarkan hasilnya di `OUTBOX_OPERATIONS`.
 */
export function defineBpjsOperation<R = unknown>(def: BpjsOperationDefinition<R>): OutboxOperation {
  return {
    sensitive: def.sensitive ?? true,
    retry: def.retry ?? SERVICE_DAY_RETRY,
    onDead: def.onDead,
    async prepare(msg, ctx) {
      const p = await def.prepare(msg, ctx);
      return 'skip' in p || 'defer' in p ? p : { bpjs: p, schema: def.response ?? null };
    },
    async onSuccess(tx, msg, responseBody) {
      let json: unknown;
      try {
        json = JSON.parse(responseBody);
      } catch {
        throw new PermanentOperationError('Hasil BPJS tidak dikenali');
      }
      const delivery = bpjsDeliverySchema.safeParse(json);
      if (!delivery.success) throw new PermanentOperationError('Hasil BPJS tidak dikenali');
      const d = delivery.data;
      if (d.outcome === 'rejected') {
        if (!def.onRejected) throw new PermanentOperationError(`Ditolak BPJS ${d.bpjsCode}: ${d.code}`);
        await def.onRejected(tx, msg, { code: d.code, bpjsCode: d.bpjsCode, message: d.message });
        return;
      }
      // Sudah divalidasi dengan `def.response` di klien sebelum dicatat terkirim.
      const response = d.response as R;
      await def.onAccepted?.(tx, msg, response);
    },
  };
}
