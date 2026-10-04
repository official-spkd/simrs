import {
  type AntreanAddRequest,
  BPJS_SERVICE_PREFIX,
  type BpjsEndpoint,
  bpjsPath,
  type BpjsService,
  VCLAIM_ENDPOINTS,
  vclaimRujukanListResponseSchema,
  type VclaimSepInsertRequest,
  type VclaimSepInsertTSep,
} from '@simrs/shared';
import {
  type BpjsDecoded,
  bpjsHeaders,
  decodeAntreanResponse,
  decodeVclaimResponse,
} from '@simrs/shared/node';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import type { z } from 'zod';
import { loadConfig, type MockConfig } from '../../config';
import { buildServer } from '../../server';
import { MockState } from '../../state';

/**
 * Perangkat uji mock BPJS: server + jam tetap, panggilan bertanda tangan lewat tabel endpoint kontrak bersama, dan
 * dekode respons dengan helper yang juga dipakai konektor (`@simrs/shared/node`). Bukan berkas tes.
 */

/** Senin 5 Okt 2026 08.00 WIB (hari demo). */
export const TEST_NOW = new Date('2026-10-05T01:00:00Z');
export const TODAY = '2026-10-05';
/** Rabu minggu demo: dr. Bagus (99003) cuti di jadwal RS, tetapi praktik di HFIS (perbedaan yang disemai). */
export const RABU = '2026-10-07';

/** Kartu fiktif: aktif, tidak aktif (…0000), tidak ditemukan (…9999), wajib sidik jari (…1111). */
export const KARTU = {
  aktif: '0000123456781',
  aktif2: '0000765432102',
  tidakAktif: '0000123450000',
  tidakAda: '0000123459999',
  sidikJari: '0000123451111',
} as const;

type Params = Record<string, string | number>;

export interface Harness {
  app: FastifyInstance;
  state: MockState;
  config: MockConfig;
  setNow(d: Date): void;
  /** Panggilan mentah bertanda tangan (header bisa ditimpa). */
  raw(
    service: BpjsService,
    endpoint: BpjsEndpoint,
    opts?: { params?: Params; body?: unknown; headers?: Record<string, string> },
  ): Promise<LightMyRequestResponse>;
  vclaim<T>(
    endpoint: BpjsEndpoint,
    schema: z.ZodType<T>,
    params?: Params,
    body?: unknown,
  ): Promise<BpjsDecoded<T>>;
  antrean<T = undefined>(
    endpoint: BpjsEndpoint,
    schema: z.ZodType<T> | null,
    params?: Params,
    body?: unknown,
  ): Promise<BpjsDecoded<T>>;
  /** Nomor rujukan FKTP aktif (urut 01) dan kedaluwarsa (urut 99) milik kartu. */
  rujukanOf(noKartu: string): Promise<{ aktif: string; kedaluwarsa: string }>;
}

export function createHarness(now: Date = TEST_NOW): Harness {
  let current = now;
  const config: MockConfig = {
    ...loadConfig({}),
    now: () => current,
    random: () => 0.99,
    sendWebhook: async () => ({ status: 200 }),
  };
  const state = new MockState();
  const app = buildServer(config, state);

  const url = (service: BpjsService, endpoint: BpjsEndpoint, params?: Params) =>
    `/bpjs${BPJS_SERVICE_PREFIX[service]}${bpjsPath(endpoint.path, params)}`;

  const h: Harness = {
    app,
    state,
    config,
    setNow: (d) => {
      current = d;
    },
    raw: (service, endpoint, opts = {}) =>
      app.inject({
        method: endpoint.method,
        url: url(service, endpoint, opts.params),
        headers: opts.headers ?? bpjsHeaders(config.bpjs, config.now()),
        ...(opts.body === undefined ? {} : { payload: opts.body as object }),
      }),
    async vclaim(endpoint, schema, params, body) {
      const headers = bpjsHeaders(config.bpjs, config.now());
      const res = await h.raw('vclaim', endpoint, { params, body, headers });
      if (res.statusCode !== 200) throw new Error(`HTTP ${res.statusCode}: ${res.body}`);
      return decodeVclaimResponse(res.json(), schema, config.bpjs, headers['X-timestamp'] ?? '');
    },
    async antrean(endpoint, schema, params, body) {
      const headers = bpjsHeaders(config.bpjs, config.now());
      const res = await h.raw('antrean', endpoint, { params, body, headers });
      if (res.statusCode !== 200) throw new Error(`HTTP ${res.statusCode}: ${res.body}`);
      return decodeAntreanResponse(res.json(), schema, config.bpjs, headers['X-timestamp'] ?? '');
    },
    async rujukanOf(noKartu) {
      const r = await h.vclaim(VCLAIM_ENDPOINTS.rujukanListByKartu, vclaimRujukanListResponseSchema, {
        noKartu,
      });
      if (!r.ok) throw new Error(`Rujukan ${noKartu}: ${r.message}`);
      const nomor = r.data.rujukan.map((x) => x.noKunjungan);
      const aktif = nomor.find((n) => n.endsWith('01'));
      const kedaluwarsa = nomor.find((n) => n.endsWith('99'));
      if (!aktif || !kedaluwarsa) throw new Error('Daftar rujukan mock tidak lengkap');
      return { aktif, kedaluwarsa };
    },
  };
  return h;
}

/** Body SEP 2.0 rawat jalan lengkap (isian kosong seperti BPJS). */
export function sepRawatJalan(t: Partial<VclaimSepInsertTSep> & { noKartu: string }): VclaimSepInsertRequest {
  return {
    request: {
      t_sep: {
        tglSep: TODAY,
        ppkPelayanan: '0301R001',
        jnsPelayanan: '2',
        klsRawat: { klsRawatHak: '2', klsRawatNaik: '', pembiayaan: '', penanggungJawab: '' },
        noMR: '00-00-12-34',
        rujukan: { asalRujukan: '1', tglRujukan: '2026-09-20', noRujukan: '', ppkRujukan: '9999P001' },
        catatan: '',
        diagAwal: 'I10',
        poli: { tujuan: 'INT', eksekutif: '0' },
        cob: { cob: '0' },
        katarak: { katarak: '0' },
        jaminan: {
          lakaLantas: '0',
          noLP: '',
          penjamin: {
            tglKejadian: '',
            keterangan: '',
            suplesi: {
              suplesi: '0',
              noSepSuplesi: '',
              lokasiLaka: { kdPropinsi: '', kdKabupaten: '', kdKecamatan: '' },
            },
          },
        },
        tujuanKunj: '0',
        flagProcedure: '',
        kdPenunjang: '',
        assesmentPel: '',
        skdp: { noSurat: '', kodeDPJP: '' },
        dpjpLayan: '99001',
        noTelp: '081200001111',
        user: 'Petugas Fiktif',
        ...t,
      },
    },
  };
}

/** Body SEP 2.0 rawat inap dari SPRI. */
export function sepRawatInap(noKartu: string, noSpri: string, tglSep = TODAY): VclaimSepInsertRequest {
  return sepRawatJalan({
    noKartu,
    tglSep,
    jnsPelayanan: '1',
    rujukan: { asalRujukan: '', tglRujukan: '', noRujukan: '', ppkRujukan: '' },
    poli: { tujuan: '', eksekutif: '0' },
    skdp: { noSurat: noSpri, kodeDPJP: '99001' },
    dpjpLayan: '',
  });
}

/** Body tambah antrean JKN untuk dr. Andini (INT, 99001) 08:00–12:00 hari ini. */
export function antreanAdd(overrides: Partial<AntreanAddRequest> = {}): AntreanAddRequest {
  return {
    kodebooking: '2610050117',
    jenispasien: 'JKN',
    nomorkartu: KARTU.aktif,
    nik: '9999010101900001',
    nohp: '081200001111',
    kodepoli: 'INT',
    namapoli: 'PENYAKIT DALAM',
    pasienbaru: 0,
    norm: '00-00-12-34',
    tanggalperiksa: TODAY,
    kodedokter: 99001,
    namadokter: 'dr. Andini Prameswari, Sp.PD',
    jampraktek: '08:00-12:00',
    jeniskunjungan: 1,
    nomorreferensi: '9999P00112345678101',
    nomorantrean: 'PD-027',
    angkaantrean: 27,
    estimasidilayani: TEST_NOW.getTime() + 90 * 60_000,
    sisakuotajkn: 6,
    kuotajkn: 24,
    sisakuotanonjkn: 1,
    kuotanonjkn: 6,
    keterangan: 'Peserta harap datang 30 menit lebih awal',
    ...overrides,
  };
}
