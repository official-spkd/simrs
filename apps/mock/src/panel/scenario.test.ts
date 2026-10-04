import {
  ANTREAN_ENDPOINTS,
  VCLAIM_ENDPOINTS,
  vclaimHistoriResponseSchema,
  vclaimSepInsertResponseSchema,
} from '@simrs/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  antreanAdd,
  createHarness,
  type Harness,
  KARTU,
  sepRawatJalan,
  TODAY,
} from '../systems/bpjs/test-kit';

/** API skenario panel yang dipakai E2E untuk uji gangguan (normal | lambat | gagal | acak | timeout) dan reset. */

let h: Harness;

beforeEach(() => {
  h = createHarness();
});

afterEach(async () => {
  await h.app.close();
});

const scenario = (payload: object) => h.app.inject({ method: 'POST', url: '/_panel/api/scenario', payload });
const reset = (payload?: object) =>
  h.app.inject({ method: 'POST', url: '/_panel/api/reset', ...(payload ? { payload } : {}) });

async function sepBody() {
  const { aktif } = await h.rujukanOf(KARTU.aktif);
  return sepRawatJalan({
    noKartu: KARTU.aktif,
    rujukan: { asalRujukan: '1', tglRujukan: TODAY, noRujukan: aktif, ppkRujukan: '' },
  });
}

describe('skenario per sistem', () => {
  it('mengembalikan skenario lengkap; nilai yang tidak dikirim tetap; mode tak dikenal ditolak 400', async () => {
    const res = await scenario({ system: 'bpjs', mode: 'timeout', timeoutMs: 80 });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ mode: 'timeout', latencyMs: 3000, failStatus: 503, timeoutMs: 80 });
    expect((await scenario({ system: 'bpjs', mode: 'normal' })).json()).toMatchObject({
      mode: 'normal',
      timeoutMs: 80,
    });
    expect((await scenario({ system: 'bpjs', mode: 'mati' })).statusCode).toBe(400);
    expect((await scenario({ system: 'bpjs', mode: 'timeout', timeoutMs: 500_000 })).statusCode).toBe(400);
    const state = (await h.app.inject({ method: 'GET', url: '/_panel/api/state' })).json();
    expect(state.systems.find((s: { id: string }) => s.id === 'bpjs').scenario.mode).toBe('normal');
  });

  it('timeout: SEP tetap terbit di BPJS tetapi klien menerima 504 setelah ditahan', async () => {
    const body = await sepBody();
    await scenario({ system: 'bpjs', mode: 'timeout', timeoutMs: 60 });
    const start = Date.now();
    const res = await h.raw('vclaim', VCLAIM_ENDPOINTS.sepInsert, { body });
    expect(Date.now() - start).toBeGreaterThanOrEqual(50);
    expect(res.statusCode).toBe(504);
    expect(res.json()).toMatchObject({ code: 'MOCK_TIMEOUT' });
    expect([...h.state.bpjs.seps.keys()]).toEqual(['0301R0011026V000001']);
    expect(h.state.log[0]).toMatchObject({ system: 'bpjs', status: 504 });

    // Pulih: kirim ulang = SEP ganda; histori menemukan SEP yang terbit saat timeout.
    await scenario({ system: 'bpjs', mode: 'normal' });
    const ulang = await h.vclaim(VCLAIM_ENDPOINTS.sepInsert, vclaimSepInsertResponseSchema, undefined, body);
    expect(ulang).toMatchObject({ ok: false, rejection: 'BPJS_SEP_GANDA' });
    const histori = await h.vclaim(VCLAIM_ENDPOINTS.historiPelayanan, vclaimHistoriResponseSchema, {
      noKartu: KARTU.aktif,
      tglMulai: TODAY,
      tglAkhir: TODAY,
    });
    expect(histori.ok && histori.data.histori[0]?.noSep).toBe('0301R0011026V000001');
  });

  it('gagal: ditolak dengan kode yang diatur tanpa diproses; sistem lain tidak terpengaruh', async () => {
    await scenario({ system: 'bpjs', mode: 'gagal', failStatus: 500 });
    const res = await h.raw('antrean', ANTREAN_ENDPOINTS.add, { body: antreanAdd() });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ code: 'MOCK_FAILURE' });
    expect(h.state.bpjs.antrean.size).toBe(0);
    const dukcapil = await h.app.inject({
      method: 'POST',
      url: '/dukcapil/verify',
      payload: { nik: '9999010101900001' },
    });
    expect(dukcapil.statusCode).toBe(200);
  });

  it('lambat: diproses setelah latensi', async () => {
    await scenario({ system: 'bpjs', mode: 'lambat', latencyMs: 60 });
    const start = Date.now();
    const res = await h.raw('antrean', ANTREAN_ENDPOINTS.add, { body: antreanAdd() });
    expect(Date.now() - start).toBeGreaterThanOrEqual(50);
    expect(res.json().metadata.code).toBe(200);
  });
});

describe('reset', () => {
  it('per sistem: data + skenario BPJS dikosongkan, sistem lain tetap; tanpa body: semua', async () => {
    await h.raw('antrean', ANTREAN_ENDPOINTS.add, { body: antreanAdd() });
    await scenario({ system: 'bpjs', mode: 'gagal' });
    await scenario({ system: 'dukcapil', mode: 'lambat', latencyMs: 1 });
    await h.app.inject({ method: 'POST', url: '/_panel/api/bpjs-encryption', payload: { enabled: false } });

    const one = await reset({ system: 'bpjs' });
    expect(one.json()).toEqual({ ok: true, system: 'bpjs' });
    expect(h.state.bpjs.antrean.size).toBe(0);
    expect(h.state.scenario('bpjs').mode).toBe('normal');
    expect(h.state.bpjsEncryption).toBe(true);
    expect(h.state.scenario('dukcapil').mode).toBe('lambat');

    expect((await reset({ system: 'tidak-ada' })).statusCode).toBe(400);
    expect((await reset()).json()).toEqual({ ok: true, system: 'semua' });
    expect(h.state.scenario('dukcapil').mode).toBe('normal');
  });
});
