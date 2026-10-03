import type { FastifyInstance } from 'fastify';
import { fakePerson, isNik } from '../fixtures';

/** Mock verifikasi NIK Dukcapil (P05). NIK berakhiran 9999 dianggap tidak ditemukan. */
export function registerDukcapil(app: FastifyInstance): void {
  app.post<{ Body: { nik?: string } }>('/dukcapil/verify', async (req, reply) => {
    const nik = req.body?.nik ?? '';
    if (!isNik(nik))
      return reply.code(400).send({ code: 'VALIDATION_FAILED', message: 'NIK harus 16 digit' });
    if (nik.endsWith('9999')) return { found: false };
    return { found: true, person: fakePerson(nik) };
  });
}
