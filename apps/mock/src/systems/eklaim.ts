import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';

/**
 * Mock E-Klaim (docs/06 §3). Fase 0: kerangka metode. Grouper memakai kode dan tarif **simulasi**
 * (awalan `SIM-`), bukan tabel INA-CBG resmi.
 */
const METHODS = [
  'new_claim',
  'set_claim_data',
  'grouper',
  'claim_final',
  'send_claim_individual',
  'get_claim_status',
];

export function registerEklaim(app: FastifyInstance): void {
  app.post<{ Body: { metadata?: { method?: string; stage?: string }; data?: Record<string, unknown> } }>(
    '/eklaim/ws.php',
    async (req, reply) => {
      const method = req.body?.metadata?.method;
      if (!method || !METHODS.includes(method)) {
        return reply
          .code(400)
          .send({ metadata: { code: 400, message: `Metode tidak dikenal: ${method ?? '-'}` } });
      }
      const nomorSep = req.body?.data?.nomor_sep ?? null;
      switch (method) {
        case 'new_claim':
          return {
            metadata: { code: 200, message: 'Ok' },
            response: { patient_id: randomUUID(), admission_id: randomUUID(), nomor_sep: nomorSep },
          };
        case 'grouper':
          return {
            metadata: { code: 200, message: 'Ok' },
            response: {
              cbg: {
                code: 'SIM-01-I',
                description: 'KODE SIMULASI (BUKAN INA-CBG RESMI)',
                tariff: '4250000',
              },
              special_cmg_option: [],
            },
          };
        case 'get_claim_status':
          return {
            metadata: { code: 200, message: 'Ok' },
            response: { nomor_sep: nomorSep, status: 'terkirim' },
          };
        default:
          return { metadata: { code: 200, message: 'Ok' } };
      }
    },
  );
}
