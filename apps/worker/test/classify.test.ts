import { describe, expect, it } from 'vitest';
import { classifyStatus } from '../src/outbox/http-connector';

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
