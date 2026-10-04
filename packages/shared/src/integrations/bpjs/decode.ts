import type { z } from 'zod';
import { type BpjsCredentials, bpjsDecryptResponse } from '../bpjs-crypto';
import {
  ANTREAN_OK,
  antreanEnvelopeSchema,
  type BpjsRejectionCode,
  classifyBpjsRejection,
  VCLAIM_OK,
  vclaimEnvelopeSchema,
} from './common';

/**
 * Dekode respons BPJS (khusus Node: memakai kripto): validasi amplop, dekripsi `response` bila berupa string
 * (respons polos saat enkripsi mock dimatikan diterima apa adanya), lalu validasi isi dengan skema kontrak.
 * `timestamp` = header `X-timestamp` yang dikirim pada permintaan yang sama (bagian dari kunci dekripsi).
 */
export type BpjsDecoded<T> =
  | { ok: true; data: T }
  /** Galat bisnis BPJS (HTTP 200, kode ≠ 200): bukan alasan mencoba ulang. */
  | { ok: false; kind: 'rejected'; code: string; message: string; rejection: BpjsRejectionCode }
  /** Amplop/isi tidak sesuai kontrak atau gagal didekripsi. */
  | { ok: false; kind: 'invalid'; message: string };

function payload(response: unknown, creds: BpjsCredentials, timestamp: string): unknown {
  return typeof response === 'string' && response !== ''
    ? bpjsDecryptResponse(response, creds, timestamp)
    : response;
}

function decodeData<T>(
  response: unknown,
  schema: z.ZodType<T>,
  creds: BpjsCredentials,
  timestamp: string,
): BpjsDecoded<T> {
  let raw: unknown;
  try {
    raw = payload(response, creds, timestamp);
  } catch {
    return { ok: false, kind: 'invalid', message: 'Respons BPJS tidak bisa didekripsi' };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success)
    return { ok: false, kind: 'invalid', message: 'Isi respons BPJS tidak sesuai kontrak' };
  return { ok: true, data: parsed.data };
}

/** VClaim: `{ metaData: { code: "200" }, response }`. */
export function decodeVclaimResponse<T>(
  body: unknown,
  schema: z.ZodType<T>,
  creds: BpjsCredentials,
  timestamp: string,
): BpjsDecoded<T> {
  const env = vclaimEnvelopeSchema.safeParse(body);
  if (!env.success) return { ok: false, kind: 'invalid', message: 'Amplop VClaim tidak dikenali' };
  const { code, message } = env.data.metaData;
  if (code !== VCLAIM_OK) {
    return { ok: false, kind: 'rejected', code, message, rejection: classifyBpjsRejection(message) };
  }
  return decodeData(env.data.response, schema, creds, timestamp);
}

/**
 * Antrean/HFIS: `{ metadata: { code: 200 }, response? }`. Tanpa skema (operasi tulis) hasilnya `undefined` bila
 * sukses.
 */
export function decodeAntreanResponse<T = undefined>(
  body: unknown,
  schema: z.ZodType<T> | null,
  creds: BpjsCredentials,
  timestamp: string,
): BpjsDecoded<T> {
  const env = antreanEnvelopeSchema.safeParse(body);
  if (!env.success) return { ok: false, kind: 'invalid', message: 'Amplop Antrean tidak dikenali' };
  const { code, message } = env.data.metadata;
  if (code !== ANTREAN_OK) {
    return {
      ok: false,
      kind: 'rejected',
      code: String(code),
      message,
      rejection: classifyBpjsRejection(message),
    };
  }
  if (!schema) return { ok: true, data: undefined as T };
  return decodeData(env.data.response, schema, creds, timestamp);
}
