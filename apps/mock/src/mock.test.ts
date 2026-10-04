import { bpjsDecryptResponse, bpjsHeaders, verifyTpdiWebhook } from '@simrs/shared/node';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig, type MockConfig } from './config';
import { buildServer } from './server';
import { MockState } from './state';

const NIK = '9999010101900001'; // fiktif

let app: FastifyInstance;
let state: MockState;
let config: MockConfig;
let sent: Array<{ url: string; headers: Record<string, string>; body: string }>;

beforeEach(() => {
  sent = [];
  config = {
    ...loadConfig({}),
    sendWebhook: async (url, headers, body) => {
      sent.push({ url, headers, body });
      return { status: 200 };
    },
    random: () => 0.99,
  };
  state = new MockState();
  app = buildServer(config, state);
});

afterEach(async () => {
  await app.close();
});

describe('skenario', () => {
  it('mode gagal mengembalikan kode yang diatur dan tercatat di log', async () => {
    await app.inject({
      method: 'POST',
      url: '/_panel/api/scenario',
      payload: { system: 'dukcapil', mode: 'gagal', failStatus: 503 },
    });
    const res = await app.inject({ method: 'POST', url: '/dukcapil/verify', payload: { nik: NIK } });
    expect(res.statusCode).toBe(503);
    expect(res.json().code).toBe('MOCK_FAILURE');
    expect(state.log[0]).toMatchObject({ system: 'dukcapil', status: 503 });
  });

  it('mode lambat menambah latensi', async () => {
    await app.inject({
      method: 'POST',
      url: '/_panel/api/scenario',
      payload: { system: 'dukcapil', mode: 'lambat', latencyMs: 120 },
    });
    const start = Date.now();
    const res = await app.inject({ method: 'POST', url: '/dukcapil/verify', payload: { nik: NIK } });
    expect(res.statusCode).toBe(200);
    expect(Date.now() - start).toBeGreaterThanOrEqual(110);
  });
});

describe('Dukcapil verifikasi data (P05)', () => {
  // 9999 01 54 03 72 4521: perempuan, lahir 14-03-(19)72.
  const nik = '9999015403724521';
  const verify = (payload: object) => app.inject({ method: 'POST', url: '/dukcapil/verify-data', payload });

  it('cocok per elemen dari struktur NIK, tanpa mengembalikan data pribadi', async () => {
    const ok = await verify({ nik, nama: 'Siti Rahmawati', tanggalLahir: '1972-03-14', jenisKelamin: 'P' });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ found: true, match: { nama: true, tanggalLahir: true, jenisKelamin: true } });
    expect(ok.body).not.toContain('Siti');

    const wrong = await verify({ nik, tanggalLahir: '1972-04-14', jenisKelamin: 'L' });
    expect(wrong.json().match).toEqual({ nama: null, tanggalLahir: false, jenisKelamin: false });
  });

  it('NIK berakhiran 9999 tidak ditemukan, 8888 nama tidak sesuai; permintaan tak sah ditolak', async () => {
    expect((await verify({ nik: '9999015403729999' })).json()).toEqual({ found: false });
    expect((await verify({ nik: '9999015403728888', nama: 'Siti' })).json().match.nama).toBe(false);
    expect((await verify({ nik: '123' })).statusCode).toBe(400);
    expect((await verify({ nik, umur: 54 })).statusCode).toBe(400);
  });
});

describe('BPJS', () => {
  it('menolak tanda tangan salah', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/bpjs/vclaim/Peserta/nik/${NIK}/tglSEP/2026-10-05`,
      headers: { 'X-cons-id': '10000', 'X-timestamp': '1', 'X-signature': 'salah' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('respons peserta terenkripsi dan bisa didekripsi konektor', async () => {
    const headers = bpjsHeaders({ ...config.bpjs, userKey: 'mock-user-key' });
    const res = await app.inject({
      method: 'GET',
      url: `/bpjs/vclaim/Peserta/nik/${NIK}/tglSEP/2026-10-05`,
      headers,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ metaData: { code: string }; response: string }>();
    expect(body.metaData.code).toBe('200');
    expect(typeof body.response).toBe('string');
    const data = bpjsDecryptResponse<{ peserta: { nik: string; statusPeserta: { keterangan: string } } }>(
      body.response,
      config.bpjs,
      headers['X-timestamp'] as string,
    );
    expect(data.peserta.nik).toBe(NIK);
    expect(data.peserta.statusPeserta.keterangan).toBe('AKTIF');
  });

  it('task id di luar 1–7/99 ditolak', async () => {
    const headers = bpjsHeaders({ ...config.bpjs, userKey: 'k' });
    const res = await app.inject({
      method: 'POST',
      url: '/bpjs/antrean/antrean/updatewaktu',
      headers,
      payload: { kodebooking: 'B-1', taskid: 8, waktu: Date.now() },
    });
    expect(res.json().metadata.code).toBe(201);
  });
});

describe('SATUSEHAT', () => {
  async function token(): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/satusehat/oauth2/v1/accesstoken?grant_type=client_credentials',
    });
    return res.json<{ access_token: string }>().access_token;
  }

  it('butuh token dan menolak Condition tanpa encounter (422)', async () => {
    expect(
      (await app.inject({ method: 'POST', url: '/satusehat/fhir-r4/v1/Condition', payload: {} })).statusCode,
    ).toBe(401);
    const auth = { authorization: `Bearer ${await token()}` };
    const bad = await app.inject({
      method: 'POST',
      url: '/satusehat/fhir-r4/v1/Condition',
      headers: auth,
      payload: { resourceType: 'Condition', subject: { reference: 'Patient/P1' } },
    });
    expect(bad.statusCode).toBe(422);
    const ok = await app.inject({
      method: 'POST',
      url: '/satusehat/fhir-r4/v1/Encounter',
      headers: auth,
      payload: { resourceType: 'Encounter', subject: { reference: 'Patient/P1' } },
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().id).toBeTruthy();
  });
});

describe('TPDI', () => {
  const headers = { 'x-api-key': 'mock-tpdi-key', 'idempotency-key': 'INV-DP-2610-0412' };

  it('invoice idempotent per Idempotency-Key', async () => {
    const payload = { external_ref: 'INV-DP-2610-0412', channel: 'va_btn', amount: 1250400 };
    const a = await app.inject({ method: 'POST', url: '/tpdi/v1/invoices', headers, payload });
    const b = await app.inject({ method: 'POST', url: '/tpdi/v1/invoices', headers, payload });
    expect(a.statusCode).toBe(201);
    expect(b.statusCode).toBe(200);
    expect(b.json().invoice_id).toBe(a.json().invoice_id);
    expect(a.json().va_number).toMatch(/^88080127/);
  });

  it('bayar dari panel mengirim webhook bertanda tangan valid; kirim ulang memakai event id sama', async () => {
    const inv = await app.inject({
      method: 'POST',
      url: '/tpdi/v1/invoices',
      headers,
      payload: { external_ref: 'INV-1', channel: 'qris', amount: '250000' },
    });
    const id = inv.json<{ invoice_id: string }>().invoice_id;
    await app.inject({ method: 'POST', url: `/_panel/api/tpdi/invoices/${id}/pay` });
    await app.inject({ method: 'POST', url: `/_panel/api/tpdi/invoices/${id}/resend` });
    expect(sent).toHaveLength(2);
    const [first, second] = sent;
    expect(first?.url).toBe(config.tpdi.webhookTarget);
    expect(
      verifyTpdiWebhook({
        timestamp: first?.headers['X-TPDI-Timestamp'] ?? '',
        signature: first?.headers['X-TPDI-Signature'] ?? '',
        rawBody: first?.body ?? '',
        secret: config.tpdi.webhookSecret,
      }).ok,
    ).toBe(true);
    expect(JSON.parse(first?.body ?? '{}')).toMatchObject({
      event: 'payment.paid',
      amount: 250000,
      invoice_id: id,
    });
    expect(second?.headers['X-TPDI-Event-Id']).toBe(first?.headers['X-TPDI-Event-Id']);

    const statements = await app.inject({ method: 'GET', url: '/btn/v1/accounts/0000000004417/statements' });
    expect(statements.json().lines).toHaveLength(1);
  });

  it('menolak API key salah', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/tpdi/v1/invoices/x',
      headers: { 'x-api-key': 'salah' },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('_echo (penerima outbox contoh)', () => {
  it('dedup per Idempotency-Key', async () => {
    const send = () =>
      app.inject({
        method: 'POST',
        url: '/satusehat/_echo',
        headers: { 'idempotency-key': 'k-1' },
        payload: { operation: 'ping' },
      });
    expect((await send()).json()).toMatchObject({ duplicate: false, count: 1 });
    expect((await send()).json()).toMatchObject({ duplicate: true, count: 2 });
  });
});

describe('panel', () => {
  it('menyajikan HTML berbahasa Indonesia', async () => {
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('Panel mock integrasi');
  });

  it('skrip panel bisa di-parse (tanpa galat sintaks)', async () => {
    const res = await app.inject({ method: 'GET', url: '/' });
    const script = res.body.split('<script>')[1]?.split('</script>')[0] ?? '';
    expect(script.length).toBeGreaterThan(100);
    expect(() => new Function(script)).not.toThrow();
  });
});
