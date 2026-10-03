import { createHash } from 'node:crypto';
import type { SessionTokens } from '@simrs/shared';
import type { ClientInfo } from '../client-info';
import { ApiError, callApi } from './api-core';
import { sessionTokensSchema, TOKEN_PATTERN } from './schemas';

export type RefreshResult = { ok: true; tokens: SessionTokens } | { ok: false; status: number };

const KEEP_MS = 30_000;
const MAX_ENTRIES = 5_000;
const REFRESH_TOKEN = TOKEN_PATTERN('sr1');
const entries = new Map<string, { at: number; promise: Promise<RefreshResult> }>();

/**
 * Perpanjang sesi SEKALI per refresh token, walau banyak permintaan paralel (prefetch, beberapa tab) membawa
 * token lama yang sama. Tanpa ini, rotasi + deteksi pemakaian ulang di API (ADR-0011) mencabut sesi pengguna
 * secara acak. Hasil disimpan 30 detik di memori proses, jadi berlaku untuk satu instans web (ADR-0013).
 * Kunci peta adalah hash token, bukan token itu sendiri.
 */
export function refreshSession(
  baseUrl: string,
  refreshToken: string,
  client: ClientInfo | null,
  now: number = Date.now(),
): Promise<RefreshResult> {
  for (const [key, entry] of entries) if (now - entry.at > KEEP_MS) entries.delete(key);
  if (!REFRESH_TOKEN.test(refreshToken)) return Promise.resolve({ ok: false, status: 401 });

  const key = createHash('sha256').update(refreshToken).digest('base64url');
  const hit = entries.get(key);
  if (hit) return hit.promise;
  if (entries.size >= MAX_ENTRIES) {
    const oldest = entries.keys().next().value;
    if (oldest !== undefined) entries.delete(oldest);
  }

  const promise: Promise<RefreshResult> = callApi(baseUrl, '/api/v1/auth/refresh', {
    method: 'POST',
    body: { refreshToken },
    client,
    schema: sessionTokensSchema,
  }).then(
    (tokens) => ({ ok: true, tokens }),
    (err: unknown) => {
      const status = err instanceof ApiError ? err.status : 503;
      // Galat sementara (API mati, batas laju) tidak disimpan: permintaan berikutnya boleh mencoba lagi.
      if (status !== 401) entries.delete(key);
      return { ok: false, status };
    },
  );
  entries.set(key, { at: now, promise });
  return promise;
}

/** Untuk tes. */
export function resetRefreshCache(): void {
  entries.clear();
}
