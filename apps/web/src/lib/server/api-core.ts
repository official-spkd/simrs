import { errorBodySchema } from '@simrs/shared';
import type { z } from 'zod';
import type { ClientInfo } from '../client-info';

/** Galat dari API (kode stabil + pesan untuk pengguna) atau API tidak terjangkau (`SERVICE_UNAVAILABLE`). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiCall<S extends z.ZodType> {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH';
  body?: unknown;
  accessToken?: string | null;
  client?: ClientInfo | null;
  /** Header `Idempotency-Key` (mis. check-in anjungan: sentuhan ganda → hasil yang sama). */
  idempotencyKey?: string;
  /** Bentuk respons yang diharapkan; respons di luar skema dianggap galat (tidak diteruskan ke UI). */
  schema: S;
  timeoutMs?: number;
  /** Header tambahan yang aman diteruskan (mis. `Idempotency-Key`); tidak bisa menimpa header di atas. */
  headers?: Readonly<Record<'Idempotency-Key', string>>;
}

const UNAVAILABLE = 'Layanan SIM RS sedang tidak terjangkau. Coba lagi beberapa saat lagi.';

/**
 * Panggilan server-ke-server ke API. Meneruskan IP, host, dan user agent klien (API mempercayainya hanya dari
 * alamat di TRUST_PROXY). Tanpa cache, tanpa mengikuti redirect, dengan batas waktu.
 * `path` selalu dibangun kode kita sendiri (konstanta + UUID tervalidasi), tidak pernah dari input mentah.
 */
export async function callApi<S extends z.ZodType>(
  baseUrl: string,
  path: string,
  call: ApiCall<S>,
): Promise<z.infer<S>> {
  const headers = new Headers(call.headers);
  headers.set('accept', 'application/json');
  if (call.body !== undefined) headers.set('content-type', 'application/json');
  if (call.accessToken) headers.set('authorization', `Bearer ${call.accessToken}`);
  if (call.idempotencyKey) headers.set('idempotency-key', call.idempotencyKey);
  if (call.client?.ip) headers.set('x-forwarded-for', call.client.ip);
  if (call.client?.host) headers.set('x-forwarded-host', call.client.host);
  if (call.client?.userAgent) headers.set('user-agent', call.client.userAgent);

  let res: Response;
  try {
    res = await fetch(new URL(path, baseUrl), {
      method: call.method ?? 'GET',
      headers,
      body: call.body === undefined ? undefined : JSON.stringify(call.body),
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(call.timeoutMs ?? 10_000),
    });
  } catch {
    throw new ApiError(503, 'SERVICE_UNAVAILABLE', UNAVAILABLE);
  }
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const parsed = errorBodySchema.safeParse(body);
    if (parsed.success) {
      throw new ApiError(res.status, parsed.data.code, parsed.data.message, parsed.data.details);
    }
    throw new ApiError(res.status, 'INTERNAL_ERROR', UNAVAILABLE);
  }
  const parsed = call.schema.safeParse(body);
  if (!parsed.success) throw new ApiError(502, 'INTERNAL_ERROR', 'Respons layanan tidak sesuai format');
  return parsed.data;
}
