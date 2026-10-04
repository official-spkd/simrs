import {
  ANTREAN_ENDPOINTS,
  VCLAIM_ENDPOINTS,
  vclaimNoSepResponseSchema,
  vclaimPesertaResponseSchema,
  vclaimSepInsertResponseSchema,
} from '@simrs/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AntreanView, SepView } from './panel';
import { antreanAdd, createHarness, type Harness, KARTU, sepRawatJalan, TEST_NOW, TODAY } from './test-kit';

let h: Harness;

beforeEach(() => {
  h = createHarness();
});

afterEach(async () => {
  await h.app.close();
});

const get = (url: string) => h.app.inject({ method: 'GET', url });
const post = (url: string, payload: object) => h.app.inject({ method: 'POST', url, payload });

describe('panel BPJS', () => {
  it('task per kode booking (urut diterima) dan 404 untuk kode tak dikenal', async () => {
    await h.antrean(ANTREAN_ENDPOINTS.add, null, undefined, antreanAdd());
    for (const [taskid, menit] of [
      [1, -20],
      [2, -15],
      [3, -10],
    ]) {
      await h.antrean(ANTREAN_ENDPOINTS.updateWaktu, null, undefined, {
        kodebooking: '2610050117',
        taskid,
        waktu: TEST_NOW.getTime() + (menit ?? 0) * 60_000,
      });
    }
    const res = await get('/_panel/api/bpjs/antrean/2610050117');
    expect(res.statusCode).toBe(200);
    const view = res.json<AntreanView>();
    expect(view).toMatchObject({
      kodebooking: '2610050117',
      status: 'aktif',
      kodepoli: 'INT',
      nomorantrean: 'PD-027',
    });
    expect(view.tasks.map((t) => t.taskid)).toEqual([1, 2, 3]);
    expect(view.tasks[0]).toMatchObject({
      taskname: 'mulai waktu tunggu admisi',
      waktuIso: '2026-10-05T00:40:00.000Z',
    });
    expect((await get('/_panel/api/bpjs/antrean/TIDAK-ADA')).statusCode).toBe(404);
  });

  it('daftar SEP termasuk yang dihapus; ringkasan juga ada di state panel', async () => {
    const { aktif } = await h.rujukanOf(KARTU.aktif);
    const sep = await h.vclaim(
      VCLAIM_ENDPOINTS.sepInsert,
      vclaimSepInsertResponseSchema,
      undefined,
      sepRawatJalan({
        noKartu: KARTU.aktif,
        rujukan: { asalRujukan: '1', tglRujukan: TODAY, noRujukan: aktif, ppkRujukan: '' },
      }),
    );
    if (!sep.ok) throw new Error(sep.message);
    const noSep = sep.data.sep.noSep;
    await h.vclaim(VCLAIM_ENDPOINTS.sepDelete, vclaimNoSepResponseSchema, undefined, {
      request: { t_sep: { noSep, user: 'Petugas Fiktif' } },
    });
    const one = (await get(`/_panel/api/bpjs/sep/${noSep}`)).json<SepView>();
    expect(one).toMatchObject({
      noSep,
      status: 'dihapus',
      poli: 'INT',
      dpjpLayan: '99001',
      noRujukan: aktif,
    });
    expect((await get('/_panel/api/bpjs/sep/0301R0011026V999999')).statusCode).toBe(404);

    const summary = (await get('/_panel/api/bpjs')).json<{ seps: SepView[] }>();
    expect(summary.seps.map((s) => s.noSep)).toEqual([noSep]);
    const state = (await get('/_panel/api/state')).json<{ bpjs: { seps: SepView[]; antrean: unknown[] } }>();
    expect(state.bpjs.seps).toHaveLength(1);
    expect(state.bpjs.antrean).toEqual([]);
  });

  it('sidik jari, HFIS, dan peserta divalidasi (400/404) dan tercatat', async () => {
    expect((await post('/_panel/api/bpjs/fingerprint', { noKartu: '123' })).statusCode).toBe(400);
    expect(
      (
        await post('/_panel/api/bpjs/fingerprint', { noKartu: KARTU.sidikJari, tanggal: '2026-10-06' })
      ).json(),
    ).toEqual({ noKartu: KARTU.sidikJari, tanggal: '2026-10-06', kode: '1' });

    expect((await post('/_panel/api/bpjs/hfis', { kodedokter: 99001, tanggal: TODAY })).statusCode).toBe(400);
    expect(
      (await post('/_panel/api/bpjs/hfis', { kodedokter: 12345, tanggal: TODAY, libur: true })).statusCode,
    ).toBe(404);
    await post('/_panel/api/bpjs/hfis', { kodedokter: 99001, tanggal: TODAY, libur: true });
    const merged = await post('/_panel/api/bpjs/hfis', {
      kodedokter: 99001,
      tanggal: TODAY,
      kapasitaspasien: 5,
    });
    expect(merged.json()).toEqual({ kodedokter: 99001, tanggal: TODAY, libur: true, kapasitaspasien: 5 });

    const summary = (await get('/_panel/api/bpjs')).json();
    expect(summary.fingerprints).toEqual([{ noKartu: KARTU.sidikJari, tanggal: '2026-10-06' }]);
    expect(summary.hfis.overrides).toHaveLength(1);
  });

  it('peserta yang ditetapkan panel dipakai lookup kartu dan NIK (cocok dengan pasien seed)', async () => {
    const nik = '9999745403724521';
    const res = await post('/_panel/api/bpjs/peserta', {
      noKartu: '0000000009772',
      nik,
      nama: 'Siti Rahmawati',
      sex: 'P',
      tglLahir: '1972-03-14',
      hakKelas: '1',
    });
    expect(res.json()).toMatchObject({ noKartu: '0000000009772', nik, nama: 'SITI RAHMAWATI' });
    const byNik = await h.vclaim(VCLAIM_ENDPOINTS.pesertaByNik, vclaimPesertaResponseSchema, {
      nik,
      tglSEP: TODAY,
    });
    expect(byNik.ok && byNik.data.peserta).toMatchObject({
      noKartu: '0000000009772',
      hakKelas: { kode: '1', keterangan: 'KELAS I' },
      statusPeserta: { keterangan: 'AKTIF' },
    });
    expect((await post('/_panel/api/bpjs/peserta', { noKartu: '1234567890123', nik })).statusCode).toBe(400);
    const nonaktif = await post('/_panel/api/bpjs/peserta', { noKartu: '0000000009772', nik, aktif: false });
    expect(nonaktif.json().statusPeserta.keterangan).toBe('TIDAK AKTIF');
  });
});
