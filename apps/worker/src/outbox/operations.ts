import type { OutboxMessage } from '@simrs/db';

export type OutboxMessageLike = Pick<OutboxMessage, 'target' | 'operation' | 'idempotencyKey' | 'payload'>;

export interface HttpRequestSpec {
  method: 'POST' | 'PUT' | 'GET';
  /** Path relatif terhadap base URL sistem tujuan (lokal: MOCK_BASE_URL). */
  path: string;
  body?: unknown;
}

/**
 * Peta operasi outbox → permintaan HTTP. Tambahkan operasi baru di sini (lihat Tutorial §6).
 * Memakai Map, bukan objek biasa: nama operasi seperti `constructor`/`__proto__` tidak boleh
 * tak sengaja cocok dengan properti bawaan objek.
 */
export const OUTBOX_OPERATIONS: ReadonlyMap<string, (msg: OutboxMessageLike) => HttpRequestSpec> = new Map([
  [
    'ping',
    (msg: OutboxMessageLike): HttpRequestSpec => ({
      method: 'POST',
      path: `/${msg.target}/_echo`,
      body: { operation: msg.operation, payload: msg.payload },
    }),
  ],
]);
