import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { MockConfig } from '../config';
import type { MockState } from '../state';

/**
 * Mock BTN: mutasi rekening (dari invoice TPDI yang lunas) dan kerangka pembiayaan.
 * Alur lengkap pembiayaan dibangun di fase 6 (docs/07 §4–5).
 */
export function registerBtn(app: FastifyInstance, config: MockConfig, state: MockState): void {
  app.get<{ Params: { no: string }; Querystring: { date?: string } }>(
    '/btn/v1/accounts/:no/statements',
    async (req) => {
      const date = req.query.date;
      const lines = [...state.invoices.values()]
        .filter((i) => i.status === 'paid' && (!date || i.paidAt?.startsWith(date)))
        .map((i) => ({
          bank_ref: i.bankRef,
          posted_at: i.paidAt,
          direction: 'credit',
          amount: Number(i.amount),
          description: `${i.channel === 'qris' ? 'QRIS' : 'VA'} ${i.vaNumber ?? i.id} ${i.externalRef}`,
        }));
      return { account_no: req.params.no, date: date ?? null, lines };
    },
  );

  app.post('/btn/v1/financing/patient-applications', async (_req, reply) =>
    reply.code(201).send({
      application_id: randomUUID(),
      status: 'verifikasi_btn',
      received_at: config.now().toISOString(),
    }),
  );

  app.post('/btn/v1/financing/receivables/drawdowns', async (_req, reply) =>
    reply
      .code(201)
      .send({ drawdown_id: randomUUID(), status: 'diajukan', received_at: config.now().toISOString() }),
  );
}
