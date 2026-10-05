import { readFileSync } from 'node:fs';
import {
  VCLAIM_ENDPOINTS,
  vclaimHistoriResponseSchema,
  vclaimNoRujukanResponseSchema,
  vclaimNoSepResponseSchema,
  vclaimNoSuratResponseSchema,
  vclaimRefDiagnosaResponseSchema,
  vclaimRefFaskesResponseSchema,
  vclaimRencanaKontrolResponseSchema,
  vclaimRujukanKeluarResponseSchema,
  vclaimSepInsertResponseSchema,
  vclaimSpriResponseSchema,
  vclaimSuratKontrolSchema,
  type VclaimRujukanKeluarTRujukan,
} from '@simrs/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MOCK_DIAGNOSA } from './master';
import { createHarness, type Harness, KARTU, sepRawatInap, sepRawatJalan, TODAY } from './test-kit';

/** VClaim lanjutan (fase 2/3): SEP pulang, ubah/hapus surat, rujukan keluar (F07), referensi diagnosa + faskes. */

let h: Harness;

beforeEach(() => {
  h = createHarness();
});

afterEach(async () => {
  await h.app.close();
});

async function sepRj(noKartu: string = KARTU.aktif) {
  const { aktif } = await h.rujukanOf(noKartu);
  const r = await h.vclaim(
    VCLAIM_ENDPOINTS.sepInsert,
    vclaimSepInsertResponseSchema,
    undefined,
    sepRawatJalan({
      noKartu,
      rujukan: { asalRujukan: '1', tglRujukan: TODAY, noRujukan: aktif, ppkRujukan: '' },
    }),
  );
  if (!r.ok) throw new Error(r.message);
  return r.data.sep.noSep;
}

async function spri(tgl: string = TODAY) {
  const r = await h.vclaim(VCLAIM_ENDPOINTS.spriInsert, vclaimSpriResponseSchema, undefined, {
    request: {
      noKartu: KARTU.aktif,
      kodeDokter: '99001',
      poliKontrol: 'INT',
      tglRencanaKontrol: tgl,
      user: 'Petugas',
    },
  });
  if (!r.ok) throw new Error(r.message);
  return r.data.noSPRI;
}

const sepRi = (noSpri: string, tglSep: string = TODAY) =>
  h.vclaim(
    VCLAIM_ENDPOINTS.sepInsert,
    vclaimSepInsertResponseSchema,
    undefined,
    sepRawatInap(KARTU.aktif, noSpri, tglSep),
  );

const pulang = (noSep: string, t: Record<string, string> = {}) =>
  h.vclaim(VCLAIM_ENDPOINTS.sepUpdateTglPulang, vclaimNoSepResponseSchema, undefined, {
    request: {
      t_sep: {
        noSep,
        statusPulang: '1',
        noSuratMeninggal: '',
        tglMeninggal: '',
        tglPulang: TODAY,
        noLPManual: '',
        user: 'Petugas',
        ...t,
      },
    },
  });

describe('SEP pulang (updtglplg)', () => {
  it('rawat inap belum pulang menahan SEP rawat inap baru; setelah pulang boleh lagi', async () => {
    const first = await sepRi(await spri());
    if (!first.ok) throw new Error(first.message);
    const noSep = first.data.sep.noSep;

    h.setNow(new Date('2026-10-07T01:00:00Z'));
    const spri2 = await spri('2026-10-07');
    expect(await sepRi(spri2, '2026-10-07')).toMatchObject({ rejection: 'BPJS_SEP_GANDA' });

    expect(await pulang(noSep, { tglPulang: '2026-10-04' })).toMatchObject({
      rejection: 'BPJS_TANGGAL_TIDAK_VALID',
    });
    expect(await pulang(noSep, { tglPulang: '2026-10-08' })).toMatchObject({
      rejection: 'BPJS_TANGGAL_TIDAK_VALID',
    });
    expect(await pulang(noSep, { statusPulang: '4' })).toMatchObject({ rejection: 'BPJS_VALIDASI' });
    expect(await pulang(noSep, { tglPulang: '2026-10-07' })).toEqual({ ok: true, data: noSep });
    expect(h.state.bpjs.seps.get(noSep)?.pulang).toMatchObject({
      tglPulang: '2026-10-07',
      statusPulang: '1',
    });

    const histori = await h.vclaim(VCLAIM_ENDPOINTS.historiPelayanan, vclaimHistoriResponseSchema, {
      noKartu: KARTU.aktif,
      tglMulai: TODAY,
      tglAkhir: '2026-10-07',
    });
    expect(histori.ok && histori.data.histori[0]?.tglPlgSep).toBe('2026-10-07');
    expect((await sepRi(spri2, '2026-10-07')).ok).toBe(true);
  });

  it('meninggal wajib surat + tanggal; SEP rawat jalan dan SEP tak dikenal ditolak', async () => {
    const ri = await sepRi(await spri());
    if (!ri.ok) throw new Error(ri.message);
    expect(
      await pulang(ri.data.sep.noSep, {
        statusPulang: '4',
        noSuratMeninggal: 'SKM-001',
        tglMeninggal: TODAY,
      }),
    ).toEqual({ ok: true, data: ri.data.sep.noSep });
    expect(await pulang(await sepRj())).toMatchObject({ rejection: 'BPJS_SEP_BUKAN_RAWAT_INAP' });
    expect(await pulang('0301R0011026V999999')).toMatchObject({ rejection: 'BPJS_SEP_TIDAK_DITEMUKAN' });
  });
});

describe('ubah dan hapus rencana kontrol / SPRI', () => {
  it('surat kontrol bisa diubah selama belum dipakai, lalu dihapus (setelah itu tidak ditemukan)', async () => {
    const noSep = await sepRj();
    const ins = await h.vclaim(
      VCLAIM_ENDPOINTS.rencanaKontrolInsert,
      vclaimRencanaKontrolResponseSchema,
      undefined,
      {
        request: {
          noSEP: noSep,
          kodeDokter: '99001',
          poliKontrol: 'INT',
          tglRencanaKontrol: '2026-10-12',
          user: 'x',
        },
      },
    );
    if (!ins.ok) throw new Error(ins.message);
    const no = ins.data.noSuratKontrol;
    const update = (t: Record<string, string>) =>
      h.vclaim(VCLAIM_ENDPOINTS.rencanaKontrolUpdate, vclaimRencanaKontrolResponseSchema, undefined, {
        request: {
          noSuratKontrol: no,
          noSEP: noSep,
          kodeDokter: '99001',
          poliKontrol: 'INT',
          tglRencanaKontrol: '2026-10-13',
          user: 'x',
          ...t,
        },
      });
    const ok = await update({});
    expect(ok.ok && ok.data).toMatchObject({ noSuratKontrol: no, tglRencanaKontrol: '2026-10-13' });
    expect(await update({ tglRencanaKontrol: '2026-10-09' })).toMatchObject({
      rejection: 'BPJS_JADWAL_TIDAK_DITEMUKAN',
    });
    expect(await update({ noSEP: '0301R0011026V999999' })).toMatchObject({
      rejection: 'BPJS_SEP_TIDAK_DITEMUKAN',
    });

    const del = () =>
      h.vclaim(VCLAIM_ENDPOINTS.rencanaKontrolDelete, vclaimNoSuratResponseSchema, undefined, {
        request: { t_suratkontrol: { noSuratKontrol: no, user: 'x' } },
      });
    expect(await del()).toEqual({ ok: true, data: no });
    expect(await del()).toMatchObject({ rejection: 'BPJS_SURAT_TIDAK_DITEMUKAN' });
    expect(
      await h.vclaim(VCLAIM_ENDPOINTS.suratKontrolByNomor, vclaimSuratKontrolSchema, { noSuratKontrol: no }),
    ).toMatchObject({ rejection: 'BPJS_SURAT_TIDAK_DITEMUKAN' });
    expect(await update({})).toMatchObject({ rejection: 'BPJS_SURAT_TIDAK_DITEMUKAN' });
  });

  it('SPRI bisa diubah sebelum dipakai SEP; setelah dipakai tidak bisa diubah atau dihapus', async () => {
    const no = await spri();
    const update = () =>
      h.vclaim(VCLAIM_ENDPOINTS.spriUpdate, vclaimSpriResponseSchema, undefined, {
        request: {
          noSPRI: no,
          kodeDokter: '99002',
          poliKontrol: 'INT',
          tglRencanaKontrol: '2026-10-07',
          user: 'x',
        },
      });
    const ok = await update();
    expect(ok.ok && ok.data).toMatchObject({ noSPRI: no, namaDokter: 'dr. Rahmat Hidayat, Sp.PD' });
    expect((await sepRi(no)).ok).toBe(true);
    expect(await update()).toMatchObject({ rejection: 'BPJS_SURAT_SUDAH_DIPAKAI' });
    expect(
      await h.vclaim(VCLAIM_ENDPOINTS.rencanaKontrolDelete, vclaimNoSuratResponseSchema, undefined, {
        request: { t_suratkontrol: { noSuratKontrol: no, user: 'x' } },
      }),
    ).toMatchObject({ rejection: 'BPJS_SURAT_SUDAH_DIPAKAI' });
  });
});

describe('rujukan keluar (F07)', () => {
  const isi = (noSep: string, t: Partial<VclaimRujukanKeluarTRujukan> = {}) => ({
    request: {
      t_rujukan: {
        noSep,
        tglRujukan: TODAY,
        tglRencanaKunjungan: '2026-10-08',
        ppkDirujuk: '0301R003',
        jnsPelayanan: '2',
        catatan: 'Mohon evaluasi lanjutan',
        diagRujukan: 'I20.0',
        tipeRujukan: '0',
        poliRujukan: 'JAN',
        user: 'Petugas',
        ...t,
      },
    },
  });
  const insert = (body: object) =>
    h.vclaim(VCLAIM_ENDPOINTS.rujukanKeluarInsert, vclaimRujukanKeluarResponseSchema, undefined, body);

  it('terbit dari SEP, bisa dibaca, diubah, dan dihapus', async () => {
    const noSep = await sepRj();
    const r = await insert(isi(noSep));
    if (!r.ok) throw new Error(r.message);
    const rujukan = r.data.rujukan;
    expect(rujukan).toMatchObject({
      noRujukan: '0301R0011026B000001',
      noSep,
      tglBerlakuKunjungan: '2027-01-03',
      AsalRujukan: { kode: '0301R001', nama: 'RS FIKTIF ANDALAS' },
      tujuanRujukan: { kode: '0301R003' },
      poliTujuan: { kode: 'JAN', nama: 'JANTUNG' },
      diagnosa: { kode: 'I20.0', nama: 'Angina tidak stabil' },
      tipeRujukan: { kode: '0', nama: 'Penuh' },
    });
    const byNo = () =>
      h.vclaim(VCLAIM_ENDPOINTS.rujukanKeluarByNomor, vclaimRujukanKeluarResponseSchema, {
        noRujukan: rujukan.noRujukan,
      });
    expect((await byNo()).ok).toBe(true);

    const { noSep: _n, ...t } = isi(noSep).request.t_rujukan;
    const upd = await h.vclaim(
      VCLAIM_ENDPOINTS.rujukanKeluarUpdate,
      vclaimNoRujukanResponseSchema,
      undefined,
      {
        request: {
          t_rujukan: { ...t, noRujukan: rujukan.noRujukan, ppkDirujuk: '0301R002', tipeRujukan: '1' },
        },
      },
    );
    expect(upd).toEqual({ ok: true, data: rujukan.noRujukan });
    const after = await byNo();
    expect(after.ok && after.data.rujukan.tujuanRujukan).toEqual({
      kode: '0301R002',
      nama: 'RS FIKTIF BAHARI',
    });

    const del = () =>
      h.vclaim(VCLAIM_ENDPOINTS.rujukanKeluarDelete, vclaimNoRujukanResponseSchema, undefined, {
        request: { t_rujukan: { noRujukan: rujukan.noRujukan, user: 'Petugas' } },
      });
    expect(await del()).toEqual({ ok: true, data: rujukan.noRujukan });
    expect(await del()).toMatchObject({ rejection: 'BPJS_RUJUKAN_TIDAK_DITEMUKAN' });
    expect(await byNo()).toMatchObject({ rejection: 'BPJS_RUJUKAN_TIDAK_DITEMUKAN' });
  });

  it('menolak SEP/faskes tak dikenal, tujuan yang salah jenis atau RS sendiri, poli kosong, tanggal di luar batas', async () => {
    const noSep = await sepRj();
    expect(await insert(isi('0301R0011026V999999'))).toMatchObject({ rejection: 'BPJS_SEP_TIDAK_DITEMUKAN' });
    expect(await insert(isi(noSep, { ppkDirujuk: '9999R999' }))).toMatchObject({
      rejection: 'BPJS_FASKES_TIDAK_DITEMUKAN',
    });
    expect(await insert(isi(noSep, { ppkDirujuk: '0301R001' }))).toMatchObject({
      rejection: 'BPJS_VALIDASI',
    });
    expect(await insert(isi(noSep, { tipeRujukan: '2' }))).toMatchObject({ rejection: 'BPJS_VALIDASI' });
    expect(await insert(isi(noSep, { ppkDirujuk: '9999P001' }))).toMatchObject({
      rejection: 'BPJS_VALIDASI',
    });
    expect(await insert(isi(noSep, { poliRujukan: '' }))).toMatchObject({
      rejection: 'BPJS_POLI_TIDAK_DITEMUKAN',
    });
    expect(await insert(isi(noSep, { tglRencanaKunjungan: '2027-02-01' }))).toMatchObject({
      rejection: 'BPJS_TANGGAL_TIDAK_VALID',
    });
    expect(await insert(isi(noSep, { tglRujukan: '2026-10-04' }))).toMatchObject({
      rejection: 'BPJS_TANGGAL_TIDAK_VALID',
    });
    // Rujuk balik ke FKTP tanpa poli: sah.
    const balik = await insert(isi(noSep, { tipeRujukan: '2', ppkDirujuk: '9999P001', poliRujukan: '' }));
    expect(balik.ok && balik.data.rujukan.tujuanRujukan.nama).toBe('PUSKESMAS FIKTIF SATU');
  });
});

describe('referensi diagnosa dan faskes', () => {
  it('diagnosa hanya dari contoh ICD-10 seed (sama persis dengan SEED_REF_SAMPLES.icd10)', async () => {
    const seed = readFileSync(new URL('../../../../../packages/db/src/seed-ref.ts', import.meta.url), 'utf8');
    const block = seed.slice(seed.indexOf('icd10: ['), seed.indexOf('icd9cm: ['));
    const fromSeed = Object.fromEntries(
      [...block.matchAll(/\{ code: '([^']+)', display: '([^']+)' \}/g)].map((m) => [m[1], m[2]]),
    );
    expect(Object.keys(fromSeed).length).toBeGreaterThan(20);
    expect(MOCK_DIAGNOSA).toEqual(fromSeed);

    const ref = (param: string) =>
      h.vclaim(VCLAIM_ENDPOINTS.refDiagnosa, vclaimRefDiagnosaResponseSchema, { param });
    expect(await ref('I10')).toEqual({
      ok: true,
      data: { diagnosa: [{ kode: 'I10', nama: 'Hipertensi esensial (primer)' }] },
    });
    const pneumonia = await ref('pneumonia');
    expect(pneumonia.ok && pneumonia.data.diagnosa.map((d) => d.kode)).toEqual(['J13', 'J18.9']);
    expect(await ref('X99')).toMatchObject({ rejection: 'BPJS_DATA_TIDAK_DITEMUKAN' });
  });

  it('faskes FKTP/RS dari fixture dan tenant seed; jenis salah ditolak', async () => {
    const ref = (param: string, jenisFaskes: string) =>
      h.vclaim(VCLAIM_ENDPOINTS.refFaskes, vclaimRefFaskesResponseSchema, { param, jenisFaskes });
    const fktp = await ref('fiktif', '1');
    expect(fktp.ok && fktp.data.faskes.map((f) => f.kode)).toEqual(['9999P001', '9999P002']);
    expect(await ref('0301R003', '2')).toEqual({
      ok: true,
      data: { faskes: [{ kode: '0301R003', nama: 'RSUPN DR. CIPTO MANGUNKUSUMO' }] },
    });
    expect(await ref('0301R003', '1')).toMatchObject({ rejection: 'BPJS_DATA_TIDAK_DITEMUKAN' });
    expect(await ref('rs', '3')).toMatchObject({ rejection: 'BPJS_VALIDASI' });
  });
});
