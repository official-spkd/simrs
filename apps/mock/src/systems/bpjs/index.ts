import { ANTREAN_OK, BPJS_SERVICE_PREFIX, isoDateJakarta, VCLAIM_OK } from '@simrs/shared';
import { bpjsEncryptResponse, verifyBpjsSignature } from '@simrs/shared/node';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { MockConfig } from '../../config';
import type { MockState } from '../../state';
import { registerAntrean } from './antrean';
import type { BpjsContext } from './context';
import { registerHfis } from './hfis';
import { registerVclaim } from './vclaim';

/**
 * Mock BPJS (I03): VClaim 2.0 (`metaData`, kode string) dan Antrean RS + HFIS (`metadata`, kode angka), dengan
 * header bertanda tangan dan respons terenkripsi seperti aslinya (enkripsi bisa dimatikan di panel). Kontrak kabel
 * di `@simrs/shared` (`integrations/bpjs`); aturan data fiktif di `peserta.ts`, `rujukan.ts`, `master.ts`.
 * Cocokkan dengan katalog resmi BPJS sebelum integrasi nyata (docs/06 §2).
 */

/** Selisih maksimal `X-timestamp` dengan jam mock (detik). Header harus dibuat baru per permintaan. */
export const BPJS_TIMESTAMP_TOLERANCE_S = 300;

type Service = 'vclaim' | 'antrean' | 'aplicare';

function authHook(config: MockConfig, service: Service) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const fail = (message: string) =>
      reply
        .code(401)
        .send(
          service === 'vclaim'
            ? { metaData: { code: '401', message }, response: null }
            : { metadata: { code: 401, message } },
        );
    const consId = req.headers['x-cons-id'];
    const ts = req.headers['x-timestamp'];
    const sig = req.headers['x-signature'];
    const userKey = req.headers['user_key'];
    if (typeof consId !== 'string' || typeof ts !== 'string' || typeof sig !== 'string') {
      return fail('Header X-cons-id, X-timestamp, X-signature wajib');
    }
    if (consId !== config.bpjs.consId || !verifyBpjsSignature(config.bpjs, ts, sig)) {
      return fail('Signature tidak valid');
    }
    const drift = Math.abs(Math.floor(config.now().getTime() / 1000) - Number(ts));
    if (!/^\d+$/.test(ts) || drift > BPJS_TIMESTAMP_TOLERANCE_S) {
      return fail('X-timestamp kedaluwarsa');
    }
    if (typeof userKey !== 'string' || userKey !== config.bpjs.userKey) {
      return fail('user_key tidak valid');
    }
  };
}

export function registerBpjs(app: FastifyInstance, config: MockConfig, state: MockState): void {
  const timestamp = (req: FastifyRequest) => req.headers['x-timestamp'] as string;
  const encrypt = (req: FastifyRequest, data: unknown) =>
    state.bpjsEncryption ? bpjsEncryptResponse(data, config.bpjs, timestamp(req)) : data;
  const ctx: BpjsContext = {
    config,
    state,
    today: () => isoDateJakarta(config.now()),
    timestamp,
    vclaimOk: (req, data) => ({ metaData: { code: VCLAIM_OK, message: 'OK' }, response: encrypt(req, data) }),
    antreanOk: (req, data) =>
      data === undefined
        ? { metadata: { code: ANTREAN_OK, message: 'Ok' } }
        : { response: encrypt(req, data), metadata: { code: ANTREAN_OK, message: 'Ok' } },
  };

  void app.register(
    async (scope) => {
      scope.addHook('onRequest', authHook(config, 'vclaim'));
      registerVclaim(scope, ctx);
    },
    { prefix: `/bpjs${BPJS_SERVICE_PREFIX.vclaim}` },
  );

  void app.register(
    async (scope) => {
      scope.addHook('onRequest', authHook(config, 'antrean'));
      registerAntrean(scope, ctx);
      registerHfis(scope, ctx);
    },
    { prefix: `/bpjs${BPJS_SERVICE_PREFIX.antrean}` },
  );

  void app.register(
    async (scope) => {
      scope.addHook('onRequest', authHook(config, 'aplicare'));
      // Aplicare (K05, fase 3): baru kerangka, ketersediaan bed per kelas diterima tanpa validasi isi.
      scope.post('/rest/bed/update/:ppk', async () => ({ metadata: { code: 1, message: 'Sukses (mock)' } }));
    },
    { prefix: `/bpjs${BPJS_SERVICE_PREFIX.aplicare}` },
  );
}
