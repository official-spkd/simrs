import { describe, expect, it } from 'vitest';
import type { WorkerEnv } from '../src/config/env';
import { classifyStatus, HttpConnector } from '../src/outbox/http-connector';
import { type OperationContext, OUTBOX_OPERATIONS } from '../src/outbox/operations';

describe('classifyStatus', () => {
  it('2xx terkirim', () => {
    expect(classifyStatus(200)).toEqual({ ok: true });
    expect(classifyStatus(201)).toEqual({ ok: true });
  });

  it('5xx, 408, 425, 429 dicoba ulang', () => {
    for (const s of [500, 502, 503, 504, 408, 425, 429]) {
      expect(classifyStatus(s)).toEqual({ ok: false, permanent: false });
    }
  });

  it('4xx lain permanen (langsung DLQ)', () => {
    for (const s of [400, 401, 403, 404, 409, 422]) {
      expect(classifyStatus(s)).toEqual({ ok: false, permanent: true });
    }
  });
});

describe('OUTBOX_OPERATIONS', () => {
  it('nama operasi yang mirip properti bawaan objek tidak dianggap operasi', () => {
    for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      expect(OUTBOX_OPERATIONS.get(name)).toBeUndefined();
    }
  });

  it('ping diarahkan ke /<target>/_echo', async () => {
    const spec = await OUTBOX_OPERATIONS.get('ping')?.prepare(
      { target: 'bpjs', operation: 'ping', idempotencyKey: 'k', payload: {} },
      {} as OperationContext,
    );
    expect(spec).toMatchObject({ method: 'POST', path: '/bpjs/_echo' });
  });
});

describe('HttpConnector', () => {
  it('menolak path yang keluar dari host tujuan (SSRF) tanpa melakukan permintaan', async () => {
    const connector = new HttpConnector({
      MOCK_BASE_URL: 'http://127.0.0.1:4100',
      OUTBOX_HTTP_TIMEOUT_MS: 500,
    } as WorkerEnv);
    const res = await connector.send(
      { target: 'bpjs', operation: 'ping', idempotencyKey: 'k', payload: {} },
      { method: 'POST', path: '//jahat.example/_echo' },
    );
    expect(res).toMatchObject({ ok: false, permanent: true, error: 'Path operasi keluar dari host tujuan' });
  });
});
