import { Inject, Injectable } from '@nestjs/common';
import type { AttemptResult } from '@simrs/db';
import { WORKER_ENV, type WorkerEnv } from '../config/env';
import { OUTBOX_OPERATIONS, type OutboxMessageLike } from './operations';

/** Kode yang layak dicoba ulang; 4xx lain dianggap permanen (data salah) → langsung DLQ. */
const RETRYABLE = new Set([408, 425, 429]);

export function classifyStatus(status: number): Pick<AttemptResult, 'ok' | 'permanent'> {
  if (status >= 200 && status < 300) return { ok: true };
  if (status >= 500 || RETRYABLE.has(status)) return { ok: false, permanent: false };
  return { ok: false, permanent: true };
}

/**
 * Pengirim HTTP generik untuk pesan outbox. Operasi dipetakan ke permintaan HTTP di `operations.ts`.
 * Tujuan selalu base URL dari konfigurasi (bukan dari isi pesan), sehingga pesan tidak bisa mengarahkan
 * worker ke host lain (SSRF). Konektor nyata per sistem menyusul di fase 2–7 (docs/06 §1).
 */
@Injectable()
export class HttpConnector {
  constructor(@Inject(WORKER_ENV) private readonly env: WorkerEnv) {}

  async send(msg: OutboxMessageLike): Promise<AttemptResult> {
    const build = OUTBOX_OPERATIONS.get(msg.operation);
    if (!build) {
      return { ok: false, permanent: true, durationMs: 0, error: `Operasi belum didukung: ${msg.operation}` };
    }
    const spec = build(msg);
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
