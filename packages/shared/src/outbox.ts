import { z } from 'zod';

export const INTEGRATION_TARGETS = [
  'bpjs',
  'eklaim',
  'satusehat',
  'dukcapil',
  'tte',
  'tpdi',
  'btn',
  'email',
  'whatsapp',
] as const;
export type IntegrationTarget = (typeof INTEGRATION_TARGETS)[number];

export const OUTBOX_STATUSES = ['pending', 'processing', 'sent', 'failed', 'dead'] as const;
export type OutboxStatus = (typeof OUTBOX_STATUSES)[number];

/** Maks percobaan sebelum DLQ (ADR-0003). */
export const OUTBOX_MAX_ATTEMPTS = 8;

/** Backoff eksponensial dengan jitter: setengah tetap + setengah acak dari dasar × 2^(n−1), dibatasi `capMs`. */
export function backoffDelayMs(
  attempt: number,
  baseMs = 1000,
  capMs = 5 * 60_000,
  random = Math.random,
): number {
  const exp = Math.min(capMs, baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.round(exp / 2 + random() * (exp / 2));
}

export const outboxEnvelopeSchema = z.object({
  target: z.enum(INTEGRATION_TARGETS),
  operation: z.string().min(1),
  idempotencyKey: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
});
export type OutboxEnvelope = z.infer<typeof outboxEnvelopeSchema>;
