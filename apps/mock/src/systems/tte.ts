import { createHmac, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { MockConfig } from '../config';

const MOCK_TTE_KEY = 'mock-tte-signing-key';

function sign(documentHash: string, signerId: string, signedAt: string): string {
  return createHmac('sha256', MOCK_TTE_KEY)
    .update(`${documentHash}|${signerId}|${signedAt}`)
    .digest('base64');
}

/** Mock penyelenggara TTE (P08 dokumen + TTE): tanda tangan tiruan atas hash dokumen + verifikasi. */
export function registerTte(app: FastifyInstance, config: MockConfig): void {
  app.post<{ Body: { documentHash?: string; signerId?: string } }>('/tte/sign', async (req, reply) => {
    const { documentHash, signerId } = req.body ?? {};
    if (!documentHash || !/^[a-f0-9]{64}$/i.test(documentHash) || !signerId) {
      return reply
        .code(400)
        .send({ code: 'VALIDATION_FAILED', message: 'documentHash (sha256 hex) dan signerId wajib' });
    }
    const signedAt = config.now().toISOString();
    return {
      signatureId: randomUUID(),
      signedAt,
      certificate: `CN=${signerId}, O=Mock TTE Lokal, C=ID`,
      signature: sign(documentHash, signerId, signedAt),
    };
  });

  app.post<{ Body: { documentHash?: string; signerId?: string; signedAt?: string; signature?: string } }>(
    '/tte/verify',
    async (req) => {
      const { documentHash = '', signerId = '', signedAt = '', signature = '' } = req.body ?? {};
      return { valid: sign(documentHash, signerId, signedAt) === signature };
    },
  );
}
