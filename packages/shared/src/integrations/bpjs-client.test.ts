import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { BpjsClient, type BpjsClientConfig, bpjsClientConfig } from './bpjs-client';
import { bpjsEncryptResponse, bpjsHeaders } from './bpjs-crypto';
import {
  BPJS_FAILURES,
  BPJS_REJECTIONS,
  bpjsErrorLabel,
  bpjsRejectionMessage,
  classifyBpjsFailure,
  classifyBpjsRejection,
} from './bpjs/common';

/** 2026-10-05T00:00:00Z → X-timestamp 1791158400. */
const NOW = new Date('2026-10-05T00:00:00Z');
const TS = '1791158400';

interface Captured {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function fakeFetch(respond: (req: Captured) => { status: number; body: string } | Error): {
  fetch: typeof fetch;
  calls: Captured[];
} {
  const calls: Captured[] = [];
  const impl = async (input: string | URL | Request, init?: RequestInit) => {
    const req: Captured = {
      url: String(input),
      method: init?.method ?? 'GET',
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: typeof init?.body === 'string' ? init.body : undefined,
    };
    calls.push(req);
    const r = respond(req);
    if (r instanceof Error) throw r;
    return new Response(r.body, { status: r.status, headers: { 'content-type': 'application/json' } });
  };
  return { fetch: impl as typeof fetch, calls };
}

const base: BpjsClientConfig = {
  baseUrl: 'http://bpjs.test/bpjs',
  consId: '10000',
  secretKey: 'mock-secret',
  userKey: 'mock-user-key',
  timeoutMs: 1000,
  now: () => NOW,
};

const reply = (status: number, body: unknown) => () => ({
  status,
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

async function call(
  service: 'vclaim' | 'antrean' | 'aplicare',
  respond: Parameters<typeof fakeFetch>[0],
  schema: z.ZodType | null = null,
) {
  const f = fakeFetch(respond);
  return new BpjsClient({ ...base, fetch: f.fetch }).request(
    { service, method: 'POST', path: '/x', body: {} },
    schema,
  );
}

describe('tanda tangan BPJS (vektor tetap)', () => {
  it('X-signature = Base64(HMAC-SHA256("consId&timestamp", secretKey)), dihitung terpisah dengan openssl', () => {
    expect(bpjsHeaders({ consId: '10000', secretKey: 'mock-secret', userKey: 'u' }, NOW)).toEqual({
      'X-cons-id': '10000',
      'X-timestamp': TS,
      'X-signature': 'Q3W/f7ymrNg/+XV3C5rSw7OgYTfpCB7Lq1ItXLf2RHk=',
      user_key: 'u',
    });
    expect(bpjsHeaders({ consId: '1234', secretKey: 'rahasia-uji', userKey: 'k' }, NOW)['X-signature']).toBe(
      'XItVyKYEBGWV0FuU4gyYOM/dED+vpLx05AA7AU8tmzo=',
    );
  });

  it('klien mengirim header bertanda tangan; header tambahan tidak bisa menimpanya', async () => {
    const f = fakeFetch(reply(200, { metadata: { code: 200, message: 'Ok' } }));
    const client = new BpjsClient({ ...base, fetch: f.fetch });
    const res = await client.request({
      service: 'antrean',
      method: 'POST',
      path: '/antrean/add',
      body: { kodebooking: 'B1' },
      headers: { 'Idempotency-Key': 'k-1', 'x-signature': 'palsu', 'X-Cons-Id': 'lain' },
    });
    expect(res).toMatchObject({ kind: 'ok', response: undefined, httpStatus: 200 });
    expect(f.calls[0]).toMatchObject({
      url: 'http://bpjs.test/bpjs/antrean/antrean/add',
      method: 'POST',
      body: '{"kodebooking":"B1"}',
      headers: {
        'x-cons-id': '10000',
        'x-timestamp': TS,
        'x-signature': 'Q3W/f7ymrNg/+XV3C5rSw7OgYTfpCB7Lq1ItXLf2RHk=',
        user_key: 'mock-user-key',
        'idempotency-key': 'k-1',
        'content-type': 'application/json',
      },
    });
  });
});

describe('BpjsClient · respons (dekoder kontrak bersama)', () => {
  const pesertaSchema = z.object({ peserta: z.object({ noKartu: z.string() }) });

  it('mendekripsi `response` dengan timestamp permintaan dan memvalidasi skema', async () => {
    const data = { peserta: { noKartu: '0000123456781' } };
    const f = fakeFetch((req) => ({
      status: 200,
      body: JSON.stringify({
        metaData: { code: '200', message: 'OK' },
        response: bpjsEncryptResponse(data, base, req.headers['x-timestamp'] ?? ''),
      }),
    }));
    const res = await new BpjsClient({ ...base, fetch: f.fetch }).request(
      { service: 'vclaim', method: 'GET', path: '/Peserta/nik/9999010101900001/tglSEP/2026-10-05' },
      pesertaSchema,
    );
    expect(res).toMatchObject({ kind: 'ok', response: data });
    expect(f.calls[0]?.headers['content-type']).toBeUndefined();
  });

  it('tidak bisa didekripsi atau tidak sesuai kontrak → BPJS_PROTOCOL, tidak dicoba ulang', async () => {
    const enc = bpjsEncryptResponse({ a: 1 }, { ...base, secretKey: 'kunci-lain' }, TS);
    const bad = await call('vclaim', reply(200, { metaData: { code: '200', message: 'OK' }, response: enc }));
    expect(bad).toMatchObject({ kind: 'failure', code: 'BPJS_PROTOCOL', retryable: false });
    const contract = await call(
      'vclaim',
      reply(200, { metaData: { code: '200', message: 'OK' }, response: { lain: 1 } }),
      pesertaSchema,
    );
    expect(contract).toMatchObject({
      kind: 'failure',
      code: 'BPJS_PROTOCOL',
      detail: 'Isi respons BPJS tidak sesuai kontrak',
    });
    const envelope = await call('vclaim', reply(200, { ok: true }));
    expect(envelope).toMatchObject({ kind: 'failure', code: 'BPJS_PROTOCOL' });
  });

  it('galat bisnis di HTTP 200 → ditolak dengan kode internal stabil', async () => {
    const cases: Array<['vclaim' | 'antrean', unknown, string]> = [
      [
        'vclaim',
        { metaData: { code: '201', message: 'Status peserta tidak aktif' } },
        'BPJS_PESERTA_TIDAK_AKTIF',
      ],
      [
        'vclaim',
        { metaData: { code: '201', message: 'No.Rujukan Sudah Melewati Batas Waktu' } },
        'BPJS_RUJUKAN_KEDALUWARSA',
      ],
      ['antrean', { metadata: { code: 201, message: 'TaskId=3 sudah ada' } }, 'BPJS_TASK_GANDA'],
      [
        'antrean',
        { metadata: { code: 201, message: 'Kode booking sudah terdaftar: B1' } },
        'BPJS_ANTREAN_GANDA',
      ],
      ['vclaim', { metaData: { code: '201', message: 'Format tanggal salah' } }, 'BPJS_TIDAK_DIKENAL'],
    ];
    for (const [service, body, code] of cases) {
      expect(await call(service, reply(200, body))).toMatchObject({
        kind: 'rejected',
        code,
        httpStatus: 200,
      });
    }
  });

  it('Aplicare (polos, dekoder kontrak N): kode 1 = sukses; kode lain = ditolak', async () => {
    expect(await call('aplicare', reply(200, { metadata: { code: 1, message: 'Sukses' } }))).toMatchObject({
      kind: 'ok',
    });
    expect(
      await call('aplicare', reply(200, { metadata: { code: 0, message: 'Ruang sudah terdaftar: R-01' } })),
    ).toMatchObject({ kind: 'rejected', code: 'BPJS_RUANG_GANDA', bpjsCode: '0' });
  });

  it('gangguan: timeout, jaringan, 5xx, 429, HTML, kode 5xx/pemeliharaan di amplop → BPJS_UNAVAILABLE', async () => {
    const timeout = Object.assign(new Error('t'), { name: 'TimeoutError' });
    const replies: Array<Parameters<typeof fakeFetch>[0]> = [
      () => timeout,
      () => new TypeError('fetch failed'),
      reply(503, 'Service Unavailable'),
      reply(429, ''),
      reply(200, '<html>maintenance</html>'),
      reply(200, { metaData: { code: '503', message: 'Service unavailable' } }),
      reply(200, { metaData: { code: '201', message: 'Sedang dalam pemeliharaan' } }),
    ];
    const details: string[] = [];
    for (const r of replies) {
      const res = await call('vclaim', r);
      expect(res).toMatchObject({ kind: 'failure', code: 'BPJS_UNAVAILABLE', retryable: true });
      if (res.kind === 'failure') details.push(res.detail);
    }
    expect(details.slice(0, 4)).toEqual(['timeout', 'jaringan: TypeError', 'HTTP 503', 'HTTP 429']);
    // Pesan amplop BPJS tidak ikut ke detail (masuk `lastError` dan log worker): hanya kodenya.
    expect(details.slice(5)).toEqual(['kode 503', 'kode 201']);
  });

  it('kredensial ditolak (HTTP 401/403, kode 401 di amplop) → BPJS_AUTH; 4xx lain → BPJS_PROTOCOL', async () => {
    const cases: Array<[Parameters<typeof fakeFetch>[0], string]> = [
      [reply(401, { metaData: { code: '401', message: 'Signature tidak valid' } }), 'BPJS_AUTH'],
      [reply(403, ''), 'BPJS_AUTH'],
      [reply(200, { metaData: { code: '401', message: 'Unauthorized' } }), 'BPJS_AUTH'],
      [reply(404, ''), 'BPJS_PROTOCOL'],
    ];
    for (const [r, code] of cases) {
      expect(await call('vclaim', r)).toMatchObject({ kind: 'failure', code, retryable: false });
    }
  });

  it('path yang keluar dari layanan ditolak tanpa permintaan (SSRF)', async () => {
    const f = fakeFetch(reply(200, {}));
    const client = new BpjsClient({ ...base, fetch: f.fetch });
    for (const path of ['//jahat.example/x', 'tanpa-garis', '/../antrean/x', '/%2e%2e/aplicare/x']) {
      const res = await client.request({ service: 'vclaim', method: 'GET', path });
      expect(res).toMatchObject({ kind: 'failure', code: 'BPJS_PROTOCOL', retryable: false });
    }
    for (const service of ['lain', 'constructor']) {
      const res = await client.request({ service: service as 'vclaim', method: 'GET', path: '/x' });
      expect(res).toMatchObject({ kind: 'failure', code: 'BPJS_PROTOCOL' });
    }
    expect(f.calls).toEqual([]);
  });
});

describe('klasifikasi penolakan dan gangguan (satu sumber: integrations/bpjs/common)', () => {
  it('pesan baku mock tetap dipetakan lewat awalnya; variasi kata lain lewat pola cadangan', () => {
    for (const code of Object.keys(BPJS_REJECTIONS) as Array<keyof typeof BPJS_REJECTIONS>) {
      expect(classifyBpjsRejection(bpjsRejectionMessage(code, 'x'))).toBe(code);
    }
    const map: Array<[string, string]> = [
      ['Data Peserta Tidak Ditemukan', 'BPJS_PESERTA_TIDAK_DITEMUKAN'],
      ['Peserta sudah mendapatkan pelayanan pada tanggal yang sama', 'BPJS_SEP_GANDA'],
      ['SEP sudah terbit untuk rujukan ini', 'BPJS_SEP_GANDA'],
      ['Rujukan sudah kadaluarsa', 'BPJS_RUJUKAN_KEDALUWARSA'],
      ['TaskId=4 tidak boleh kurang dari waktu TaskId sebelumnya', 'BPJS_TASK_WAKTU_MUNDUR'],
      ['TaskId=5 belum ada task sebelumnya', 'BPJS_TASK_TIDAK_BERURUTAN'],
      ['Terdapat duplikasi Kode Booking', 'BPJS_ANTREAN_GANDA'],
      ['Antrean Tidak Ditemukan', 'BPJS_ANTREAN_TIDAK_DITEMUKAN'],
      ['Data histori tidak ditemukan', 'BPJS_DATA_TIDAK_DITEMUKAN'],
      ['Server sedang sibuk', 'BPJS_TIDAK_DIKENAL'],
      // Variasi kata untuk kode per entitas tidak jatuh ke kode umum.
      ['No. SEP 0301R0011025V000001 bukan SEP rawat inap', 'BPJS_SEP_BUKAN_RAWAT_INAP'],
      ['Nomor surat kontrol sudah digunakan untuk SEP lain', 'BPJS_SURAT_SUDAH_DIPAKAI'],
      ['Kode faskes 9999P001 tidak terdaftar', 'BPJS_FASKES_TIDAK_DITEMUKAN'],
      ['Kode kelas VVIP tidak ditemukan', 'BPJS_KELAS_TIDAK_DITEMUKAN'],
      ['Kode ruang R-99 tidak ditemukan', 'BPJS_RUANG_TIDAK_DITEMUKAN'],
      ['Kode ruangan R-01 sudah terdaftar', 'BPJS_RUANG_GANDA'],
      ['Rujukan untuk no kartu 0000123456781 tidak ditemukan', 'BPJS_RUJUKAN_TIDAK_DITEMUKAN'],
      ['Data SEP tidak ditemukan', 'BPJS_SEP_TIDAK_DITEMUKAN'],
      ['Jadwal praktek dokter tidak ditemukan', 'BPJS_JADWAL_TIDAK_DITEMUKAN'],
      ['Kode poli XYZ tidak ditemukan', 'BPJS_POLI_TIDAK_DITEMUKAN'],
    ];
    for (const [message, code] of map) expect(classifyBpjsRejection(message)).toBe(code);
  });

  it('gangguan di amplop dibedakan dari penolakan bisnis', () => {
    expect(classifyBpjsFailure('201', 'Status peserta tidak aktif')).toBeUndefined();
    expect(classifyBpjsFailure(500, 'Internal')).toEqual({ code: 'BPJS_UNAVAILABLE', retryable: true });
    expect(classifyBpjsFailure('201', 'user_key tidak valid')).toEqual({
      code: 'BPJS_AUTH',
      retryable: false,
    });
  });

  it('setiap kode punya label', () => {
    for (const c of [...Object.keys(BPJS_REJECTIONS), ...Object.keys(BPJS_FAILURES), 'BPJS_TIDAK_DIKENAL']) {
      expect(bpjsErrorLabel(c as Parameters<typeof bpjsErrorLabel>[0]).length).toBeGreaterThan(3);
    }
  });
});

describe('bpjsClientConfig', () => {
  it('lokal: kosong = nilai mock di <MOCK_BASE_URL>/bpjs', () => {
    expect(
      bpjsClientConfig({ APP_ENV: 'local', MOCK_BASE_URL: 'http://127.0.0.1:4100/' }, { timeoutMs: 5000 }),
    ).toEqual({
      baseUrl: 'http://127.0.0.1:4100/bpjs',
      consId: '10000',
      secretKey: 'mock-secret',
      userKey: 'mock-user-key',
      timeoutMs: 5000,
    });
  });

  it('produksi: tanpa kredensial lengkap → tidak terkonfigurasi (tidak jatuh ke nilai mock)', () => {
    expect(bpjsClientConfig({ APP_ENV: 'production', BPJS_CONS_ID: '1' }, { timeoutMs: 1 })).toBeUndefined();
    expect(bpjsClientConfig({}, { timeoutMs: 1 })).toBeUndefined();
    expect(
      bpjsClientConfig(
        {
          APP_ENV: 'production',
          BPJS_BASE_URL: 'https://bpjs.example',
          BPJS_CONS_ID: '1',
          BPJS_SECRET_KEY: 's',
          BPJS_USER_KEY: 'u',
        },
        { timeoutMs: 1 },
      ),
    ).toMatchObject({ baseUrl: 'https://bpjs.example', consId: '1' });
  });
});
