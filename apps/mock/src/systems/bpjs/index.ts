import { ANTREAN_OK, BPJS_SERVICE_PREFIX, isoDateJakarta, VCLAIM_OK } from '@simrs/shared';
import { bpjsEncryptResponse, verifyBpjsSignature } from '@simrs/shared/node';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { MockConfig } from '../../config';
import type { MockState } from '../../state';
import { registerAntrean } from './antrean';
import { registerAplicare } from './aplicare';
import type { BpjsContext } from './context';
import { registerHfis } from './hfis';
import { registerRujukanKeluar } from './rujukan-keluar';
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

/**
 * Gangguan per peserta (`BpjsState.outageKartu`, panel `POST /_panel/api/bpjs/outage`): permintaan yang menyebut
 * no. kartu terganggu (path atau body) dijawab 503 `MOCK_FAILURE`, sama seperti skenario sistem `gagal`.
 */
function outageHook(state: MockState) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (state.bpjs.outageKartu.size === 0) return;
    const text = `${req.url} ${typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? '')}`;
    for (const kartu of state.bpjs.outageKartu) {
      if (text.includes(kartu)) {
        return reply
          .code(503)
          .send({ code: 'MOCK_FAILURE', message: 'Gangguan BPJS untuk peserta ini (mock)' });
      }
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
      scope.addHook('preHandler', outageHook(state));
      registerVclaim(scope, ctx);
      registerRujukanKeluar(scope, ctx);
    },
    { prefix: `/bpjs${BPJS_SERVICE_PREFIX.vclaim}` },
  );

  void app.register(
    async (scope) => {
      scope.addHook('onRequest', authHook(config, 'antrean'));
      scope.addHook('preHandler', outageHook(state));
      registerAntrean(scope, ctx);
      registerHfis(scope, ctx);
    },
    { prefix: `/bpjs${BPJS_SERVICE_PREFIX.antrean}` },
  );

  void app.register(
    async (scope) => {
      scope.addHook('onRequest', authHook(config, 'aplicare'));
      registerAplicare(scope, ctx);
    },
    { prefix: `/bpjs${BPJS_SERVICE_PREFIX.aplicare}` },
  );
}
