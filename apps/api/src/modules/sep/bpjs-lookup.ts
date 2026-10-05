import type { Provider } from '@nestjs/common';
import {
  bpjsPath,
  frontOfficeError,
  VCLAIM_ENDPOINTS,
  VCLAIM_PESERTA_AKTIF,
  type VclaimPeserta,
  vclaimPesertaResponseSchema,
  type VclaimRujukan,
  vclaimRujukanListResponseSchema,
} from '@simrs/shared';
import { BpjsClient, bpjsClientConfig, type BpjsResult } from '@simrs/shared/node';
import type { z } from 'zod';
import { API_ENV, type ApiEnv } from '../../config/env';
import { LOOKUP_TIMEOUT_MS, type LookupConnector } from '../../infra/lookup/lookup-connector';

/**
 * ADR-0025 · Konektor lookup VClaim (baca-saja) di atas klien BPJS bersama (`@simrs/shared/node`, dipakai juga
 * worker). Kredensial dari env (satu set mock di fase 2, keputusan #11). Penolakan bisnis → 422 `BPJS_REJECTED`
 * (alasan baku di `details.reason`); gangguan/timeout → galat biasa, dipetakan `LookupGateway` ke 503
 * `BPJS_UNAVAILABLE`. Data peserta tidak pernah masuk log/audit (ringkasan audit hanya fakta tanpa PHI).
 */

/** Klien yang dipakai konektor; `null` bila BPJS belum dikonfigurasi (produksi tanpa kredensial). */
export const BPJS_LOOKUP_CLIENT = Symbol('BPJS_LOOKUP_CLIENT');
export type BpjsLookupClient = Pick<BpjsClient, 'request'> | null;

export const bpjsLookupClientProvider: Provider = {
  provide: BPJS_LOOKUP_CLIENT,
  inject: [API_ENV],
  useFactory: (env: ApiEnv): BpjsLookupClient => {
    // Sedikit di bawah batas gateway: klien menghentikan permintaannya sendiri lebih dulu.
    const config = bpjsClientConfig(env, { timeoutMs: LOOKUP_TIMEOUT_MS - 500 });
    return config ? new BpjsClient(config) : null;
  },
};

class BpjsLookupUnavailable extends Error {
  constructor(detail: string) {
    super(`BPJS: ${detail}`);
    this.name = 'BpjsLookupUnavailable';
  }
}

/** Hasil klien → nilai (ok), 422 `BPJS_REJECTED` (penolakan bisnis), atau galat gangguan (→ 503 di gateway). */
function unwrap<T>(res: BpjsResult<T>, notFoundAsEmpty?: () => T): T {
  if (res.kind === 'ok') return res.response;
  if (res.kind === 'rejected') {
    if (
      notFoundAsEmpty &&
      (res.code === 'BPJS_DATA_TIDAK_DITEMUKAN' || res.code === 'BPJS_RUJUKAN_TIDAK_DITEMUKAN')
    ) {
      return notFoundAsEmpty();
    }
    throw frontOfficeError('BPJS_REJECTED', { reason: res.code, bpjsMessage: res.message.slice(0, 500) });
  }
  throw new BpjsLookupUnavailable(`${res.code} ${res.detail}`);
}

async function call<T>(
  client: BpjsLookupClient,
  path: string,
  schema: z.ZodType<T>,
  signal: AbortSignal,
): Promise<BpjsResult<T>> {
  if (!client) throw new BpjsLookupUnavailable('kredensial belum dikonfigurasi');
  if (signal.aborted) throw new BpjsLookupUnavailable('dibatalkan');
  return client.request({ service: 'vclaim', method: 'GET', path }, schema);
}

export interface PesertaLookupInput {
  by: 'kartu' | 'nik';
  value: string;
  /** Tanggal pelayanan `YYYY-MM-DD` (WIB). */
  date: string;
}

/** VClaim peserta per no. kartu / NIK. Peserta tidak aktif tetap hasil (bukan galat). */
export function pesertaConnector(
  client: BpjsLookupClient,
): LookupConnector<PesertaLookupInput, VclaimPeserta> {
  return {
    name: 'bpjs.vclaim.peserta',
    target: 'bpjs',
    async call(input, signal) {
      const path =
        input.by === 'kartu'
          ? bpjsPath(VCLAIM_ENDPOINTS.pesertaByKartu.path, { noKartu: input.value, tglSEP: input.date })
          : bpjsPath(VCLAIM_ENDPOINTS.pesertaByNik.path, { nik: input.value, tglSEP: input.date });
      return unwrap(await call(client, path, vclaimPesertaResponseSchema, signal)).peserta;
    },
    summarize: (p) => ({ found: true, active: p.statusPeserta.kode === VCLAIM_PESERTA_AKTIF }),
  };
}

/** VClaim daftar rujukan FKTP milik kartu (aktif dan kedaluwarsa). Tidak ada rujukan → daftar kosong. */
export function rujukanListConnector(
  client: BpjsLookupClient,
): LookupConnector<{ noKartu: string }, VclaimRujukan[]> {
  return {
    name: 'bpjs.vclaim.rujukan',
    target: 'bpjs',
    async call(input, signal) {
      const path = bpjsPath(VCLAIM_ENDPOINTS.rujukanListByKartu.path, { noKartu: input.noKartu });
      return unwrap(await call(client, path, vclaimRujukanListResponseSchema, signal), () => ({
        rujukan: [],
      })).rujukan;
    },
    summarize: (list) => ({ count: list.length }),
  };
}
