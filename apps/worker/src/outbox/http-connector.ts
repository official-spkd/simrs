import { Inject, Injectable } from '@nestjs/common';
import type { AttemptResult, OutboxMessage } from '@simrs/db';
import { WORKER_ENV, type WorkerEnv } from '../config/env';

/** Kode yang layak dicoba ulang; 4xx lain dianggap permanen (data salah) → langsung DLQ. */
const RETRYABLE = new Set([408, 425, 429]);

export function classifyStatus(status: number): Pick<AttemptResult, 'ok' | 'permanent'> {
  if (status >= 200 && status < 300) return { ok: true };
  if (status >= 500 || RETRYABLE.has(status)) return { ok: false, permanent: false };
  return { ok: false, permanent: true };
}

/**
 * Pengirim HTTP generik untuk pesan outbox. Fase 0 hanya mengenal operasi `ping` (ke `/<target>/_echo` di mock).
 * Konektor per sistem (BPJS, SATUSEHAT, …) menggantikan pemetaan ini di fase 2–7 (docs/06 §1).
 */
@Injectable()
export class HttpConnector {
  constructor(@Inject(WORKER_ENV) private readonly env: WorkerEnv) {}

  async send(
    msg: Pick<OutboxMessage, 'target' | 'operation' | 'idempotencyKey' | 'payload'>,
  ): Promise<AttemptResult> {
    const start = performance.now();
    const elapsed = () => Math.round(performance.now() - start);
    if (msg.operation !== 'ping') {
      return { ok: false, permanent: true, durationMs: 0, error: `Operasi belum didukung: ${msg.operation}` };
    }
    const url = new URL(`/${msg.target}/_echo`, this.env.MOCK_BASE_URL);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'Idempotency-Key': msg.idempotencyKey },
        body: JSON.stringify({ operation: msg.operation, payload: msg.payload }),
        signal: AbortSignal.timeout(this.env.OUTBOX_HTTP_TIMEOUT_MS),
      });
      const text = await res.text().catch(() => '');
      const c = classifyStatus(res.status);
      return {
        ...c,
        statusCode: res.status,
        durationMs: elapsed(),
        responseExcerpt: text.slice(0, 300),
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
