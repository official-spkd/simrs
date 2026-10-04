import {
  bpjsDateSchema,
  bpjsDiffDays,
  VCLAIM_JENIS_PELAYANAN,
  VCLAIM_JENIS_SURAT,
  VCLAIM_ASAL_RUJUKAN,
  vclaimRujukanKedaluwarsa,
  VCLAIM_ENDPOINTS,
  type VclaimHistori,
  type VclaimPeserta,
  type VclaimRencanaKontrolResponse,
  vclaimRencanaKontrolRequestSchema,
  type VclaimSep,
  type VclaimSepDetail,
  vclaimSepDeleteRequestSchema,
  vclaimSepInsertRequestSchema,
  vclaimSepUpdateRequestSchema,
  type VclaimSpriResponse,
  vclaimSpriRequestSchema,
  type VclaimSuratKontrol,
  VCLAIM_JENIS_FASKES,
  vclaimRencanaKontrolDeleteRequestSchema,
  vclaimRencanaKontrolUpdateRequestSchema,
  vclaimSepPulangRequestSchema,
  vclaimSpriUpdateRequestSchema,
} from '@simrs/shared';
import type { FastifyInstance } from 'fastify';
import { type BpjsContext, mmyy, vclaimFail, zodDetail } from './context';
import { hfisJadwalOn } from './hfis';
import {
  diagnosaLabel,
  dokterByKode,
  MOCK_DIAGNOSA,
  MOCK_DOKTER,
  MOCK_FASKES,
  MOCK_POLI,
  poliByKode,
} from './master';
import { needsFingerprint, pesertaAktif, pesertaByKartu, pesertaByNik } from './peserta';
import { buildRujukan, type JenisRujukan, parseNoRujukan, rujukanNumbersFor } from './rujukan';
import type { SepRecord, SuratRecord } from './state';

/** Batas tanggal rencana kontrol/SPRI dan rentang histori (hari). */
const MAKS_HARI_KE_DEPAN = 90;
const MAKS_RENTANG_HISTORI = 90;

const TUJUAN_KUNJ: Readonly<Record<string, string>> = {
  '0': 'Normal',
  '1': 'Prosedur',
  '2': 'Konsul Dokter',
};

const isDate = (v: string) => bpjsDateSchema.safeParse(v).success;
const isKartu = (v: string) => /^\d{13}$/.test(v);

function sepView(rec: SepRecord): VclaimSep {
  const t = rec.tSep;
  const p = rec.peserta;
  return {
    noSep: rec.noSep,
    tglSep: t.tglSep,
    jnsPelayanan: t.jnsPelayanan === VCLAIM_JENIS_PELAYANAN.rawatInap ? 'Rawat Inap' : 'Rawat Jalan',
    kelasRawat: t.klsRawat.klsRawatHak,
    diagnosa: diagnosaLabel(t.diagAwal),
    noRujukan: t.rujukan.noRujukan,
    poli: poliByKode(t.poli.tujuan)?.nama ?? '-',
    poliEksekutif: t.poli.eksekutif === '1' ? 'Ya' : 'Tidak',
    catatan: t.catatan,
    penjamin: null,
    peserta: {
      noKartu: p.noKartu,
      nama: p.nama,
      tglLahir: p.tglLahir,
      kelamin: p.sex === 'L' ? 'Laki-Laki' : 'Perempuan',
      jnsPeserta: p.jenisPeserta.keterangan,
      hakKelas: `Kelas ${t.klsRawat.klsRawatHak}`,
      noMr: t.noMR,
      asuransi: null,
    },
    informasi: { dinsos: null, prolanisPRB: null, noSKTM: null, eSEP: null },
  };
}

function sepDetail(rec: SepRecord, surat: SuratRecord | undefined): VclaimSepDetail {
  const kodeDpjp = rec.tSep.dpjpLayan || surat?.kodeDokter || '';
  return {
    ...sepView(rec),
    dpjp: { kdDPJP: kodeDpjp, nmDPJP: dokterByKode(kodeDpjp)?.nama ?? '' },
    kontrolinap: { noSurat: surat?.noSurat ?? '', tglSurat: surat?.tglTerbit ?? '' },
    tujuanKunj: { kode: rec.tSep.tujuanKunj, nama: TUJUAN_KUNJ[rec.tSep.tujuanKunj] ?? '' },
  };
}

export function registerVclaim(app: FastifyInstance, ctx: BpjsContext): void {
  const { state, config } = ctx;
  const bpjs = state.bpjs;
  const now = () => config.now().toISOString();

  // --- Peserta -------------------------------------------------------------------------------------------------

  function pesertaLookup(lookup: 'kartu' | 'nik', id: string, tgl: string) {
    const okId = lookup === 'kartu' ? isKartu(id) : /^\d{16}$/.test(id);
    if (!okId) {
      return vclaimFail(
        'BPJS_VALIDASI',
        lookup === 'kartu' ? 'No. kartu harus 13 digit' : 'NIK harus 16 digit',
      );
    }
    if (!isDate(tgl)) return vclaimFail('BPJS_VALIDASI', 'tglSEP harus YYYY-MM-DD');
    const today = ctx.today();
    const peserta =
      lookup === 'kartu' ? pesertaByKartu(bpjs, id, tgl, today) : pesertaByNik(bpjs, id, tgl, today);
    return peserta ? { peserta } : vclaimFail('BPJS_PESERTA_TIDAK_DITEMUKAN');
  }

  app.get<{ Params: { noKartu: string; tglSEP: string } }>(
    VCLAIM_ENDPOINTS.pesertaByKartu.path,
    async (req) => {
      const r = pesertaLookup('kartu', req.params.noKartu, req.params.tglSEP);
      return 'peserta' in r ? ctx.vclaimOk(req, r) : r;
    },
  );

  app.get<{ Params: { nik: string; tglSEP: string } }>(VCLAIM_ENDPOINTS.pesertaByNik.path, async (req) => {
    const r = pesertaLookup('nik', req.params.nik, req.params.tglSEP);
    return 'peserta' in r ? ctx.vclaimOk(req, r) : r;
  });

  // --- Rujukan -------------------------------------------------------------------------------------------------

  function rujukanByNomor(noRujukan: string, jenis: JenisRujukan) {
    const parsed = parseNoRujukan(noRujukan);
    if (!parsed || parsed.jenis !== jenis) return null;
    const today = ctx.today();
    const peserta = pesertaByKartu(bpjs, parsed.noKartu, today, today);
    return peserta ? buildRujukan(parsed, peserta, today) : null;
  }

  function rujukanList(noKartu: string, jenis: JenisRujukan) {
    if (!isKartu(noKartu)) return vclaimFail('BPJS_VALIDASI', 'No. kartu harus 13 digit');
    const today = ctx.today();
    const peserta = pesertaByKartu(bpjs, noKartu, today, today);
    if (!peserta) return vclaimFail('BPJS_PESERTA_TIDAK_DITEMUKAN');
    return {
      rujukan: rujukanNumbersFor(peserta, jenis).map((no) => {
        const parsed = parseNoRujukan(no);
        if (!parsed) throw new Error(`Nomor rujukan mock tidak sah: ${no}`);
        return buildRujukan(parsed, peserta, today);
      }),
    };
  }

  for (const [path, jenis] of [
    [VCLAIM_ENDPOINTS.rujukanByNomor.path, 'fktp'],
    [VCLAIM_ENDPOINTS.rujukanRsByNomor.path, 'rs'],
  ] as const) {
    app.get<{ Params: { noRujukan: string } }>(path, async (req) => {
      const rujukan = rujukanByNomor(req.params.noRujukan, jenis);
      return rujukan ? ctx.vclaimOk(req, { rujukan }) : vclaimFail('BPJS_RUJUKAN_TIDAK_DITEMUKAN');
    });
  }

  for (const [path, jenis] of [
    [VCLAIM_ENDPOINTS.rujukanListByKartu.path, 'fktp'],
    [VCLAIM_ENDPOINTS.rujukanRsListByKartu.path, 'rs'],
  ] as const) {
    app.get<{ Params: { noKartu: string } }>(path, async (req) => {
      const r = rujukanList(req.params.noKartu, jenis);
      return 'rujukan' in r ? ctx.vclaimOk(req, r) : r;
    });
  }

  app.get<{ Params: { jenisRujukan: string; noRujukan: string } }>(
    VCLAIM_ENDPOINTS.rujukanJumlahSep.path,
    async (req) => {
      const { jenisRujukan, noRujukan } = req.params;
      if (jenisRujukan !== VCLAIM_ASAL_RUJUKAN.fktp && jenisRujukan !== VCLAIM_ASAL_RUJUKAN.rs) {
        return vclaimFail('BPJS_VALIDASI', 'jenisRujukan harus 1 (FKTP) atau 2 (RS)');
      }
      const jenis: JenisRujukan = jenisRujukan === VCLAIM_ASAL_RUJUKAN.fktp ? 'fktp' : 'rs';
      if (!rujukanByNomor(noRujukan, jenis)) return vclaimFail('BPJS_RUJUKAN_TIDAK_DITEMUKAN');
      const jumlah = [...bpjs.seps.values()].filter(
        (s) => s.status === 'terbit' && s.tSep.rujukan.noRujukan === noRujukan,
      ).length;
      return ctx.vclaimOk(req, { jumlahSEP: String(jumlah) });
    },
  );

  // --- SEP 2.0 -------------------------------------------------------------------------------------------------

  app.post(VCLAIM_ENDPOINTS.sepInsert.path, async (req) => {
    const parsed = vclaimSepInsertRequestSchema.safeParse(req.body);
    if (!parsed.success) return vclaimFail('BPJS_VALIDASI', zodDetail(parsed.error));
    const t = parsed.data.request.t_sep;
    const today = ctx.today();
    if (t.tglSep > today) return vclaimFail('BPJS_TANGGAL_TIDAK_VALID', 'tglSep melewati hari ini');

    const peserta = pesertaByKartu(bpjs, t.noKartu, t.tglSep, today);
    if (!peserta) return vclaimFail('BPJS_PESERTA_TIDAK_DITEMUKAN');
    if (!pesertaAktif(peserta))
      return vclaimFail('BPJS_PESERTA_TIDAK_AKTIF', peserta.statusPeserta.keterangan);

    const terbit = [...bpjs.seps.values()].filter(
      (s) =>
        s.status === 'terbit' &&
        s.tSep.noKartu === t.noKartu &&
        s.tSep.tglSep === t.tglSep &&
        s.tSep.jnsPelayanan === t.jnsPelayanan,
    );

    if (t.jnsPelayanan === VCLAIM_JENIS_PELAYANAN.rawatJalan) {
      const poli = poliByKode(t.poli.tujuan);
      if (!poli) return vclaimFail('BPJS_POLI_TIDAK_DITEMUKAN', t.poli.tujuan || 'poli.tujuan kosong');
      const dpjp = dokterByKode(t.dpjpLayan);
      if (!dpjp || dpjp.kodepoli !== poli.kode) {
        return vclaimFail(
          'BPJS_DOKTER_TIDAK_DITEMUKAN',
          `dpjpLayan ${t.dpjpLayan || '-'} di poli ${poli.kode}`,
        );
      }
      const ruj = parseNoRujukan(t.rujukan.noRujukan);
      if (!ruj) return vclaimFail('BPJS_RUJUKAN_TIDAK_DITEMUKAN', t.rujukan.noRujukan || 'noRujukan kosong');
      if (ruj.noKartu !== t.noKartu) return vclaimFail('BPJS_RUJUKAN_BUKAN_PESERTA');
      const rujukan = buildRujukan(ruj, peserta, today);
      if (vclaimRujukanKedaluwarsa(rujukan.tglKunjungan, t.tglSep)) {
        return vclaimFail('BPJS_RUJUKAN_KEDALUWARSA', `kunjungan ${rujukan.tglKunjungan}`);
      }
      if (t.skdp.noSurat) {
        const surat = bpjs.surat.get(t.skdp.noSurat);
        if (!surat || surat.status !== 'aktif' || surat.jenis !== 'kontrol' || surat.noKartu !== t.noKartu) {
          return vclaimFail('BPJS_SURAT_TIDAK_DITEMUKAN', t.skdp.noSurat);
        }
      }
      if (needsFingerprint(t.noKartu) && !bpjs.fingerprints.has(`${t.noKartu}|${t.tglSep}`)) {
        return vclaimFail('BPJS_FINGERPRINT_BELUM');
      }
      if (terbit.some((s) => s.tSep.poli.tujuan === poli.kode)) {
        return vclaimFail('BPJS_SEP_GANDA', `rawat jalan poli ${poli.kode} tanggal ${t.tglSep}`);
      }
    } else {
      const spri = bpjs.surat.get(t.skdp.noSurat);
      if (!spri || spri.status !== 'aktif' || spri.jenis !== 'spri' || spri.noKartu !== t.noKartu) {
        return vclaimFail(
          'BPJS_SURAT_TIDAK_DITEMUKAN',
          `SPRI ${t.skdp.noSurat || '(kosong)'} wajib untuk rawat inap`,
        );
      }
      if (terbit.length > 0) return vclaimFail('BPJS_SEP_GANDA', `rawat inap tanggal ${t.tglSep}`);
      // Rawat inap sebelumnya belum dipulangkan (`updtglplg`) = masih dirawat.
      const dirawat = [...bpjs.seps.values()].find(
        (s) =>
          s.status === 'terbit' &&
          s.tSep.noKartu === t.noKartu &&
          s.tSep.jnsPelayanan === VCLAIM_JENIS_PELAYANAN.rawatInap &&
          !s.pulang,
      );
      if (dirawat) return vclaimFail('BPJS_SEP_GANDA', `masih rawat inap sejak ${dirawat.tSep.tglSep}`);
    }

    const noSep = `${t.ppkPelayanan}${mmyy(t.tglSep)}V${String(bpjs.nextSepSeq()).padStart(6, '0')}`;
    const rec: SepRecord = {
      noSep,
      status: 'terbit',
      tSep: t,
      peserta,
      versi: 1,
      dibuat: now(),
      diubah: null,
      dihapus: null,
      pulang: null,
    };
    bpjs.seps.set(noSep, rec);
    return ctx.vclaimOk(req, { sep: sepView(rec) });
  });

  app.put(VCLAIM_ENDPOINTS.sepUpdate.path, async (req) => {
    const parsed = vclaimSepUpdateRequestSchema.safeParse(req.body);
    if (!parsed.success) return vclaimFail('BPJS_VALIDASI', zodDetail(parsed.error));
    const u = parsed.data.request.t_sep;
    const rec = bpjs.seps.get(u.noSep);
    if (!rec || rec.status !== 'terbit') return vclaimFail('BPJS_SEP_TIDAK_DITEMUKAN', u.noSep);
    if (rec.tSep.jnsPelayanan === VCLAIM_JENIS_PELAYANAN.rawatJalan) {
      const poli = poliByKode(u.poli.tujuan);
      if (!poli) return vclaimFail('BPJS_POLI_TIDAK_DITEMUKAN', u.poli.tujuan || 'poli.tujuan kosong');
      const dpjp = dokterByKode(u.dpjpLayan);
      if (!dpjp || dpjp.kodepoli !== poli.kode) {
        return vclaimFail(
          'BPJS_DOKTER_TIDAK_DITEMUKAN',
          `dpjpLayan ${u.dpjpLayan || '-'} di poli ${poli.kode}`,
        );
      }
    }
    const { noSep: _noSep, ...changes } = u;
    rec.tSep = { ...rec.tSep, ...changes };
    rec.versi += 1;
    rec.diubah = now();
    return ctx.vclaimOk(req, rec.noSep);
  });

  app.delete(VCLAIM_ENDPOINTS.sepDelete.path, async (req) => {
    const parsed = vclaimSepDeleteRequestSchema.safeParse(req.body);
    if (!parsed.success) return vclaimFail('BPJS_VALIDASI', zodDetail(parsed.error));
    const { noSep } = parsed.data.request.t_sep;
    const rec = bpjs.seps.get(noSep);
    if (!rec || rec.status !== 'terbit') return vclaimFail('BPJS_SEP_TIDAK_DITEMUKAN', noSep);
    rec.status = 'dihapus';
    rec.dihapus = now();
    return ctx.vclaimOk(req, rec.noSep);
  });

  app.get<{ Params: { noSep: string } }>(VCLAIM_ENDPOINTS.sepByNomor.path, async (req) => {
    const rec = bpjs.seps.get(req.params.noSep);
    if (!rec || rec.status !== 'terbit') return vclaimFail('BPJS_SEP_TIDAK_DITEMUKAN', req.params.noSep);
    return ctx.vclaimOk(req, sepDetail(rec, bpjs.surat.get(rec.tSep.skdp.noSurat)));
  });

  app.put(VCLAIM_ENDPOINTS.sepUpdateTglPulang.path, async (req) => {
    const parsed = vclaimSepPulangRequestSchema.safeParse(req.body);
    if (!parsed.success) return vclaimFail('BPJS_VALIDASI', zodDetail(parsed.error));
    const p = parsed.data.request.t_sep;
    const rec = bpjs.seps.get(p.noSep);
    if (!rec || rec.status !== 'terbit') return vclaimFail('BPJS_SEP_TIDAK_DITEMUKAN', p.noSep);
    if (rec.tSep.jnsPelayanan !== VCLAIM_JENIS_PELAYANAN.rawatInap) {
      return vclaimFail('BPJS_SEP_BUKAN_RAWAT_INAP', p.noSep);
    }
    if (p.tglPulang < rec.tSep.tglSep || p.tglPulang > ctx.today()) {
      return vclaimFail('BPJS_TANGGAL_TIDAK_VALID', 'tglPulang harus antara tglSep dan hari ini');
    }
    rec.pulang = {
      tglPulang: p.tglPulang,
      statusPulang: p.statusPulang,
      noSuratMeninggal: p.noSuratMeninggal,
      tglMeninggal: p.tglMeninggal,
    };
    rec.versi += 1;
    rec.diubah = now();
    return ctx.vclaimOk(req, rec.noSep);
  });

  // --- Sidik jari ----------------------------------------------------------------------------------------------

  app.get<{ Params: { noKartu: string; tglPelayanan: string } }>(
    VCLAIM_ENDPOINTS.fingerprintStatus.path,
    async (req) => {
      const { noKartu, tglPelayanan } = req.params;
      if (!isKartu(noKartu)) return vclaimFail('BPJS_VALIDASI', 'No. kartu harus 13 digit');
      if (!isDate(tglPelayanan)) return vclaimFail('BPJS_VALIDASI', 'TglPelayanan harus YYYY-MM-DD');
      if (!pesertaByKartu(bpjs, noKartu, tglPelayanan, ctx.today())) {
        return vclaimFail('BPJS_PESERTA_TIDAK_DITEMUKAN');
      }
      const sudah = !needsFingerprint(noKartu) || bpjs.fingerprints.has(`${noKartu}|${tglPelayanan}`);
      return ctx.vclaimOk(
        req,
        sudah
          ? { kode: '1', status: 'Peserta sudah melakukan rekam sidik jari' }
          : { kode: '0', status: 'Peserta belum melakukan rekam sidik jari' },
      );
    },
  );

  // --- Rencana kontrol + SPRI ----------------------------------------------------------------------------------

  /** Validasi poli, DPJP, tanggal, dan jadwal HFIS bersama surat kontrol/SPRI; null = sah. */
  function checkSurat(poliKontrol: string, kodeDokter: string, tgl: string) {
    const poli = poliByKode(poliKontrol);
    if (!poli) return vclaimFail('BPJS_POLI_TIDAK_DITEMUKAN', poliKontrol);
    const dokter = dokterByKode(kodeDokter);
    if (!dokter || dokter.kodepoli !== poli.kode) {
      return vclaimFail('BPJS_DOKTER_TIDAK_DITEMUKAN', `${kodeDokter} di poli ${poli.kode}`);
    }
    const ahead = bpjsDiffDays(ctx.today(), tgl);
    if (ahead < 0 || ahead > MAKS_HARI_KE_DEPAN) {
      return vclaimFail(
        'BPJS_TANGGAL_TIDAK_VALID',
        `tglRencanaKontrol harus 0–${MAKS_HARI_KE_DEPAN} hari ke depan`,
      );
    }
    const jadwal = hfisJadwalOn(bpjs, poli.kode, tgl, dokter.kode);
    if (jadwal.length === 0)
      return vclaimFail('BPJS_JADWAL_TIDAK_DITEMUKAN', `${dokter.kode} tanggal ${tgl}`);
    if (jadwal.every((j) => j.libur === 1)) return vclaimFail('BPJS_JADWAL_LIBUR', tgl);
    return null;
  }

  function newSurat(ppk: string): string {
    return `${ppk}${mmyy(ctx.today())}K${String(bpjs.nextSuratSeq()).padStart(6, '0')}`;
  }

  app.post(VCLAIM_ENDPOINTS.rencanaKontrolInsert.path, async (req) => {
    const parsed = vclaimRencanaKontrolRequestSchema.safeParse(req.body);
    if (!parsed.success) return vclaimFail('BPJS_VALIDASI', zodDetail(parsed.error));
    const r = parsed.data.request;
    const sep = bpjs.seps.get(r.noSEP);
    if (!sep || sep.status !== 'terbit') return vclaimFail('BPJS_SEP_TIDAK_DITEMUKAN', r.noSEP);
    const invalid = checkSurat(r.poliKontrol, r.kodeDokter, r.tglRencanaKontrol);
    if (invalid) return invalid;
    const surat: SuratRecord = {
      noSurat: newSurat(sep.tSep.ppkPelayanan),
      jenis: 'kontrol',
      status: 'aktif',
      diubah: null,
      noKartu: sep.tSep.noKartu,
      noSepAsal: sep.noSep,
      kodeDokter: r.kodeDokter,
      poliKontrol: r.poliKontrol,
      tglRencanaKontrol: r.tglRencanaKontrol,
      tglTerbit: ctx.today(),
      diagnosa: diagnosaLabel(sep.tSep.diagAwal),
    };
    bpjs.surat.set(surat.noSurat, surat);
    const body: VclaimRencanaKontrolResponse = {
      noSuratKontrol: surat.noSurat,
      ...suratPeserta(surat, sep.peserta),
    };
    return ctx.vclaimOk(req, body);
  });

  app.post(VCLAIM_ENDPOINTS.spriInsert.path, async (req) => {
    const parsed = vclaimSpriRequestSchema.safeParse(req.body);
    if (!parsed.success) return vclaimFail('BPJS_VALIDASI', zodDetail(parsed.error));
    const r = parsed.data.request;
    const today = ctx.today();
    const peserta = pesertaByKartu(bpjs, r.noKartu, today, today);
    if (!peserta) return vclaimFail('BPJS_PESERTA_TIDAK_DITEMUKAN');
    if (!pesertaAktif(peserta))
      return vclaimFail('BPJS_PESERTA_TIDAK_AKTIF', peserta.statusPeserta.keterangan);
    const invalid = checkSurat(r.poliKontrol, r.kodeDokter, r.tglRencanaKontrol);
    if (invalid) return invalid;
    const surat: SuratRecord = {
      noSurat: newSurat(config.bpjs.ppkCode),
      jenis: 'spri',
      status: 'aktif',
      diubah: null,
      noKartu: r.noKartu,
      noSepAsal: null,
      kodeDokter: r.kodeDokter,
      poliKontrol: r.poliKontrol,
      tglRencanaKontrol: r.tglRencanaKontrol,
      tglTerbit: today,
      diagnosa: null,
    };
    bpjs.surat.set(surat.noSurat, surat);
    const body: VclaimSpriResponse = { noSPRI: surat.noSurat, ...suratPeserta(surat, peserta) };
    return ctx.vclaimOk(req, body);
  });

  /** Surat aktif berjenis tertentu yang belum dipakai SEP; selain itu kembalikan penolakan. */
  function suratBisaDiubah(noSurat: string, jenis: SuratRecord['jenis']) {
    const s = bpjs.surat.get(noSurat);
    if (!s || s.status !== 'aktif' || s.jenis !== jenis) {
      return { fail: vclaimFail('BPJS_SURAT_TIDAK_DITEMUKAN', noSurat) };
    }
    const dipakai = [...bpjs.seps.values()].find(
      (x) => x.status === 'terbit' && x.tSep.skdp.noSurat === noSurat,
    );
    if (dipakai) return { fail: vclaimFail('BPJS_SURAT_SUDAH_DIPAKAI', dipakai.noSep) };
    return { surat: s };
  }

  function ubahSurat(
    s: SuratRecord,
    r: { kodeDokter: string; poliKontrol: string; tglRencanaKontrol: string },
  ) {
    s.kodeDokter = r.kodeDokter;
    s.poliKontrol = r.poliKontrol;
    s.tglRencanaKontrol = r.tglRencanaKontrol;
    s.diubah = now();
  }

  app.put(VCLAIM_ENDPOINTS.rencanaKontrolUpdate.path, async (req) => {
    const parsed = vclaimRencanaKontrolUpdateRequestSchema.safeParse(req.body);
    if (!parsed.success) return vclaimFail('BPJS_VALIDASI', zodDetail(parsed.error));
    const r = parsed.data.request;
    const found = suratBisaDiubah(r.noSuratKontrol, 'kontrol');
    if ('fail' in found) return found.fail;
    const sep = bpjs.seps.get(r.noSEP);
    if (!sep || sep.status !== 'terbit' || found.surat.noSepAsal !== sep.noSep) {
      return vclaimFail('BPJS_SEP_TIDAK_DITEMUKAN', r.noSEP);
    }
    const invalid = checkSurat(r.poliKontrol, r.kodeDokter, r.tglRencanaKontrol);
    if (invalid) return invalid;
    ubahSurat(found.surat, r);
    const body: VclaimRencanaKontrolResponse = {
      noSuratKontrol: found.surat.noSurat,
      ...suratPeserta(found.surat, sep.peserta),
    };
    return ctx.vclaimOk(req, body);
  });

  app.put(VCLAIM_ENDPOINTS.spriUpdate.path, async (req) => {
    const parsed = vclaimSpriUpdateRequestSchema.safeParse(req.body);
    if (!parsed.success) return vclaimFail('BPJS_VALIDASI', zodDetail(parsed.error));
    const r = parsed.data.request;
    const found = suratBisaDiubah(r.noSPRI, 'spri');
    if ('fail' in found) return found.fail;
    const invalid = checkSurat(r.poliKontrol, r.kodeDokter, r.tglRencanaKontrol);
    if (invalid) return invalid;
    const today = ctx.today();
    const peserta = pesertaByKartu(bpjs, found.surat.noKartu, today, today);
    if (!peserta) return vclaimFail('BPJS_PESERTA_TIDAK_DITEMUKAN');
    ubahSurat(found.surat, r);
    const body: VclaimSpriResponse = { noSPRI: found.surat.noSurat, ...suratPeserta(found.surat, peserta) };
    return ctx.vclaimOk(req, body);
  });

  app.delete(VCLAIM_ENDPOINTS.rencanaKontrolDelete.path, async (req) => {
    const parsed = vclaimRencanaKontrolDeleteRequestSchema.safeParse(req.body);
    if (!parsed.success) return vclaimFail('BPJS_VALIDASI', zodDetail(parsed.error));
    const { noSuratKontrol } = parsed.data.request.t_suratkontrol;
    const jenis = bpjs.surat.get(noSuratKontrol)?.jenis ?? 'kontrol';
    const found = suratBisaDiubah(noSuratKontrol, jenis);
    if ('fail' in found) return found.fail;
    found.surat.status = 'dihapus';
    found.surat.diubah = now();
    return ctx.vclaimOk(req, found.surat.noSurat);
  });

  app.get<{ Params: { noSuratKontrol: string } }>(VCLAIM_ENDPOINTS.suratKontrolByNomor.path, async (req) => {
    const s = bpjs.surat.get(req.params.noSuratKontrol);
    if (!s || s.status !== 'aktif')
      return vclaimFail('BPJS_SURAT_TIDAK_DITEMUKAN', req.params.noSuratKontrol);
    const today = ctx.today();
    const peserta = pesertaByKartu(bpjs, s.noKartu, today, today);
    const poli = poliByKode(s.poliKontrol);
    const body: VclaimSuratKontrol = {
      noSuratKontrol: s.noSurat,
      jnsKontrol: s.jenis === 'spri' ? VCLAIM_JENIS_SURAT.spri : VCLAIM_JENIS_SURAT.kontrol,
      namaJnsKontrol: s.jenis === 'spri' ? 'SPRI' : 'Surat Kontrol',
      tglRencanaKontrol: s.tglRencanaKontrol,
      tglTerbit: s.tglTerbit,
      poliTujuan: s.poliKontrol,
      namaPoliTujuan: poli?.nama ?? '',
      kodeDokter: s.kodeDokter,
      namaDokter: dokterByKode(s.kodeDokter)?.nama ?? '',
      noKartu: s.noKartu,
      nama: peserta?.nama ?? '',
      noSepAsal: s.noSepAsal,
    };
    return ctx.vclaimOk(req, body);
  });

  // --- Referensi + histori -------------------------------------------------------------------------------------

  app.get<{ Params: { param: string } }>(VCLAIM_ENDPOINTS.refPoli.path, async (req) => {
    const q = req.params.param.trim().toUpperCase();
    const poli = MOCK_POLI.filter((p) => p.kode === q || p.nama.includes(q)).map((p) => ({
      kode: p.kode,
      nama: p.nama,
    }));
    return poli.length ? ctx.vclaimOk(req, { poli }) : vclaimFail('BPJS_DATA_TIDAK_DITEMUKAN');
  });

  app.get<{ Params: { param: string } }>(VCLAIM_ENDPOINTS.refDiagnosa.path, async (req) => {
    const q = req.params.param.trim().toUpperCase();
    const diagnosa = Object.entries(MOCK_DIAGNOSA)
      .filter(([kode, nama]) => kode.startsWith(q) || nama.toUpperCase().includes(q))
      .map(([kode, nama]) => ({ kode, nama }));
    return diagnosa.length ? ctx.vclaimOk(req, { diagnosa }) : vclaimFail('BPJS_DATA_TIDAK_DITEMUKAN');
  });

  app.get<{ Params: { param: string; jenisFaskes: string } }>(
    VCLAIM_ENDPOINTS.refFaskes.path,
    async (req) => {
      const { jenisFaskes } = req.params;
      if (jenisFaskes !== VCLAIM_JENIS_FASKES.fktp && jenisFaskes !== VCLAIM_JENIS_FASKES.rs) {
        return vclaimFail('BPJS_VALIDASI', 'jenisFaskes harus 1 (FKTP) atau 2 (RS)');
      }
      const q = req.params.param.trim().toUpperCase();
      const daftar = jenisFaskes === VCLAIM_JENIS_FASKES.fktp ? MOCK_FASKES.fktp : MOCK_FASKES.rs;
      const faskes = daftar
        .filter((f) => f.kode === q || f.nama.includes(q))
        .map((f) => ({ kode: f.kode, nama: f.nama }));
      return faskes.length ? ctx.vclaimOk(req, { faskes }) : vclaimFail('BPJS_DATA_TIDAK_DITEMUKAN');
    },
  );

  app.get<{ Params: { jnsPelayanan: string; tglPelayanan: string; kodeSpesialis: string } }>(
    VCLAIM_ENDPOINTS.refDokter.path,
    async (req) => {
      const { jnsPelayanan, tglPelayanan, kodeSpesialis } = req.params;
      if (
        jnsPelayanan !== VCLAIM_JENIS_PELAYANAN.rawatInap &&
        jnsPelayanan !== VCLAIM_JENIS_PELAYANAN.rawatJalan
      ) {
        return vclaimFail('BPJS_VALIDASI', 'jnsPelayanan harus 1 (rawat inap) atau 2 (rawat jalan)');
      }
      if (!isDate(tglPelayanan)) return vclaimFail('BPJS_VALIDASI', 'tglPelayanan harus YYYY-MM-DD');
      const list = MOCK_DOKTER.filter((d) => d.kodepoli === kodeSpesialis.toUpperCase()).map((d) => ({
        kode: String(d.kode),
        nama: d.nama,
      }));
      return list.length ? ctx.vclaimOk(req, { list }) : vclaimFail('BPJS_DATA_TIDAK_DITEMUKAN');
    },
  );

  app.get<{ Params: { noKartu: string; tglMulai: string; tglAkhir: string } }>(
    VCLAIM_ENDPOINTS.historiPelayanan.path,
    async (req) => {
      const { noKartu, tglMulai, tglAkhir } = req.params;
      if (!isKartu(noKartu)) return vclaimFail('BPJS_VALIDASI', 'No. kartu harus 13 digit');
      if (!isDate(tglMulai) || !isDate(tglAkhir)) {
        return vclaimFail('BPJS_VALIDASI', 'tglMulai/tglAkhir harus YYYY-MM-DD');
      }
      const rentang = bpjsDiffDays(tglMulai, tglAkhir);
      if (rentang < 0 || rentang > MAKS_RENTANG_HISTORI) {
        return vclaimFail('BPJS_TANGGAL_TIDAK_VALID', `rentang histori 0–${MAKS_RENTANG_HISTORI} hari`);
      }
      const histori: VclaimHistori[] = [...bpjs.seps.values()]
        .filter(
          (s) =>
            s.status === 'terbit' &&
            s.tSep.noKartu === noKartu &&
            s.tSep.tglSep >= tglMulai &&
            s.tSep.tglSep <= tglAkhir,
        )
        .map((s) => ({
          noSep: s.noSep,
          tglSep: s.tSep.tglSep,
          tglPlgSep: s.pulang?.tglPulang ?? '',
          jnsPelayanan: s.tSep.jnsPelayanan,
          kelasRawat: s.tSep.klsRawat.klsRawatHak,
          diagnosa: diagnosaLabel(s.tSep.diagAwal),
          noKartu: s.tSep.noKartu,
          namaPeserta: s.peserta.nama,
          noRujukan: s.tSep.rujukan.noRujukan,
          poli: poliByKode(s.tSep.poli.tujuan)?.nama ?? '',
          ppkPelayanan: s.tSep.ppkPelayanan,
        }));
      return histori.length ? ctx.vclaimOk(req, { histori }) : vclaimFail('BPJS_DATA_TIDAK_DITEMUKAN');
    },
  );
}

function suratPeserta(surat: SuratRecord, peserta: VclaimPeserta) {
  return {
    tglRencanaKontrol: surat.tglRencanaKontrol,
    namaDokter: dokterByKode(surat.kodeDokter)?.nama ?? '',
    noKartu: peserta.noKartu,
    nama: peserta.nama,
    kelamin: peserta.sex === 'L' ? 'Laki-Laki' : 'Perempuan',
    tglLahir: peserta.tglLahir,
    namaDiagnosa: surat.diagnosa,
  };
}
