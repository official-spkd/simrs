import {
  ANTREAN_ENDPOINTS,
  bpjsAddDays,
  VCLAIM_RUJUKAN_BERLAKU_HARI,
  VCLAIM_ENDPOINTS,
  vclaimFingerprintResponseSchema,
  vclaimHistoriResponseSchema,
  vclaimJumlahSepResponseSchema,
  vclaimNoSepResponseSchema,
  vclaimPesertaResponseSchema,
  vclaimRefDokterResponseSchema,
  vclaimRefPoliResponseSchema,
  vclaimRencanaKontrolResponseSchema,
  vclaimRujukanListResponseSchema,
  vclaimRujukanResponseSchema,
  vclaimSepDetailSchema,
  vclaimSepInsertResponseSchema,
  vclaimSpriResponseSchema,
  vclaimSuratKontrolSchema,
  type VclaimSepInsertTSep,
} from '@simrs/shared';
import { bpjsHeaders, decodeVclaimResponse } from '@simrs/shared/node';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createHarness,
  type Harness,
  KARTU,
  RABU,
  sepRawatInap,
  sepRawatJalan,
  TEST_NOW,
  TODAY,
} from './test-kit';

let h: Harness;

beforeEach(() => {
  h = createHarness();
});

afterEach(async () => {
  await h.app.close();
});

const peserta = (noKartu: string, tglSEP = TODAY) =>
  h.vclaim(VCLAIM_ENDPOINTS.pesertaByKartu, vclaimPesertaResponseSchema, { noKartu, tglSEP });

async function terbitkanSep(noKartu: string = KARTU.aktif, extra: Partial<VclaimSepInsertTSep> = {}) {
  const { aktif } = await h.rujukanOf(noKartu);
  const rujukan = { asalRujukan: '1' as const, tglRujukan: TODAY, noRujukan: aktif, ppkRujukan: '' };
  return h.vclaim(
    VCLAIM_ENDPOINTS.sepInsert,
    vclaimSepInsertResponseSchema,
    undefined,
    sepRawatJalan({ noKartu, rujukan, ...extra }),
  );
}

describe('autentikasi BPJS', () => {
  it('menolak header kurang, tanda tangan salah, user_key salah, dan timestamp basi (401)', async () => {
    const ep = VCLAIM_ENDPOINTS.pesertaByKartu;
    const params = { noKartu: KARTU.aktif, tglSEP: TODAY };
    const good = bpjsHeaders(h.config.bpjs, TEST_NOW);

    const missing = await h.raw('vclaim', ep, { params, headers: {} });
    expect(missing.statusCode).toBe(401);
    expect(missing.json().metaData.code).toBe('401');

    const badSig = await h.raw('vclaim', ep, { params, headers: { ...good, 'X-signature': 'salah' } });
    expect(badSig.json().metaData.message).toBe('Signature tidak valid');

    const badKey = await h.raw('vclaim', ep, { params, headers: { ...good, user_key: 'lain' } });
    expect(badKey.statusCode).toBe(401);
    expect(badKey.json().metaData.message).toBe('user_key tidak valid');

    const stale = bpjsHeaders(h.config.bpjs, new Date(TEST_NOW.getTime() - 10 * 60_000));
    const old = await h.raw('vclaim', ep, { params, headers: stale });
    expect(old.json().metaData.message).toBe('X-timestamp kedaluwarsa');

    // Antrean memakai amplop `metadata` dengan kode angka.
    const antrean = await h.raw('antrean', ANTREAN_ENDPOINTS.refPoli, { headers: {} });
    expect(antrean.statusCode).toBe(401);
    expect(antrean.json().metadata.code).toBe(401);
  });

  it('respons terenkripsi dan hanya bisa dibuka dengan timestamp permintaan yang sama', async () => {
    const headers = bpjsHeaders(h.config.bpjs, TEST_NOW);
    const res = await h.raw('vclaim', VCLAIM_ENDPOINTS.pesertaByKartu, {
      params: { noKartu: KARTU.aktif, tglSEP: TODAY },
      headers,
    });
    const body = res.json<{ response: unknown }>();
    expect(typeof body.response).toBe('string');
    expect(String(body.response)).not.toContain(KARTU.aktif);
    expect(
      decodeVclaimResponse(body, vclaimPesertaResponseSchema, h.config.bpjs, '1759625000'),
    ).toMatchObject({
      ok: false,
      kind: 'invalid',
    });
  });

  it('enkripsi bisa dimatikan dari panel; respons polos tetap lolos dekode kontrak', async () => {
    await h.app.inject({ method: 'POST', url: '/_panel/api/bpjs-encryption', payload: { enabled: false } });
    const res = await h.raw('vclaim', VCLAIM_ENDPOINTS.pesertaByKartu, {
      params: { noKartu: KARTU.aktif, tglSEP: TODAY },
    });
    expect(res.json().response.peserta.noKartu).toBe(KARTU.aktif);
    const r = await peserta(KARTU.aktif);
    expect(r.ok).toBe(true);
  });
});

describe('peserta', () => {
  it('kartu aktif: data sah menurut kontrak, kelas dan FKTP terisi', async () => {
    const r = await peserta(KARTU.aktif);
    if (!r.ok) throw new Error(r.message);
    const p = r.data.peserta;
    expect(p.noKartu).toBe(KARTU.aktif);
    expect(p.nik).toMatch(/^9999\d{12}$/);
    expect(p.statusPeserta).toEqual({ kode: '0', keterangan: 'AKTIF' });
    expect(['1', '2', '3']).toContain(p.hakKelas.kode);
    expect(p.provUmum.kdProvider).toMatch(/^9999P00\d$/);
    expect(p.umur.umurSekarang).toMatch(/^\d+ tahun ,\d+ bulan ,\d+ hari$/);
  });

  it('kartu …0000 tidak aktif; …9999 dan kartu di luar rentang fiktif tidak ditemukan; format salah = validasi', async () => {
    const inactive = await peserta(KARTU.tidakAktif);
    expect(inactive.ok && inactive.data.peserta.statusPeserta.keterangan).toBe('TIDAK AKTIF');
    expect(await peserta(KARTU.tidakAda)).toMatchObject({
      ok: false,
      rejection: 'BPJS_PESERTA_TIDAK_DITEMUKAN',
    });
    expect(await peserta('1234567890123')).toMatchObject({
      ok: false,
      rejection: 'BPJS_PESERTA_TIDAK_DITEMUKAN',
    });
    expect(await peserta('12345')).toMatchObject({ ok: false, code: '201', rejection: 'BPJS_VALIDASI' });
    expect(await peserta(KARTU.aktif, '5-10-2026')).toMatchObject({ ok: false, rejection: 'BPJS_VALIDASI' });
  });

  it('per NIK: tanggal lahir dan jenis kelamin mengikuti struktur NIK; kartu ↔ NIK konsisten', async () => {
    // 9999 01 54 03 72 4521: perempuan, lahir 14-03-1972.
    const nik = '9999015403724521';
    const r = await h.vclaim(VCLAIM_ENDPOINTS.pesertaByNik, vclaimPesertaResponseSchema, {
      nik,
      tglSEP: TODAY,
    });
    if (!r.ok) throw new Error(r.message);
    expect(r.data.peserta).toMatchObject({ nik, sex: 'P', tglLahir: '1972-03-14' });
    expect(r.data.peserta.noKartu).toMatch(/^0000\d{9}$/);
    const back = await peserta(r.data.peserta.noKartu);
    expect(back.ok && back.data.peserta.nik).toBe(nik);

    const nikTidakAktif = await h.vclaim(VCLAIM_ENDPOINTS.pesertaByNik, vclaimPesertaResponseSchema, {
      nik: '9999015403720000',
      tglSEP: TODAY,
    });
    expect(nikTidakAktif.ok && nikTidakAktif.data.peserta.statusPeserta.kode).toBe('1');
    const nikTidakAda = await h.vclaim(VCLAIM_ENDPOINTS.pesertaByNik, vclaimPesertaResponseSchema, {
      nik: '9999015403729999',
      tglSEP: TODAY,
    });
    expect(nikTidakAda).toMatchObject({ ok: false, rejection: 'BPJS_PESERTA_TIDAK_DITEMUKAN' });
  });
});

describe('rujukan', () => {
  it('daftar FKTP per kartu: urut 01 aktif, urut 99 kedaluwarsa (> 90 hari); per nomor sama isinya', async () => {
    const list = await h.vclaim(VCLAIM_ENDPOINTS.rujukanListByKartu, vclaimRujukanListResponseSchema, {
      noKartu: KARTU.aktif,
    });
    if (!list.ok) throw new Error(list.message);
    expect(list.data.rujukan).toHaveLength(2);
    const [aktif, lama] = list.data.rujukan;
    expect(aktif?.noKunjungan).toMatch(/^9999P00\d12345678101$/);
    expect(aktif?.poliRujukan.kode).toBe('INT');
    expect(aktif?.diagnosa.kode).toBe('I10');
    expect(lama?.noKunjungan.endsWith('99')).toBe(true);
    expect((lama?.tglKunjungan ?? '') < bpjsAddDays(TODAY, -VCLAIM_RUJUKAN_BERLAKU_HARI)).toBe(true);

    const one = await h.vclaim(VCLAIM_ENDPOINTS.rujukanByNomor, vclaimRujukanResponseSchema, {
      noRujukan: aktif?.noKunjungan ?? '',
    });
    expect(one.ok && one.data.rujukan).toEqual(aktif);
  });

  it('rujukan RS terpisah dari FKTP; nomor asing atau jenis salah tidak ditemukan', async () => {
    const rs = await h.vclaim(VCLAIM_ENDPOINTS.rujukanRsListByKartu, vclaimRujukanListResponseSchema, {
      noKartu: KARTU.aktif,
    });
    if (!rs.ok) throw new Error(rs.message);
    const noRs = rs.data.rujukan[0]?.noKunjungan ?? '';
    expect(rs.data.rujukan[0]?.provPerujuk.kode).toBe('0301R002');
    expect(
      (await h.vclaim(VCLAIM_ENDPOINTS.rujukanRsByNomor, vclaimRujukanResponseSchema, { noRujukan: noRs }))
        .ok,
    ).toBe(true);
    expect(
      await h.vclaim(VCLAIM_ENDPOINTS.rujukanByNomor, vclaimRujukanResponseSchema, { noRujukan: noRs }),
    ).toMatchObject({ ok: false, rejection: 'BPJS_RUJUKAN_TIDAK_DITEMUKAN' });
    expect(
      await h.vclaim(VCLAIM_ENDPOINTS.rujukanByNomor, vclaimRujukanResponseSchema, { noRujukan: 'ASING' }),
    ).toMatchObject({ ok: false, rejection: 'BPJS_RUJUKAN_TIDAK_DITEMUKAN' });
    expect(
      await h.vclaim(VCLAIM_ENDPOINTS.rujukanListByKartu, vclaimRujukanListResponseSchema, {
        noKartu: KARTU.tidakAda,
      }),
    ).toMatchObject({ ok: false, rejection: 'BPJS_PESERTA_TIDAK_DITEMUKAN' });
  });

  it('jumlah SEP per rujukan bertambah setelah SEP terbit', async () => {
    const { aktif } = await h.rujukanOf(KARTU.aktif);
    const jumlah = () =>
      h.vclaim(VCLAIM_ENDPOINTS.rujukanJumlahSep, vclaimJumlahSepResponseSchema, {
        jenisRujukan: '1',
        noRujukan: aktif,
      });
    expect(await jumlah()).toEqual({ ok: true, data: { jumlahSEP: '0' } });
    await terbitkanSep();
    expect(await jumlah()).toEqual({ ok: true, data: { jumlahSEP: '1' } });
    expect(
      await h.vclaim(VCLAIM_ENDPOINTS.rujukanJumlahSep, vclaimJumlahSepResponseSchema, {
        jenisRujukan: '3',
        noRujukan: aktif,
      }),
    ).toMatchObject({ ok: false, rejection: 'BPJS_VALIDASI' });
  });
});

describe('SEP 2.0', () => {
  it('terbit dengan nomor <PPK><MMYY>V<6 digit>, bisa dibaca detail dan histori', async () => {
    const r = await terbitkanSep();
    if (!r.ok) throw new Error(r.message);
    const sep = r.data.sep;
    expect(sep.noSep).toBe('0301R0011026V000001');
    expect(sep).toMatchObject({ tglSep: TODAY, jnsPelayanan: 'Rawat Jalan', poli: 'PENYAKIT DALAM' });
    expect(sep.diagnosa).toBe('I10 - Hipertensi esensial (primer)');

    const detail = await h.vclaim(VCLAIM_ENDPOINTS.sepByNomor, vclaimSepDetailSchema, { noSep: sep.noSep });
    expect(detail.ok && detail.data.dpjp).toEqual({
      kdDPJP: '99001',
      nmDPJP: 'dr. Andini Prameswari, Sp.PD',
    });

    const histori = await h.vclaim(VCLAIM_ENDPOINTS.historiPelayanan, vclaimHistoriResponseSchema, {
      noKartu: KARTU.aktif,
      tglMulai: TODAY,
      tglAkhir: TODAY,
    });
    expect(histori.ok && histori.data.histori.map((x) => x.noSep)).toEqual([sep.noSep]);
  });

  it('SEP ganda (kartu, tanggal, poli sama) ditolak 201; poli lain di hari sama boleh', async () => {
    expect((await terbitkanSep()).ok).toBe(true);
    const dup = await terbitkanSep();
    expect(dup).toMatchObject({ ok: false, code: '201', rejection: 'BPJS_SEP_GANDA' });
    const jantung = await terbitkanSep(KARTU.aktif, {
      poli: { tujuan: 'JAN', eksekutif: '0' },
      dpjpLayan: '99003',
    });
    expect(jantung.ok).toBe(true);
    expect([...h.state.bpjs.seps.values()].filter((s) => s.status === 'terbit')).toHaveLength(2);
  });

  it('menolak peserta tidak aktif/tidak ada, rujukan kedaluwarsa/milik orang lain, poli/DPJP salah, tanggal depan', async () => {
    const { aktif, kedaluwarsa } = await h.rujukanOf(KARTU.aktif);
    const send = (t: Parameters<typeof sepRawatJalan>[0]) =>
      h.vclaim(VCLAIM_ENDPOINTS.sepInsert, vclaimSepInsertResponseSchema, undefined, sepRawatJalan(t));
    const ruj = (noRujukan: string) => ({
      asalRujukan: '1' as const,
      tglRujukan: TODAY,
      noRujukan,
      ppkRujukan: '',
    });

    expect(await send({ noKartu: KARTU.tidakAktif, rujukan: ruj(aktif) })).toMatchObject({
      rejection: 'BPJS_PESERTA_TIDAK_AKTIF',
    });
    expect(await send({ noKartu: KARTU.tidakAda, rujukan: ruj(aktif) })).toMatchObject({
      rejection: 'BPJS_PESERTA_TIDAK_DITEMUKAN',
    });
    expect(await send({ noKartu: KARTU.aktif, rujukan: ruj(kedaluwarsa) })).toMatchObject({
      rejection: 'BPJS_RUJUKAN_KEDALUWARSA',
    });
    expect(await send({ noKartu: KARTU.aktif2, rujukan: ruj(aktif) })).toMatchObject({
      rejection: 'BPJS_RUJUKAN_BUKAN_PESERTA',
    });
    expect(await send({ noKartu: KARTU.aktif, rujukan: ruj('') })).toMatchObject({
      rejection: 'BPJS_RUJUKAN_TIDAK_DITEMUKAN',
    });
    expect(
      await send({ noKartu: KARTU.aktif, rujukan: ruj(aktif), poli: { tujuan: 'XYZ', eksekutif: '0' } }),
    ).toMatchObject({ rejection: 'BPJS_POLI_TIDAK_DITEMUKAN' });
    expect(await send({ noKartu: KARTU.aktif, rujukan: ruj(aktif), dpjpLayan: '99003' })).toMatchObject({
      rejection: 'BPJS_DOKTER_TIDAK_DITEMUKAN',
    });
    expect(
      await send({ noKartu: KARTU.aktif, rujukan: ruj(aktif), tglSep: bpjsAddDays(TODAY, 1) }),
    ).toMatchObject({ rejection: 'BPJS_TANGGAL_TIDAK_VALID' });
    expect(await send({ noKartu: KARTU.aktif, rujukan: ruj(aktif), diagAwal: 'hipertensi' })).toMatchObject({
      rejection: 'BPJS_VALIDASI',
    });
    expect(h.state.bpjs.seps.size).toBe(0);
  });

  it('kartu …1111 wajib rekam sidik jari dulu (status 0 → 1 lewat panel)', async () => {
    const status = () =>
      h.vclaim(VCLAIM_ENDPOINTS.fingerprintStatus, vclaimFingerprintResponseSchema, {
        noKartu: KARTU.sidikJari,
        tglPelayanan: TODAY,
      });
    expect(await status()).toMatchObject({ ok: true, data: { kode: '0' } });
    expect(await terbitkanSep(KARTU.sidikJari)).toMatchObject({ rejection: 'BPJS_FINGERPRINT_BELUM' });

    const fp = await h.app.inject({
      method: 'POST',
      url: '/_panel/api/bpjs/fingerprint',
      payload: { noKartu: KARTU.sidikJari },
    });
    expect(fp.json()).toEqual({ noKartu: KARTU.sidikJari, tanggal: TODAY, kode: '1' });
    expect(await status()).toMatchObject({ ok: true, data: { kode: '1' } });
    expect((await terbitkanSep(KARTU.sidikJari)).ok).toBe(true);

    const biasa = await h.vclaim(VCLAIM_ENDPOINTS.fingerprintStatus, vclaimFingerprintResponseSchema, {
      noKartu: KARTU.aktif,
      tglPelayanan: TODAY,
    });
    expect(biasa).toMatchObject({ ok: true, data: { kode: '1' } });
  });

  it('ubah lalu hapus: respons nomor SEP; setelah dihapus tidak ditemukan dan boleh terbit ulang', async () => {
    const r = await terbitkanSep();
    if (!r.ok) throw new Error(r.message);
    const noSep = r.data.sep.noSep;
    const t = sepRawatJalan({ noKartu: KARTU.aktif }).request.t_sep;
    const update = {
      request: {
        t_sep: {
          noSep,
          klsRawat: t.klsRawat,
          noMR: t.noMR,
          catatan: 'Diagnosa diperbaiki',
          diagAwal: 'E11.9',
          poli: t.poli,
          cob: t.cob,
          katarak: t.katarak,
          dpjpLayan: '99002',
          noTelp: t.noTelp,
          user: t.user,
        },
      },
    };
    expect(await h.vclaim(VCLAIM_ENDPOINTS.sepUpdate, vclaimNoSepResponseSchema, undefined, update)).toEqual({
      ok: true,
      data: noSep,
    });
    const detail = await h.vclaim(VCLAIM_ENDPOINTS.sepByNomor, vclaimSepDetailSchema, { noSep });
    expect(detail.ok && [detail.data.diagnosa, detail.data.dpjp.kdDPJP]).toEqual([
      'E11.9 - Diabetes melitus tipe 2 tanpa komplikasi',
      '99002',
    ]);
    expect(h.state.bpjs.seps.get(noSep)?.versi).toBe(2);

    const del = { request: { t_sep: { noSep, user: 'Petugas Fiktif' } } };
    expect(await h.vclaim(VCLAIM_ENDPOINTS.sepDelete, vclaimNoSepResponseSchema, undefined, del)).toEqual({
      ok: true,
      data: noSep,
    });
    expect(
      await h.vclaim(VCLAIM_ENDPOINTS.sepDelete, vclaimNoSepResponseSchema, undefined, del),
    ).toMatchObject({
      rejection: 'BPJS_SEP_TIDAK_DITEMUKAN',
    });
    expect(await h.vclaim(VCLAIM_ENDPOINTS.sepByNomor, vclaimSepDetailSchema, { noSep })).toMatchObject({
      rejection: 'BPJS_SEP_TIDAK_DITEMUKAN',
    });
    expect(
      await h.vclaim(VCLAIM_ENDPOINTS.sepUpdate, vclaimNoSepResponseSchema, undefined, update),
    ).toMatchObject({
      rejection: 'BPJS_SEP_TIDAK_DITEMUKAN',
    });
    const ulang = await terbitkanSep();
    expect(ulang.ok && ulang.data.sep.noSep).toBe('0301R0011026V000002');
  });
});

describe('rencana kontrol dan SPRI', () => {
  it('surat kontrol dari SEP: nomor K, sesuai jadwal HFIS, bisa dibaca, dipakai SEP kontrol', async () => {
    const sep = await terbitkanSep();
    if (!sep.ok) throw new Error(sep.message);
    const kontrol = (tglRencanaKontrol: string, kodeDokter = '99001', poliKontrol = 'INT') =>
      h.vclaim(VCLAIM_ENDPOINTS.rencanaKontrolInsert, vclaimRencanaKontrolResponseSchema, undefined, {
        request: {
          noSEP: sep.data.sep.noSep,
          kodeDokter,
          poliKontrol,
          tglRencanaKontrol,
          user: 'Petugas Fiktif',
        },
      });
    // Senin berikutnya: dr. Andini praktik.
    const ok = await kontrol('2026-10-12');
    if (!ok.ok) throw new Error(ok.message);
    expect(ok.data.noSuratKontrol).toBe('0301R0011026K000001');
    expect(ok.data.namaDiagnosa).toBe('I10 - Hipertensi esensial (primer)');

    const surat = await h.vclaim(VCLAIM_ENDPOINTS.suratKontrolByNomor, vclaimSuratKontrolSchema, {
      noSuratKontrol: ok.data.noSuratKontrol,
    });
    expect(surat.ok && surat.data).toMatchObject({
      jnsKontrol: '2',
      noSepAsal: sep.data.sep.noSep,
      poliTujuan: 'INT',
    });

    // Jumat: dr. Andini tidak praktik; tanggal lampau; DPJP poli lain; SEP tidak ada.
    expect(await kontrol('2026-10-09')).toMatchObject({ rejection: 'BPJS_JADWAL_TIDAK_DITEMUKAN' });
    expect(await kontrol('2026-10-01')).toMatchObject({ rejection: 'BPJS_TANGGAL_TIDAK_VALID' });
    expect(await kontrol('2026-10-12', '99003')).toMatchObject({ rejection: 'BPJS_DOKTER_TIDAK_DITEMUKAN' });
    // Libur dicatat di HFIS (panel) → ditolak.
    await h.app.inject({
      method: 'POST',
      url: '/_panel/api/bpjs/hfis',
      payload: { kodedokter: 99001, tanggal: '2026-10-13', libur: true },
    });
    expect(await kontrol('2026-10-13')).toMatchObject({ rejection: 'BPJS_JADWAL_LIBUR' });

    // Kunjungan kontrol memakai surat; surat asing ditolak.
    h.setNow(new Date('2026-10-12T01:00:00Z'));
    const { aktif } = await h.rujukanOf(KARTU.aktif);
    const kunjunganKontrol = (noSurat: string) =>
      h.vclaim(
        VCLAIM_ENDPOINTS.sepInsert,
        vclaimSepInsertResponseSchema,
        undefined,
        sepRawatJalan({
          noKartu: KARTU.aktif,
          tglSep: '2026-10-12',
          rujukan: { asalRujukan: '1', tglRujukan: TODAY, noRujukan: aktif, ppkRujukan: '' },
          skdp: { noSurat, kodeDPJP: '99001' },
        }),
      );
    expect(await kunjunganKontrol('0301R0011026K999999')).toMatchObject({
      rejection: 'BPJS_SURAT_TIDAK_DITEMUKAN',
    });
    expect((await kunjunganKontrol(ok.data.noSuratKontrol)).ok).toBe(true);
  });

  it('SPRI → SEP rawat inap; tanpa SPRI ditolak; rawat inap ganda di hari sama ditolak', async () => {
    const spri = await h.vclaim(VCLAIM_ENDPOINTS.spriInsert, vclaimSpriResponseSchema, undefined, {
      request: {
        noKartu: KARTU.aktif,
        kodeDokter: '99001',
        poliKontrol: 'INT',
        tglRencanaKontrol: TODAY,
        user: 'Petugas Fiktif',
      },
    });
    if (!spri.ok) throw new Error(spri.message);
    expect(spri.data.noSPRI).toMatch(/^0301R0011026K\d{6}$/);
    expect(spri.data.namaDiagnosa).toBeNull();

    const ri = (noSpri: string) =>
      h.vclaim(
        VCLAIM_ENDPOINTS.sepInsert,
        vclaimSepInsertResponseSchema,
        undefined,
        sepRawatInap(KARTU.aktif, noSpri),
      );
    expect(await ri('')).toMatchObject({ rejection: 'BPJS_SURAT_TIDAK_DITEMUKAN' });
    const ok = await ri(spri.data.noSPRI);
    expect(ok.ok && ok.data.sep.jnsPelayanan).toBe('Rawat Inap');
    expect(await ri(spri.data.noSPRI)).toMatchObject({ rejection: 'BPJS_SEP_GANDA' });

    const spriTidakAktif = {
      request: {
        noKartu: KARTU.tidakAktif,
        kodeDokter: '99001',
        poliKontrol: 'INT',
        tglRencanaKontrol: TODAY,
        user: 'Petugas Fiktif',
      },
    };
    expect(
      await h.vclaim(VCLAIM_ENDPOINTS.spriInsert, vclaimSpriResponseSchema, undefined, spriTidakAktif),
    ).toMatchObject({ rejection: 'BPJS_PESERTA_TIDAK_AKTIF' });
  });
});

describe('referensi dan histori', () => {
  it('referensi poli per kode/nama dan DPJP per poli', async () => {
    const ref = (param: string) => h.vclaim(VCLAIM_ENDPOINTS.refPoli, vclaimRefPoliResponseSchema, { param });
    expect(await ref('INT')).toEqual({ ok: true, data: { poli: [{ kode: 'INT', nama: 'PENYAKIT DALAM' }] } });
    expect(await ref('paru')).toEqual({ ok: true, data: { poli: [{ kode: 'PAR', nama: 'PARU' }] } });
    expect(await ref('XYZ')).toMatchObject({ rejection: 'BPJS_DATA_TIDAK_DITEMUKAN' });

    const dokter = await h.vclaim(VCLAIM_ENDPOINTS.refDokter, vclaimRefDokterResponseSchema, {
      jnsPelayanan: '2',
      tglPelayanan: RABU,
      kodeSpesialis: 'JAN',
    });
    expect(dokter.ok && dokter.data.list.map((d) => d.kode)).toEqual(['99003', '99004']);
  });

  it('histori kosong = data tidak ditemukan; rentang > 90 hari ditolak', async () => {
    const histori = (tglMulai: string, tglAkhir: string) =>
      h.vclaim(VCLAIM_ENDPOINTS.historiPelayanan, vclaimHistoriResponseSchema, {
        noKartu: KARTU.aktif,
        tglMulai,
        tglAkhir,
      });
    expect(await histori(TODAY, TODAY)).toMatchObject({ rejection: 'BPJS_DATA_TIDAK_DITEMUKAN' });
    expect(await histori('2026-01-01', TODAY)).toMatchObject({ rejection: 'BPJS_TANGGAL_TIDAK_VALID' });
  });
});
