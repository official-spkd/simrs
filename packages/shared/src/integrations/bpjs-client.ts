import { z } from 'zod';
import { resolveAppEnv } from '../env';
import { type BpjsCredentials, bpjsSignature, bpjsTimestamp } from './bpjs-crypto';
import {
  BPJS_SERVICE_PREFIX,
  type BpjsFailureCode,
  type BpjsRejectionCode,
  type BpjsService,
  classifyBpjsFailure,
} from './bpjs/common';
import { decodeAplicareResponse } from './bpjs/aplicare';
import { type BpjsDecoded, decodeAntreanResponse, decodeVclaimResponse } from './bpjs/decode';

/**
 * Klien HTTP BPJS (VClaim, Antrean RS + HFIS, Aplicare) khusus Node: header bertanda tangan, lalu dekode respons
 * lewat dekoder kontrak bersama (`decodeVclaimResponse`/`decodeAntreanResponse`: amplop, dekripsi AES + LZ-string,
 * validasi skema zod; Aplicare polos: `decodeAplicareResponse`). Dipakai worker (outbox, ADR-0003/0017) dan API (lookup sinkron baca-saja, ADR-0025).
 * Klien ini tidak mencoba ulang: retry, penundaan, dan DLQ milik pemanggil.
 *
 * Cocokkan dengan katalog resmi BPJS sebelum integrasi nyata (docs/06-integrasi.md §2): VClaim POST resmi memakai
 * Content-Type `Application/x-www-form-urlencoded` dengan isi JSON, nama layanan di produksi berbeda
 * (`vclaim-rest`, `antreanrs`, `aplicaresws`), dan tiap layanan punya `user_key` sendiri; fase 2 memakai satu set
 * env mock (keputusan fase 2 #11).
 */

export interface BpjsClientConfig extends BpjsCredentials {
  userKey: string;
  /** Base URL; layanan ada di `<baseUrl><BPJS_SERVICE_PREFIX[service]>/…` (lokal: `http://localhost:4100/bpjs`). */
  baseUrl: string;
  timeoutMs: number;
  /** Titik injeksi untuk tes. */
  fetch?: typeof fetch;
  now?: () => Date;
}

export interface BpjsRequest {
  service: BpjsService;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** Path relatif terhadap layanan, diawali `/` (bangun dengan `bpjsPath(VCLAIM_ENDPOINTS.x.path, params)`). */
  path: string;
  body?: unknown;
  /** Header tambahan (mis. `Idempotency-Key`); header tanda tangan tidak bisa ditimpa. */
  headers?: Record<string, string>;
}

interface Timing {
  /** Kode HTTP bila respons diterima. */
  httpStatus?: number;
  durationMs: number;
}

/**
 * - `ok`: kode sukses; `response` sudah didekripsi dan lolos skema (`undefined` untuk operasi tulis Antrean).
 * - `rejected`: galat bisnis (BPJS menjawab HTTP 200 + kode ≠ sukses). Jawaban pasti: catat sebagai hasil domain.
 * - `failure`: gangguan; `retryable` menentukan coba ulang. `detail` tanpa data pasien.
 */
export type BpjsResult<T = unknown> =
  | ({ kind: 'ok'; response: T } & Timing)
  | ({ kind: 'rejected'; code: BpjsRejectionCode; bpjsCode: string; message: string } & Timing)
  | ({
      kind: 'failure';
      code: BpjsFailureCode;
      retryable: boolean;
      detail: string;
      bpjsCode?: string;
    } & Timing);

/** Batas badan respons (daftar referensi bisa besar, tapi tidak sebesar ini). */
const MAX_RESPONSE_CHARS = 1024 * 1024;
const RETRYABLE_HTTP = new Set([408, 425, 429]);
const SIGNED_HEADERS = new Set(['x-cons-id', 'x-timestamp', 'x-signature', 'user_key']);

export class BpjsClient {
  constructor(private readonly config: BpjsClientConfig) {}

  /** URL tujuan; `undefined` bila path keluar dari layanan (pesan tidak boleh mengarahkan ke host/path lain). */
  resolveUrl(req: Pick<BpjsRequest, 'service' | 'path'>): URL | undefined {
    if (!Object.hasOwn(BPJS_SERVICE_PREFIX, req.service)) return undefined;
    if (!req.path.startsWith('/') || req.path.startsWith('//')) return undefined;
    const base = new URL(`${this.config.baseUrl.replace(/\/+$/, '')}${BPJS_SERVICE_PREFIX[req.service]}/`);
    const url = new URL(req.path.slice(1), base);
    if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) return undefined;
    return url;
  }

  /**
   * Kirim satu permintaan. `schema` = skema kontrak isi `response` (mis. `vclaimPesertaResponseSchema`); `null` =
   * tidak ada isi yang dibaca (operasi tulis Antrean/Aplicare; VClaim tetap diterima apa adanya).
   */
  async request<T = unknown>(req: BpjsRequest, schema: z.ZodType<T> | null = null): Promise<BpjsResult<T>> {
    const url = this.resolveUrl(req);
    if (!url) {
      return failure('BPJS_PROTOCOL', false, 'path keluar dari layanan BPJS', { durationMs: 0 });
    }
    const timestamp = bpjsTimestamp(this.config.now?.() ?? new Date());
    const extra = Object.entries(req.headers ?? {}).filter(([k]) => !SIGNED_HEADERS.has(k.toLowerCase()));
    const headers: Record<string, string> = {
      accept: 'application/json',
      ...(req.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...Object.fromEntries(extra),
      'X-cons-id': this.config.consId,
      'X-timestamp': timestamp,
      'X-signature': bpjsSignature(this.config, timestamp),
      user_key: this.config.userKey,
    };

    const doFetch = this.config.fetch ?? fetch;
    const start = performance.now();
    const elapsed = () => Math.round(performance.now() - start);
    let status: number;
    let text: string;
    try {
      const res = await doFetch(url, {
        method: req.method,
        headers,
        body: req.body === undefined ? undefined : JSON.stringify(req.body),
        redirect: 'manual',
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
      status = res.status;
      text = await res.text();
    } catch (err) {
      const name = err instanceof Error ? err.name : 'Error';
      const detail = name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : `jaringan: ${name}`;
      return failure('BPJS_UNAVAILABLE', true, detail, { durationMs: elapsed() });
    }
    const timing: Timing = { httpStatus: status, durationMs: elapsed() };

    if (status === 401 || status === 403) return failure('BPJS_AUTH', false, `HTTP ${status}`, timing);
    if (status >= 500 || RETRYABLE_HTTP.has(status)) {
      return failure('BPJS_UNAVAILABLE', true, `HTTP ${status}`, timing);
    }
    if (status < 200 || status >= 300) return failure('BPJS_PROTOCOL', false, `HTTP ${status}`, timing);
    if (text.length > MAX_RESPONSE_CHARS) {
      return failure('BPJS_PROTOCOL', false, 'respons terlalu besar', timing);
    }

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      // Gerbang BPJS kadang menjawab 200 dengan halaman HTML saat pemeliharaan: anggap gangguan sementara.
      return failure('BPJS_UNAVAILABLE', true, 'respons bukan JSON', timing);
    }

    const decoded = this.decode(req.service, json, schema, timestamp);
    if (decoded.ok) return { kind: 'ok', response: decoded.data, ...timing };
    if (decoded.kind === 'invalid') return failure('BPJS_PROTOCOL', false, decoded.message, timing);
    const fail = classifyBpjsFailure(decoded.code, decoded.message);
    if (fail) {
      return {
        ...failure(
          fail.code,
          fail.retryable,
          `kode ${decoded.code}: ${decoded.message.slice(0, 120)}`,
          timing,
        ),
        bpjsCode: decoded.code,
      };
    }
    return {
      kind: 'rejected',
      code: decoded.rejection,
      bpjsCode: decoded.code,
      message: decoded.message,
      ...timing,
    };
  }

  private decode<T>(
    service: BpjsService,
    json: unknown,
    schema: z.ZodType<T> | null,
    timestamp: string,
  ): BpjsDecoded<T> {
    switch (service) {
      case 'vclaim':
        return decodeVclaimResponse(json, schema ?? (z.unknown() as z.ZodType<T>), this.config, timestamp);
      case 'antrean':
        return decodeAntreanResponse(json, schema, this.config, timestamp);
      case 'aplicare': {
        // Aplicare polos (tanpa kripto); `totalitems` tidak diteruskan (belum ada pemakai).
        const d = decodeAplicareResponse(json, schema);
        return d.ok ? { ok: true, data: d.data } : d;
      }
    }
  }
}

function failure(
  code: BpjsFailureCode,
  retryable: boolean,
  detail: string,
  timing: Timing,
): Extract<BpjsResult, { kind: 'failure' }> {
  return { kind: 'failure', code, retryable, detail, ...timing };
}

/** Nilai mock (sama dengan bawaan `apps/mock`), hanya dipakai di luar produksi. */
export const BPJS_MOCK_CREDENTIALS = { consId: '10000', secretKey: 'mock-secret', userKey: 'mock-user-key' };

export interface BpjsEnv {
  APP_ENV?: string;
  MOCK_BASE_URL?: string;
  BPJS_BASE_URL?: string;
  BPJS_CONS_ID?: string;
  BPJS_SECRET_KEY?: string;
  BPJS_USER_KEY?: string;
}

/**
 * Konfigurasi klien dari env (satu set kredensial, keputusan fase 2 #11; per RS terenkripsi menyusul fase 7).
 * Di luar produksi yang kosong diisi nilai mock dan base URL `<MOCK_BASE_URL>/bpjs`. Di produksi semua wajib
 * diisi; bila tidak, hasilnya `undefined` (pemanggil menjawab "BPJS belum dikonfigurasi").
 */
export function bpjsClientConfig(env: BpjsEnv, opts: { timeoutMs: number }): BpjsClientConfig | undefined {
  const production = resolveAppEnv(env.APP_ENV) === 'production';
  const pick = (value: string | undefined, fallback: string) =>
    value && value.length > 0 ? value : production ? undefined : fallback;
  const mockBase = `${(env.MOCK_BASE_URL ?? 'http://localhost:4100').replace(/\/+$/, '')}/bpjs`;
  const baseUrl = pick(env.BPJS_BASE_URL, mockBase);
  const consId = pick(env.BPJS_CONS_ID, BPJS_MOCK_CREDENTIALS.consId);
  const secretKey = pick(env.BPJS_SECRET_KEY, BPJS_MOCK_CREDENTIALS.secretKey);
  const userKey = pick(env.BPJS_USER_KEY, BPJS_MOCK_CREDENTIALS.userKey);
  if (!baseUrl || !consId || !secretKey || !userKey) return undefined;
  return { baseUrl, consId, secretKey, userKey, timeoutMs: opts.timeoutMs };
}
