import { randomUUID } from 'node:crypto';
import { mailSendSchema, whatsappSendSchema } from '@simrs/shared';
import type { FastifyInstance } from 'fastify';
import type { MockConfig } from '../config';
import type { MockState } from '../state';

/**
 * Mock pengirim email dan WhatsApp (P09 notifikasi, P02 kode cadangan). Pesan tidak dikirim ke mana pun: disimpan di
 * kotak masuk mock (`GET /messages`, juga tampil di panel) agar bisa diperiksa saat pengembangan dan tes.
 */
export function registerMessaging(app: FastifyInstance, config: MockConfig, state: MockState): void {
  app.post('/email/send', async (req, reply) => {
    const parsed = mailSendSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: 'VALIDATION_FAILED', message: 'Permintaan email tidak valid' });
    }
    const id = randomUUID();
    state.deliver({ id, channel: 'email', ...parsed.data, at: config.now().toISOString() });
    return { messageId: id };
  });

  app.post('/whatsapp/send', async (req, reply) => {
    const parsed = whatsappSendSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: 'VALIDATION_FAILED', message: 'Permintaan WhatsApp tidak valid' });
    }
    const id = randomUUID();
    state.deliver({ id, channel: 'whatsapp', ...parsed.data, at: config.now().toISOString() });
    return { messageId: id };
  });

  /** Kotak masuk mock (terbaru di depan); `?to=` menyaring per tujuan. */
  app.get<{ Querystring: { to?: string } }>('/messages', async (req) => {
    const to = req.query.to;
    return { items: to ? state.messages.filter((m) => m.to === to) : state.messages };
  });
}
