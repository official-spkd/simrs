import { Inject, Injectable } from '@nestjs/common';
import { BPJS_REJECTION_CODES } from '@simrs/shared';
import { BpjsClient, bpjsClientConfig, type BpjsRequest } from '@simrs/shared/node';
import { z } from 'zod';
import { WORKER_ENV, type WorkerEnv } from '../config/env';
import type { SendResult } from './http-connector';
import type { OutboxMessageLike } from './operation-types';

/**
 * Badan yang diteruskan `BpjsConnector` ke `onSuccess` operasi BPJS (dibaca `defineBpjsOperation`). Tidak pernah
 * disimpan: `response` sudah didekripsi dan bisa memuat data peserta.
 */
export const bpjsDeliverySchema = z.discriminatedUnion('outcome', [
  z.object({
    outcome: z.literal('accepted'),
    bpjsCode: z.string(),
    message: z.string(),
    response: z.unknown(),
  }),
  z.object({
    outcome: z.literal('rejected'),
    code: z.enum(BPJS_REJECTION_CODES),
    bpjsCode: z.string(),
    message: z.string(),
  }),
]);
export type BpjsDelivery = z.infer<typeof bpjsDeliverySchema>;

/**
 * Pengirim outbox ke BPJS: membungkus `BpjsClient` (`@simrs/shared/node`, juga dipakai API untuk lookup sinkron).
 * Pemetaan ke hasil percobaan outbox:
 * - `metaData` sukses → terkirim, respons terdekripsi diteruskan ke operasi;
 * - galat bisnis (HTTP 200 + kode ≠ 200) → TERKIRIM juga: jawaban BPJS sudah pasti, operasi mencatatnya sebagai
 *   hasil domain "ditolak" (bukan retry/DLQ);
 * - gangguan → gagal: `BPJS_UNAVAILABLE` dicoba ulang, `BPJS_AUTH`/`BPJS_PROTOCOL` langsung DLQ.
 * Kredensial dan base URL dari env (satu set mock di fase 2, keputusan #11), bukan dari isi pesan.
 */
@Injectable()
export class BpjsConnector {
  private readonly client?: BpjsClient;

  constructor(@Inject(WORKER_ENV) env: WorkerEnv) {
    const config = bpjsClientConfig(env, { timeoutMs: env.OUTBOX_HTTP_TIMEOUT_MS });
    this.client = config ? new BpjsClient(config) : undefined;
  }

  async send(
    msg: OutboxMessageLike,
    req: BpjsRequest,
    opts: { sensitive?: boolean } = {},
  ): Promise<SendResult> {
    if (!this.client) {
      return {
        ok: false,
        permanent: true,
        durationMs: 0,
        error: 'BPJS_AUTH: kredensial BPJS belum dikonfigurasi',
      };
    }
    const res = await this.client.request({
      ...req,
      headers: { ...req.headers, 'Idempotency-Key': msg.idempotencyKey },
    });
    const timing = { statusCode: res.httpStatus, durationMs: res.durationMs };
    // Pesan BPJS bisa menyebut data peserta: untuk operasi sensitif hanya kodenya yang masuk jejak pengiriman.
    const note = (message: string) => (opts.sensitive || !message ? '' : `: ${message}`);
    switch (res.kind) {
      case 'ok': {
        const body: BpjsDelivery = {
          outcome: 'accepted',
          bpjsCode: res.bpjsCode,
          message: res.message,
          response: res.response,
        };
        return {
          ...timing,
          ok: true,
          responseExcerpt: `BPJS ${res.bpjsCode}${note(res.message)}`,
          responseBody: JSON.stringify(body),
        };
      }
      case 'rejected': {
        const body: BpjsDelivery = {
          outcome: 'rejected',
          code: res.code,
          bpjsCode: res.bpjsCode,
          message: res.message,
        };
        return {
          ...timing,
          ok: true,
          responseExcerpt: `ditolak BPJS ${res.bpjsCode} → ${res.code}${note(res.message)}`,
          responseBody: JSON.stringify(body),
        };
      }
      case 'failure':
        return { ...timing, ok: false, permanent: !res.retryable, error: `${res.code}: ${res.detail}` };
    }
  }
}
