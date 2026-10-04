import { describe, expect, it } from 'vitest';
import { BpjsClient, type BpjsClientConfig, bpjsClientConfig, readBpjsEnvelope } from './bpjs-client';
import { bpjsEncryptResponse, bpjsHeaders } from './bpjs-crypto';
import { BPJS_ERROR_CODES, BPJS_ERROR_LABEL, classifyBpjsMetaData } from './bpjs-errors';

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
    const f = fakeFetch(() => ({ status: 200, body: '{"metadata":{"code":200,"message":"Ok"}}' }));
    const client = new BpjsClient({ ...base, fetch: f.fetch });
    const res = await client.request({
      service: 'antrean',
      method: 'POST',
      path: '/antrean/add',
      body: { kodebooking: 'B1' },
      headers: { 'Idempotency-Key': 'k-1', 'x-signature': 'palsu', 'X-Cons-Id': 'lain' },
    });
    expect(res).toMatchObject({ kind: 'ok', bpjsCode: '200', response: null, httpStatus: 200 });
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

describe('BpjsClient · respons', () => {
  it('mendekripsi `response` dengan timestamp permintaan (AES-256-CBC + LZ-string)', async () => {
    const data = { peserta: { noKartu: '0001', statusPeserta: { kode: '0', keterangan: 'AKTIF' } } };
    const f = fakeFetch((req) => ({
      status: 200,
      body: JSON.stringify({
        metaData: { code: '200', message: 'OK' },
        response: bpjsEncryptResponse(data, base, req.headers['x-timestamp'] ?? ''),
      }),
    }));
    const res = await new BpjsClient({ ...base, fetch: f.fetch }).request({
      service: 'vclaim',
      method: 'GET',
      path: '/Peserta/nik/3171000000000001/tglSEP/2026-10-05',
    });
    expect(res).toMatchObject({ kind: 'ok', bpjsCode: '200', response: data });
    expect(f.calls[0]?.headers['content-type']).toBeUndefined();
  });

  it('respons yang tidak bisa didekripsi → BPJS_PROTOCOL, tidak dicoba ulang', async () => {
    const enc = bpjsEncryptResponse({ a: 1 }, { ...base, secretKey: 'kunci-lain' }, TS);
    const f = fakeFetch(() => ({
      status: 200,
      body: JSON.stringify({ metaData: { code: '200', message: 'OK' }, response: enc }),
    }));
    const res = await new BpjsClient({ ...base, fetch: f.fetch }).request({
      service: 'vclaim',
      method: 'GET',
      path: '/x',
    });
    expect(res).toMatchObject({ kind: 'failure', code: 'BPJS_PROTOCOL', retryable: false });
  });

  it('galat bisnis di HTTP 200 → ditolak dengan kode internal stabil', async () => {
    const cases: Array<[unknown, string]> = [
      [{ metaData: { code: '201', message: 'Peserta Tidak Aktif' } }, 'BPJS_PESERTA_TIDAK_AKTIF'],
      [
        { metaData: { code: '201', message: 'No.Rujukan Sudah Melewati Batas Waktu' } },
        'BPJS_RUJUKAN_KEDALUWARSA',
      ],
      [{ metadata: { code: 201, message: 'TaskId=3 sudah ada' } }, 'BPJS_DUPLIKAT'],
      [{ metaData: { code: '201', message: 'NIK tidak valid' } }, 'BPJS_VALIDATION'],
    ];
    for (const [body, code] of cases) {
      const f = fakeFetch(() => ({
        status: 200,
        body: JSON.stringify({ ...(body as object), response: null }),
      }));
      const res = await new BpjsClient({ ...base, fetch: f.fetch }).request({
        service: 'vclaim',
        method: 'POST',
        path: '/SEP/2.0/insert',
        body: {},
      });
      expect(res).toMatchObject({ kind: 'rejected', code, httpStatus: 200 });
    }
  });

  it('gangguan: timeout, jaringan, 5xx, 429, HTML, metaData 5xx/pemeliharaan → BPJS_UNAVAILABLE (dicoba ulang)', async () => {
    const timeout = Object.assign(new Error('t'), { name: 'TimeoutError' });
    const replies: Array<{ status: number; body: string } | Error> = [
      timeout,
      new TypeError('fetch failed'),
      { status: 503, body: 'Service Unavailable' },
      { status: 429, body: '' },
      { status: 200, body: '<html>maintenance</html>' },
      { status: 200, body: '{"metaData":{"code":"503","message":"Service unavailable"}}' },
      { status: 200, body: '{"metaData":{"code":"201","message":"Sedang dalam pemeliharaan"}}' },
    ];
    const details: string[] = [];
    for (const reply of replies) {
      const f = fakeFetch(() => reply);
      const res = await new BpjsClient({ ...base, fetch: f.fetch }).request({
        service: 'vclaim',
        method: 'GET',
        path: '/x',
      });
      expect(res).toMatchObject({ kind: 'failure', code: 'BPJS_UNAVAILABLE', retryable: true });
      if (res.kind === 'failure') details.push(res.detail);
    }
    expect(details.slice(0, 4)).toEqual(['timeout', 'jaringan: TypeError', 'HTTP 503', 'HTTP 429']);
  });

  it('kredensial ditolak (HTTP 401/403, metaData 401) → BPJS_AUTH; 4xx lain / tanpa metaData → BPJS_PROTOCOL', async () => {
    const expectFailure = async (reply: { status: number; body: string }, code: string) => {
      const f = fakeFetch(() => reply);
      const res = await new BpjsClient({ ...base, fetch: f.fetch }).request({
        service: 'vclaim',
        method: 'GET',
        path: '/x',
      });
      expect(res).toMatchObject({ kind: 'failure', code, retryable: false });
    };
    await expectFailure(
      { status: 401, body: '{"metaData":{"code":"401","message":"Signature tidak valid"}}' },
      'BPJS_AUTH',
    );
    await expectFailure({ status: 403, body: '' }, 'BPJS_AUTH');
    await expectFailure(
      { status: 200, body: '{"metaData":{"code":"401","message":"Unauthorized"}}' },
      'BPJS_AUTH',
    );
    await expectFailure({ status: 404, body: '' }, 'BPJS_PROTOCOL');
    await expectFailure({ status: 200, body: '{"ok":true}' }, 'BPJS_PROTOCOL');
  });

  it('path yang keluar dari layanan ditolak tanpa permintaan (SSRF)', async () => {
    const f = fakeFetch(() => ({ status: 200, body: '{}' }));
    const client = new BpjsClient({ ...base, fetch: f.fetch });
    for (const path of ['//jahat.example/x', 'tanpa-garis', '/../antrean/x', '/%2e%2e/aplicare/x']) {
      const res = await client.request({ service: 'vclaim', method: 'GET', path });
      expect(res).toMatchObject({ kind: 'failure', code: 'BPJS_PROTOCOL', retryable: false });
    }
    const unknown = await client.request({ service: 'lain' as 'vclaim', method: 'GET', path: '/x' });
    expect(unknown).toMatchObject({ kind: 'failure', code: 'BPJS_PROTOCOL' });
    expect(f.calls).toEqual([]);
  });
});

describe('klasifikasi metaData', () => {
  it('sukses: 200 (string/angka) dan 1 (Aplicare)', () => {
    for (const c of ['200', 200, 1, '1']) expect(classifyBpjsMetaData(c, 'OK')).toEqual({ kind: 'ok' });
  });

  it('pesan umum BPJS → kode internal', () => {
    const map: Array<[string, string]> = [
      ['Data Peserta Tidak Ditemukan', 'BPJS_PESERTA_TIDAK_DITEMUKAN'],
      ['Status Peserta Tidak Aktif', 'BPJS_PESERTA_TIDAK_AKTIF'],
      ['Peserta sudah mendapatkan pelayanan pada tanggal yang sama', 'BPJS_SEP_GANDA'],
      ['SEP sudah terbit untuk rujukan ini', 'BPJS_SEP_GANDA'],
      ['Rujukan sudah kadaluarsa', 'BPJS_RUJUKAN_KEDALUWARSA'],
      ['TaskId=4 tidak boleh kurang dari waktu TaskId sebelumnya', 'BPJS_TASK_URUTAN'],
      ['Terdapat duplikasi Kode Booking', 'BPJS_DUPLIKAT'],
      ['Antrean Tidak Ditemukan', 'BPJS_TIDAK_DITEMUKAN'],
      ['Format tanggal salah', 'BPJS_VALIDATION'],
    ];
    for (const [message, code] of map) {
      expect(classifyBpjsMetaData('201', message)).toEqual({ kind: 'rejected', code });
    }
  });

  it('setiap kode punya label', () => {
    for (const c of BPJS_ERROR_CODES) expect(BPJS_ERROR_LABEL[c].length).toBeGreaterThan(3);
  });

  it('amplop metaData (VClaim) dan metadata (Antrean)', () => {
    expect(readBpjsEnvelope({ metaData: { code: '200', message: 'OK' }, response: 'x' })).toEqual({
      code: '200',
      message: 'OK',
      response: 'x',
    });
    expect(readBpjsEnvelope({ metadata: { code: 200 } })).toEqual({
      code: '200',
      message: '',
      response: null,
    });
    expect(readBpjsEnvelope({ metaData: {} })).toBeUndefined();
    expect(readBpjsEnvelope('x')).toBeUndefined();
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
