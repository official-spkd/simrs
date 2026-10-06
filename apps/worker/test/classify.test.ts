import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
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
      { target: 'bpjs', operation: 'ping', idempotencyKey: 'k', payload: {}, attempts: 0 },
      {} as OperationContext,
    );
    expect(spec).toMatchObject({ method: 'POST', path: '/bpjs/_echo' });
  });
});

describe('HttpConnector', () => {
  it('menolak path yang keluar dari host tujuan (SSRF) tanpa melakukan permintaan', async () => {
    const connector = new HttpConnector({
      INTEGRATION_MODE: 'mock',
      MOCK_BASE_URL: 'http://127.0.0.1:4100',
      OUTBOX_HTTP_TIMEOUT_MS: 500,
    } as WorkerEnv);
    const res = await connector.send(
      { target: 'bpjs', operation: 'ping', idempotencyKey: 'k', payload: {}, attempts: 0 },
      { method: 'POST', path: '//jahat.example/_echo' },
    );
    expect(res).toMatchObject({ ok: false, permanent: true, error: 'Path operasi keluar dari host tujuan' });
  });

  it('badan respons dibaca maks. 64 KB; potongan jejak hanya bila operasi menyatakan tidak sensitif', async () => {
    const big = `{"nik":"9999010190000001","pad":"${'x'.repeat(300_000)}"}`;
    const server = createServer((_req, res) => res.end(big));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const { port } = server.address() as AddressInfo;
    const connector = new HttpConnector({
      INTEGRATION_MODE: 'mock',
      MOCK_BASE_URL: `http://127.0.0.1:${port}`,
      OUTBOX_HTTP_TIMEOUT_MS: 2000,
    } as WorkerEnv);
    const msg = { target: 'x', operation: 'ping', idempotencyKey: 'k', payload: {}, attempts: 0 };
    try {
      const byDefault = await connector.send(msg, { method: 'POST', path: '/x/_echo' });
      expect(byDefault.ok).toBe(true);
      expect(byDefault.responseBody?.length).toBe(64 * 1024);
      // Bawaan gagal aman: tanpa `sensitive: false` potongan respons (bisa memuat data pribadi) tidak disimpan.
      expect(byDefault.responseExcerpt).toBeUndefined();
      const open = await connector.send(msg, { method: 'POST', path: '/x/_echo' }, { sensitive: false });
      expect(open.responseExcerpt).toBe(big.slice(0, 300));
    } finally {
      await new Promise((r) => server.close(r));
    }
  });

  it('di luar mode mock tidak pernah mengirim ke MOCK_BASE_URL (gagal tertutup, dicoba ulang)', async () => {
    let called = false;
    const server = createServer((_req, res) => {
      called = true;
      res.end('{}');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const { port } = server.address() as AddressInfo;
    try {
      for (const mode of ['sandbox', 'production'] as const) {
        const connector = new HttpConnector({
          INTEGRATION_MODE: mode,
          MOCK_BASE_URL: `http://127.0.0.1:${port}`,
          OUTBOX_HTTP_TIMEOUT_MS: 500,
        } as WorkerEnv);
        const res = await connector.send(
          { target: 'dukcapil', operation: 'ping', idempotencyKey: 'k', payload: {}, attempts: 0 },
          { method: 'POST', path: '/dukcapil/verify', body: { nik: '9999010190000001' } },
        );
        expect(res).toMatchObject({ ok: false, permanent: false });
      }
      expect(called).toBe(false);
    } finally {
      await new Promise((r) => server.close(r));
    }
  });
});
