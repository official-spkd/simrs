import { BPJS_BUSINESS_ERROR_CODE, type BpjsRejectionKnownCode, bpjsRejectionMessage } from '@simrs/shared';
import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';
import type { MockConfig } from '../../config';
import type { MockState } from '../../state';

/** Konteks bersama rute mock BPJS: konfigurasi, keadaan, tanggal WIB, dan pembungkus respons sukses. */
export interface BpjsContext {
  config: MockConfig;
  state: MockState;
  /** Tanggal WIB hari ini `YYYY-MM-DD`. */
  today(): string;
  /** `X-timestamp` permintaan (sudah diverifikasi). */
  timestamp(req: FastifyRequest): string;
  /** `{ metaData: { code: "200" }, response: <terenkripsi> }`. */
  vclaimOk(req: FastifyRequest, data: unknown): unknown;
  /** `{ metadata: { code: 200 } }`, plus `response` terenkripsi bila ada data. */
  antreanOk(req: FastifyRequest, data?: unknown): unknown;
}

/** Penolakan bisnis VClaim: HTTP 200, `metaData.code` "201", `response` null. */
export function vclaimFail(code: BpjsRejectionKnownCode, detail?: string) {
  return {
    metaData: { code: String(BPJS_BUSINESS_ERROR_CODE), message: bpjsRejectionMessage(code, detail) },
    response: null,
  };
}

/** Penolakan bisnis Antrean/HFIS: HTTP 200, `metadata.code` 201. */
export function antreanFail(code: BpjsRejectionKnownCode, detail?: string) {
  return { metadata: { code: BPJS_BUSINESS_ERROR_CODE, message: bpjsRejectionMessage(code, detail) } };
}

/** Rincian galat validasi zod untuk pesan BPJS: `<path>: <pesan>` dari isu pertama. */
export function zodDetail(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return 'permintaan tidak sah';
  const path = issue.path.join('.');
  return path ? `${path}: ${issue.message}` : issue.message;
}

/** `YYYY-MM-DD` → `MMYY` untuk nomor SEP/surat. */
export function mmyy(isoDate: string): string {
  return `${isoDate.slice(5, 7)}${isoDate.slice(2, 4)}`;
}
