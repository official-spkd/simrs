import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { bpjsEncryptResponse } from '../bpjs-crypto';
import {
  ANTREAN_ENDPOINTS,
  antreanAddRequestSchema,
  antreanNextTaskIds,
  antreanUpdateWaktuRequestSchema,
  checkAntreanTask,
  formatAntreanWaktu,
} from './antrean';
import {
  APLICARE_ENDPOINTS,
  aplicareBedListResponseSchema,
  aplicareBedRequestSchema,
  decodeAplicareResponse,
} from './aplicare';
import {
  BPJS_REJECTIONS,
  bpjsAddDays,
  bpjsDiffDays,
  bpjsPath,
  type BpjsRejectionKnownCode,
  bpjsRejectionMessage,
  classifyBpjsRejection,
} from './common';
import { decodeAntreanResponse, decodeVclaimResponse } from './decode';
import {
  HFIS_ENDPOINTS,
  hfisHariOf,
  hfisJamPraktek,
  hfisUpdateJadwalRequestSchema,
  parseHfisJadwal,
} from './hfis';
import {
  vclaimRujukanBerlakuSampai,
  vclaimRujukanKedaluwarsa,
  VCLAIM_ENDPOINTS,
  vclaimRujukanKeluarInsertRequestSchema,
  vclaimSepInsertRequestSchema,
  vclaimSepPulangRequestSchema,
} from './vclaim';

const creds = { consId: '10000', secretKey: 'mock-secret' };
const TS = '1759626000';

describe('path endpoint', () => {
  it('mengisi parameter, meng-encode nilai, dan menolak parameter kosong', () => {
    expect(
      bpjsPath(VCLAIM_ENDPOINTS.pesertaByKartu.path, { noKartu: '0000123456781', tglSEP: '2026-10-05' }),
    ).toBe('/Peserta/nokartu/0000123456781/tglSEP/2026-10-05');
    expect(bpjsPath(VCLAIM_ENDPOINTS.sepByNomor.path, { noSep: '../x?y' })).toBe('/SEP/..%2Fx%3Fy');
    expect(() => bpjsPath(VCLAIM_ENDPOINTS.sepByNomor.path, {})).toThrow(/noSep/);
    expect(() => bpjsPath(VCLAIM_ENDPOINTS.sepByNomor.path, { noSep: '' })).toThrow();
  });

  it('setiap endpoint diawali "/" dan nama parameternya unik', () => {
    for (const ep of [
      ...Object.values(VCLAIM_ENDPOINTS),
      ...Object.values(ANTREAN_ENDPOINTS),
      ...Object.values(HFIS_ENDPOINTS),
      ...Object.values(APLICARE_ENDPOINTS),
    ]) {
      expect(ep.path.startsWith('/')).toBe(true);
      const names = [...ep.path.matchAll(/:([A-Za-z]+)/g)].map((m) => m[1]);
      expect(new Set(names).size).toBe(names.length);
    }
  });
});

describe('penolakan bisnis', () => {
  it('pesan mock → kode internal yang sama, dengan atau tanpa rincian, tanpa beda huruf besar', () => {
    for (const code of Object.keys(BPJS_REJECTIONS) as BpjsRejectionKnownCode[]) {
      expect(classifyBpjsRejection(bpjsRejectionMessage(code))).toBe(code);
      expect(classifyBpjsRejection(bpjsRejectionMessage(code, 'rincian 123'))).toBe(code);
      expect(classifyBpjsRejection(bpjsRejectionMessage(code).toUpperCase())).toBe(code);
    }
    expect(classifyBpjsRejection('Server sedang sibuk')).toBe('BPJS_TIDAK_DIKENAL');
  });
});

describe('task ID antrean', () => {
  const t = (taskid: number, waktu = 1_000) => ({ taskid, waktu });

  it('task berikutnya: awal 1 atau 3, lalu tepat satu langkah sampai 7', () => {
    expect(antreanNextTaskIds([])).toEqual([1, 3]);
    expect(antreanNextTaskIds([1])).toEqual([2]);
    expect(antreanNextTaskIds([3, 4])).toEqual([5]);
    expect(antreanNextTaskIds([1, 2, 3, 4, 5, 6, 7])).toEqual([]);
  });

  it('aturan urutan: ganda, lompat, mundur, batal, sudah dilayani', () => {
    expect(checkAntreanTask([], t(1))).toBeNull();
    expect(checkAntreanTask([], t(3))).toBeNull();
    expect(checkAntreanTask([], t(2))).toBe('BPJS_TASK_TIDAK_BERURUTAN');
    expect(checkAntreanTask([t(1)], t(3))).toBe('BPJS_TASK_TIDAK_BERURUTAN');
    expect(checkAntreanTask([t(1)], t(1, 2_000))).toBe('BPJS_TASK_GANDA');
    expect(checkAntreanTask([t(1, 5_000)], t(2, 4_000))).toBe('BPJS_TASK_WAKTU_MUNDUR');
    expect(checkAntreanTask([t(1), t(2), t(3)], t(99, 2_000))).toBeNull();
    expect(checkAntreanTask([t(3), t(4)], t(99, 2_000))).toBe('BPJS_ANTREAN_SUDAH_DILAYANI');
    expect(checkAntreanTask([t(1), t(99)], t(2, 2_000))).toBe('BPJS_ANTREAN_SUDAH_BATAL');
    expect(checkAntreanTask([t(3), t(4), t(5)], t(6, 2_000))).toBeNull();
  });

  it('format waktu daftar task = WIB', () => {
    expect(formatAntreanWaktu(Date.UTC(2026, 9, 5, 1, 2, 3))).toBe('05-10-2026 08:02:03 WIB');
    expect(formatAntreanWaktu(Date.UTC(2026, 9, 5, 17, 0, 0))).toBe('06-10-2026 00:00:00 WIB');
  });

  it('updatewaktu hanya menerima task 1–7 dan 99 dengan waktu milidetik', () => {
    const base = { kodebooking: 'B-1', waktu: Date.UTC(2026, 9, 5) };
    expect(antreanUpdateWaktuRequestSchema.safeParse({ ...base, taskid: 7 }).success).toBe(true);
    expect(antreanUpdateWaktuRequestSchema.safeParse({ ...base, taskid: 99 }).success).toBe(true);
    expect(antreanUpdateWaktuRequestSchema.safeParse({ ...base, taskid: 8 }).success).toBe(false);
    expect(antreanUpdateWaktuRequestSchema.safeParse({ ...base, taskid: 1, waktu: 1759626000 }).success).toBe(
      false,
    );
  });
});

describe('tambah antrean', () => {
  const body = {
    kodebooking: '2610050117',
    jenispasien: 'JKN',
    nomorkartu: '0000123456781',
    nik: '9999010101900001',
    nohp: '081200001111',
    kodepoli: 'INT',
    namapoli: 'PENYAKIT DALAM',
    pasienbaru: 0,
    norm: '00-00-12-34',
    tanggalperiksa: '2026-10-05',
    kodedokter: 99001,
    namadokter: 'dr. Andini Prameswari, Sp.PD',
    jampraktek: '08:00-12:00',
    jeniskunjungan: 1,
    nomorreferensi: '9999P00112345678101',
    nomorantrean: 'PD-027',
    angkaantrean: 27,
    estimasidilayani: Date.UTC(2026, 9, 5, 2, 30),
    sisakuotajkn: 6,
    kuotajkn: 24,
    sisakuotanonjkn: 1,
    kuotanonjkn: 6,
    keterangan: '',
  };

  it('JKN wajib kartu dan referensi; non-JKN boleh kosong; sisa kuota ≤ kuota', () => {
    expect(antreanAddRequestSchema.safeParse(body).success).toBe(true);
    expect(antreanAddRequestSchema.safeParse({ ...body, nomorkartu: '' }).success).toBe(false);
    expect(antreanAddRequestSchema.safeParse({ ...body, nomorreferensi: '' }).success).toBe(false);
    expect(
      antreanAddRequestSchema.safeParse({
        ...body,
        jenispasien: 'NON JKN',
        nomorkartu: '',
        nomorreferensi: '',
      }).success,
    ).toBe(true);
    expect(antreanAddRequestSchema.safeParse({ ...body, sisakuotanonjkn: 7 }).success).toBe(false);
    expect(antreanAddRequestSchema.safeParse({ ...body, jampraktek: '08:00 - 12:00' }).success).toBe(false);
  });
});

describe('HFIS', () => {
  it('hari HFIS dari tanggal (1 Senin … 7 Minggu) dan format jam jadwal', () => {
    expect(hfisHariOf('2026-10-05')).toBe(1);
    expect(hfisHariOf('2026-10-07')).toBe(3);
    expect(hfisHariOf('2026-10-11')).toBe(7);
    expect(parseHfisJadwal('08:00 - 12:00')).toEqual({ buka: '08:00', tutup: '12:00' });
    expect(parseHfisJadwal('25:00 - 12:00')).toBeNull();
    expect(hfisJamPraktek('09:30 - 12:00')).toBe('09:30-12:00');
  });

  it('templat update: jam buka sebelum tutup, hari 1–8', () => {
    const ok = {
      kodepoli: 'JAN',
      kodesubspesialis: 'JAN',
      kodedokter: 99003,
      jadwal: [{ hari: '1', buka: '09:00', tutup: '12:00' }],
    };
    expect(hfisUpdateJadwalRequestSchema.safeParse(ok).success).toBe(true);
    expect(
      hfisUpdateJadwalRequestSchema.safeParse({
        ...ok,
        jadwal: [{ hari: '9', buka: '09:00', tutup: '12:00' }],
      }).success,
    ).toBe(false);
    expect(
      hfisUpdateJadwalRequestSchema.safeParse({
        ...ok,
        jadwal: [{ hari: '1', buka: '12:00', tutup: '09:00' }],
      }).success,
    ).toBe(false);
  });
});

describe('rujukan dan tanggal', () => {
  it('rujukan berlaku 90 hari sejak kunjungan', () => {
    expect(vclaimRujukanBerlakuSampai('2026-07-07')).toBe('2026-10-05');
    expect(vclaimRujukanKedaluwarsa('2026-07-07', '2026-10-05')).toBe(false);
    expect(vclaimRujukanKedaluwarsa('2026-07-07', '2026-10-06')).toBe(true);
    expect(bpjsAddDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(bpjsDiffDays('2026-10-05', '2026-10-12')).toBe(7);
  });

  it('SEP 2.0 insert menolak ICD-10 dan PPK yang tidak sah', () => {
    const tSep = {
      noKartu: '0000123456781',
      tglSep: '2026-10-05',
      ppkPelayanan: '0301R001',
      jnsPelayanan: '2',
      klsRawat: { klsRawatHak: '2', klsRawatNaik: '', pembiayaan: '', penanggungJawab: '' },
      noMR: '00-00-12-34',
      rujukan: {
        asalRujukan: '1',
        tglRujukan: '2026-09-20',
        noRujukan: '9999P00112345678101',
        ppkRujukan: '',
      },
      catatan: '',
      diagAwal: 'I10',
      poli: { tujuan: 'INT', eksekutif: '0' },
      cob: { cob: '0' },
      katarak: { katarak: '0' },
      jaminan: {
        lakaLantas: '0',
        noLP: '',
        penjamin: {
          tglKejadian: '',
          keterangan: '',
          suplesi: {
            suplesi: '0',
            noSepSuplesi: '',
            lokasiLaka: { kdPropinsi: '', kdKabupaten: '', kdKecamatan: '' },
          },
        },
      },
      tujuanKunj: '0',
      flagProcedure: '',
      kdPenunjang: '',
      assesmentPel: '',
      skdp: { noSurat: '', kodeDPJP: '' },
      dpjpLayan: '99001',
      noTelp: '081200001111',
      user: 'Petugas Fiktif',
    };
    const parse = (t: object) => vclaimSepInsertRequestSchema.safeParse({ request: { t_sep: t } }).success;
    expect(parse(tSep)).toBe(true);
    expect(parse({ ...tSep, diagAwal: 'I-10' })).toBe(false);
    expect(parse({ ...tSep, ppkPelayanan: '0301R01' })).toBe(false);
    expect(parse({ ...tSep, jnsPelayanan: '3' })).toBe(false);
  });
});

describe('dekode respons', () => {
  const schema = z.object({ peserta: z.object({ noKartu: z.string() }) });
  const data = { peserta: { noKartu: '0000123456781' } };

  it('VClaim: terenkripsi, polos, ditolak, dan tidak sesuai kontrak', () => {
    const enc = { metaData: { code: '200', message: 'OK' }, response: bpjsEncryptResponse(data, creds, TS) };
    expect(decodeVclaimResponse(enc, schema, creds, TS)).toEqual({ ok: true, data });
    expect(
      decodeVclaimResponse({ metaData: { code: '200', message: 'OK' }, response: data }, schema, creds, TS),
    ).toEqual({ ok: true, data });
    expect(decodeVclaimResponse(enc, schema, creds, '1759626001')).toMatchObject({
      ok: false,
      kind: 'invalid',
    });
    expect(
      decodeVclaimResponse(
        {
          metaData: { code: '201', message: bpjsRejectionMessage('BPJS_SEP_GANDA', 'poli INT') },
          response: null,
        },
        schema,
        creds,
        TS,
      ),
    ).toEqual({
      ok: false,
      kind: 'rejected',
      code: '201',
      message: 'Peserta sudah memiliki SEP: poli INT',
      rejection: 'BPJS_SEP_GANDA',
    });
    expect(decodeVclaimResponse({ metadata: { code: 200 } }, schema, creds, TS)).toMatchObject({
      kind: 'invalid',
    });
    expect(
      decodeVclaimResponse(
        { metaData: { code: '200', message: 'OK' }, response: { x: 1 } },
        schema,
        creds,
        TS,
      ),
    ).toMatchObject({ kind: 'invalid' });
  });

  it('Antrean: operasi tulis tanpa skema, data terenkripsi, dan penolakan berkode angka', () => {
    expect(decodeAntreanResponse({ metadata: { code: 200, message: 'Ok' } }, null, creds, TS)).toEqual({
      ok: true,
      data: undefined,
    });
    const list = [{ kodedokter: 99001 }];
    const enc = { metadata: { code: 200, message: 'Ok' }, response: bpjsEncryptResponse(list, creds, TS) };
    expect(decodeAntreanResponse(enc, z.array(z.object({ kodedokter: z.number() })), creds, TS)).toEqual({
      ok: true,
      data: list,
    });
    expect(
      decodeAntreanResponse(
        { metadata: { code: 201, message: bpjsRejectionMessage('BPJS_TASK_TIDAK_BERURUTAN', 'TaskId=3') } },
        null,
        creds,
        TS,
      ),
    ).toMatchObject({ ok: false, code: '201', rejection: 'BPJS_TASK_TIDAK_BERURUTAN' });
  });
});

describe('kontrak lanjutan VClaim', () => {
  it('SEP pulang: meninggal wajib nomor surat dan tanggal meninggal', () => {
    const t = {
      noSep: '0301R0011026V000001',
      statusPulang: '1',
      noSuratMeninggal: '',
      tglMeninggal: '',
      tglPulang: '2026-10-07',
      noLPManual: '',
      user: 'Petugas',
    };
    const parse = (x: object) => vclaimSepPulangRequestSchema.safeParse({ request: { t_sep: x } }).success;
    expect(parse(t)).toBe(true);
    expect(parse({ ...t, statusPulang: '4' })).toBe(false);
    expect(parse({ ...t, statusPulang: '4', noSuratMeninggal: 'SKM-1', tglMeninggal: '2026-10-07' })).toBe(
      true,
    );
    expect(parse({ ...t, statusPulang: '2' })).toBe(false);
  });

  it('rujukan keluar: PPK tujuan 8 karakter, ICD-10, tipe 0–2', () => {
    const t = {
      noSep: '0301R0011026V000001',
      tglRujukan: '2026-10-05',
      tglRencanaKunjungan: '2026-10-08',
      ppkDirujuk: '0301R003',
      jnsPelayanan: '2',
      catatan: '',
      diagRujukan: 'I20.0',
      tipeRujukan: '0',
      poliRujukan: 'JAN',
      user: 'Petugas',
    };
    const parse = (x: object) =>
      vclaimRujukanKeluarInsertRequestSchema.safeParse({ request: { t_rujukan: x } }).success;
    expect(parse(t)).toBe(true);
    expect(parse({ ...t, ppkDirujuk: 'RS3' })).toBe(false);
    expect(parse({ ...t, diagRujukan: 'angina' })).toBe(false);
    expect(parse({ ...t, tipeRujukan: '3' })).toBe(false);
  });
});

describe('Aplicare', () => {
  const bed = {
    kodekelas: 'KL1',
    koderuang: 'ANGGREK',
    namaruang: 'Bangsal Anggrek',
    kapasitas: '40',
    tersedia: 7,
    tersediapria: '3',
    tersediawanita: 4,
    tersediapriawanita: 0,
  };

  it('angka bed boleh string angka; tersedia ≤ kapasitas; rincian ≤ tersedia', () => {
    const r = aplicareBedRequestSchema.safeParse(bed);
    expect(r.success && r.data).toMatchObject({ kapasitas: 40, tersediapria: 3 });
    expect(aplicareBedRequestSchema.safeParse({ ...bed, tersedia: 41 }).success).toBe(false);
    expect(aplicareBedRequestSchema.safeParse({ ...bed, tersediapriawanita: 1 }).success).toBe(false);
    expect(aplicareBedRequestSchema.safeParse({ ...bed, kapasitas: 'empat' }).success).toBe(false);
  });

  it('dekode: sukses kode 1 (+ totalitems), penolakan terklasifikasi, amplop asing', () => {
    expect(decodeAplicareResponse({ metadata: { code: 1, message: 'OK' } }, null)).toEqual({
      ok: true,
      data: undefined,
    });
    expect(
      decodeAplicareResponse(
        { metadata: { code: 1, message: 'OK', totalitems: 0 }, response: { list: [] } },
        aplicareBedListResponseSchema,
      ),
    ).toEqual({ ok: true, data: { list: [] }, totalitems: 0 });
    expect(
      decodeAplicareResponse(
        { metadata: { code: 0, message: bpjsRejectionMessage('BPJS_RUANG_GANDA', 'KL1/A') } },
        null,
      ),
    ).toMatchObject({ ok: false, code: '0', rejection: 'BPJS_RUANG_GANDA' });
    expect(decodeAplicareResponse({ metaData: { code: '200' } }, null)).toMatchObject({ kind: 'invalid' });
    expect(
      decodeAplicareResponse(
        { metadata: { code: 1, message: 'OK' }, response: { x: 1 } },
        aplicareBedListResponseSchema,
      ),
    ).toMatchObject({ kind: 'invalid' });
  });
});
