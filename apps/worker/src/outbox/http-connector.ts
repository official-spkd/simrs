import { Inject, Injectable } from '@nestjs/common';
import type { AttemptResult } from '@simrs/db';
import { WORKER_ENV, type WorkerEnv } from '../config/env';
import type { HttpRequestSpec, OutboxMessageLike } from './operation-types';

/** Kode yang layak dicoba ulang; 4xx lain dianggap permanen (data salah) → langsung DLQ. */
const RETRYABLE = new Set([408, 425, 429]);

/** Badan respons yang dibaca untuk diproses operasi (cukup untuk JSON integrasi; mencegah memori membengkak). */
const MAX_RESPONSE_BYTES = 64 * 1024;

export function classifyStatus(status: number): Pick<AttemptResult, 'ok' | 'permanent'> {
  if (status >= 200 && status < 300) return { ok: true };
  if (status >= 500 || RETRYABLE.has(status)) return { ok: false, permanent: false };
  return { ok: false, permanent: true };
}

/** Hasil kirim: yang dicatat di `delivery_attempts` + badan respons untuk diproses (tidak disimpan). */
export type SendResult = AttemptResult & { responseBody?: string };

/**
 * Pengirim HTTP generik untuk pesan outbox. Permintaan disiapkan operasi (`operations.ts`).
 * Tujuan selalu base URL dari konfigurasi (bukan dari isi pesan), sehingga pesan tidak bisa mengarahkan
 * worker ke host lain (SSRF). Konektor nyata per sistem menyusul di fase 2–7 (docs/06 §1).
 */
@Injectable()
export class HttpConnector {
  constructor(@Inject(WORKER_ENV) private readonly env: WorkerEnv) {}

  async send(
    msg: OutboxMessageLike,
    spec: HttpRequestSpec,
    opts: { sensitive?: boolean } = {},
  ): Promise<SendResult> {
    const base = new URL(this.env.MOCK_BASE_URL);
    const url = new URL(spec.path, base);
    if (url.origin !== base.origin) {
      return { ok: false, permanent: true, durationMs: 0, error: 'Path operasi keluar dari host tujuan' };
    }

    const start = performance.now();
    const elapsed = () => Math.round(performance.now() - start);
    try {
      const res = await fetch(url, {
        method: spec.method,
        headers: { 'content-type': 'application/json', 'Idempotency-Key': msg.idempotencyKey },
        body: spec.body === undefined ? undefined : JSON.stringify(spec.body),
        redirect: 'manual',
        signal: AbortSignal.timeout(this.env.OUTBOX_HTTP_TIMEOUT_MS),
      });
      const text = (await res.text().catch(() => '')).slice(0, MAX_RESPONSE_BYTES);
      const c = classifyStatus(res.status);
      return {
        ...c,
        statusCode: res.status,
        durationMs: elapsed(),
        // Respons berisi data pribadi tidak disimpan di jejak pengiriman.
        responseExcerpt: opts.sensitive ? undefined : text.slice(0, 300),
        responseBody: text,
        error: c.ok ? undefined : `HTTP ${res.status}`,
      };
    } catch (err) {
      const name = err instanceof Error ? err.name : 'Error';
      return {
        ok: false,
        permanent: false,
        durationMs: elapsed(),
        error: name === 'TimeoutError' ? 'timeout' : `jaringan: ${name}`,
      };
    }
  }
}
