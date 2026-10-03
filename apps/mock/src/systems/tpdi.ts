import { randomUUID } from 'node:crypto';
import { tpdiSignature } from '@simrs/shared/node';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { MockConfig } from '../config';
import type { MockState, TpdiInvoice } from '../state';

const createInvoiceSchema = z.object({
  external_ref: z.string().min(1),
  channel: z.enum(['va_btn', 'qris']),
  amount: z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]),
  expires_in_minutes: z.number().int().positive().optional(),
});

export type TpdiEvent = 'payment.paid' | 'payment.expired' | 'payment.failed' | 'refund.completed';

function publicInvoice(inv: TpdiInvoice) {
  return {
    invoice_id: inv.id,
    merchant_id: inv.merchantId,
    external_ref: inv.externalRef,
    channel: inv.channel,
    amount: Number(inv.amount),
    status: inv.status,
    va_number: inv.vaNumber ?? null,
    qr_payload: inv.qrPayload ?? null,
    expires_at: inv.expiresAt,
    paid_at: inv.paidAt ?? null,
    bank_ref: inv.bankRef ?? null,
  };
}

/** Kirim webhook bertanda tangan HMAC ke SIM RS (docs/07 §2). Dipakai panel. */
export async function deliverTpdiWebhook(
  config: MockConfig,
  inv: TpdiInvoice,
  event: TpdiEvent,
  opts: { eventId?: string } = {},
): Promise<{ eventId: string; status: number | 'error' }> {
  const eventId = opts.eventId ?? randomUUID();
  const timestamp = String(Math.floor(config.now().getTime() / 1000));
  const body = JSON.stringify({
    event,
    merchant_id: inv.merchantId,
    invoice_id: inv.id,
    external_ref: inv.externalRef,
    channel: inv.channel,
    amount: Number(inv.amount),
    paid_at: inv.paidAt ?? null,
    bank_ref: inv.bankRef ?? null,
  });
  const res = await config.sendWebhook(
    config.tpdi.webhookTarget,
    {
      'content-type': 'application/json',
      'X-TPDI-Event-Id': eventId,
      'X-TPDI-Timestamp': timestamp,
      'X-TPDI-Signature': tpdiSignature(timestamp, body, config.tpdi.webhookSecret),
    },
    body,
  );
  inv.webhookDeliveries.unshift({ at: config.now().toISOString(), event, status: res.status, eventId });
  return { eventId, status: res.status };
}

/** Mock TPDI: agregator teknologi; dana tidak transit di TPDI (ADR-0005). */
export function registerTpdi(app: FastifyInstance, config: MockConfig, state: MockState): void {
  app.addHook('preHandler', async (req, reply) => {
    if (!req.url.startsWith('/tpdi/v1/')) return;
    if (req.headers['x-api-key'] !== config.tpdi.apiKey) {
      return reply.code(401).send({ code: 'UNAUTHENTICATED', message: 'X-API-Key tidak valid' });
    }
  });

  app.post('/tpdi/v1/invoices', async (req, reply) => {
    const key = req.headers['idempotency-key'];
    if (typeof key !== 'string' || !key) {
      return reply.code(400).send({ code: 'VALIDATION_FAILED', message: 'Header Idempotency-Key wajib' });
    }
    const existingId = state.invoiceByIdempotency.get(key);
    const existing = existingId ? state.invoices.get(existingId) : undefined;
    if (existing) return reply.code(200).send(publicInvoice(existing));

    const parsed = createInvoiceSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ code: 'VALIDATION_FAILED', message: 'Body tidak valid', details: parsed.error.issues });
    }
    const b = parsed.data;
    const seq = state.nextSeq();
    const minutes = b.expires_in_minutes ?? (b.channel === 'qris' ? 10 : 24 * 60);
    const inv: TpdiInvoice = {
      id: `TPDI-INV-${String(seq).padStart(6, '0')}`,
      merchantId: config.tpdi.merchantId,
      externalRef: b.external_ref,
      channel: b.channel,
      amount: String(b.amount),
      status: 'pending',
      vaNumber: b.channel === 'va_btn' ? `88080127${String(seq).padStart(8, '0')}` : undefined,
      qrPayload: b.channel === 'qris' ? `00020101021226MOCKQRIS${String(seq).padStart(6, '0')}` : undefined,
      expiresAt: new Date(config.now().getTime() + minutes * 60_000).toISOString(),
      idempotencyKey: key,
      webhookDeliveries: [],
    };
    state.invoices.set(inv.id, inv);
    state.invoiceByIdempotency.set(key, inv.id);
    return reply.code(201).send(publicInvoice(inv));
  });

  app.get<{ Params: { id: string } }>('/tpdi/v1/invoices/:id', async (req, reply) => {
    const inv = state.invoices.get(req.params.id);
    if (!inv) return reply.code(404).send({ code: 'NOT_FOUND', message: 'Invoice tidak ditemukan' });
    return publicInvoice(inv);
  });

  app.get<{ Querystring: { date?: string } }>('/tpdi/v1/reports/transactions', async (req) => {
    const date = req.query.date;
    const rows = [...state.invoices.values()].filter(
      (i) => i.status === 'paid' && (!date || i.paidAt?.startsWith(date)),
    );
    return { date: date ?? null, count: rows.length, transactions: rows.map(publicInvoice) };
  });

  app.post('/tpdi/v1/refunds', async (_req, reply) =>
    reply.code(202).send({ status: 'accepted', refund_id: randomUUID() }),
  );
}
