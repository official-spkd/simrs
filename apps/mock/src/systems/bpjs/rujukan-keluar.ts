import {
  bpjsDiffDays,
  VCLAIM_ENDPOINTS,
  VCLAIM_TIPE_RUJUKAN,
  type VclaimRujukanKeluar,
  vclaimRujukanBerlakuSampai,
  vclaimRujukanKeluarDeleteRequestSchema,
  vclaimRujukanKeluarInsertRequestSchema,
  vclaimRujukanKeluarUpdateRequestSchema,
  type VclaimRujukanKeluarTRujukan,
} from '@simrs/shared';
import type { FastifyInstance } from 'fastify';
import { type BpjsContext, mmyy, vclaimFail, zodDetail } from './context';
import { diagnosaNama, faskesByKode, poliByKode } from './master';
import type { RujukanKeluarRecord } from './state';

/**
 * F07 · Rujukan keluar dari SEP RS ini (VClaim 2.0): terbit, ubah, hapus, baca. Aturan mock:
 * - SEP asal harus terbit; faskes tujuan harus ada di referensi faskes dan bukan RS asal;
 * - rujuk penuh/partial (0/1) ke RS, rujuk balik (2) ke FKTP; poli tujuan wajib untuk rawat jalan selain rujuk balik;
 * - `tglRujukan` antara tanggal SEP dan hari ini; `tglRencanaKunjungan` 0–90 hari setelah `tglRujukan`.
 */

const TIPE_LABEL: Readonly<Record<string, string>> = { '0': 'Penuh', '1': 'Partial', '2': 'Rujuk Balik' };
const MAKS_RENCANA_HARI = 90;

type IsiRujukan = Omit<VclaimRujukanKeluarTRujukan, 'noSep'>;

export function registerRujukanKeluar(app: FastifyInstance, ctx: BpjsContext): void {
  const bpjs = ctx.state.bpjs;
  const now = () => ctx.config.now().toISOString();

  /** Validasi isi rujukan terhadap tanggal SEP dan PPK asal; null = sah. */
  function check(r: IsiRujukan, tglSep: string, ppkAsal: string) {
    const tujuan = faskesByKode(r.ppkDirujuk);
    if (!tujuan) return vclaimFail('BPJS_FASKES_TIDAK_DITEMUKAN', r.ppkDirujuk);
    if (tujuan.kode === ppkAsal) return vclaimFail('BPJS_VALIDASI', 'ppkDirujuk sama dengan PPK asal');
    const rujukBalik = r.tipeRujukan === VCLAIM_TIPE_RUJUKAN.rujukBalik;
    if (rujukBalik !== (tujuan.jenis === 'fktp')) {
      return vclaimFail(
        'BPJS_VALIDASI',
        rujukBalik ? 'rujuk balik hanya ke FKTP' : 'rujukan penuh/partial hanya ke RS',
      );
    }
    if (r.jnsPelayanan === '2' && !rujukBalik && !poliByKode(r.poliRujukan)) {
      return vclaimFail('BPJS_POLI_TIDAK_DITEMUKAN', r.poliRujukan || 'poliRujukan kosong');
    }
    if (r.tglRujukan < tglSep || r.tglRujukan > ctx.today()) {
      return vclaimFail('BPJS_TANGGAL_TIDAK_VALID', 'tglRujukan harus antara tglSep dan hari ini');
    }
    const ahead = bpjsDiffDays(r.tglRujukan, r.tglRencanaKunjungan);
    if (ahead < 0 || ahead > MAKS_RENCANA_HARI) {
      return vclaimFail(
        'BPJS_TANGGAL_TIDAK_VALID',
        `tglRencanaKunjungan harus 0–${MAKS_RENCANA_HARI} hari setelah tglRujukan`,
      );
    }
    return null;
  }

  function view(rec: RujukanKeluarRecord): VclaimRujukanKeluar {
    const r = rec.tRujukan;
    const asal = faskesByKode(rec.ppkAsal);
    const tujuan = faskesByKode(r.ppkDirujuk);
    const poli = poliByKode(r.poliRujukan);
    const p = rec.peserta;
    return {
      noRujukan: rec.noRujukan,
      noSep: r.noSep,
      tglRujukan: r.tglRujukan,
      tglRencanaKunjungan: r.tglRencanaKunjungan,
      tglBerlakuKunjungan: vclaimRujukanBerlakuSampai(r.tglRujukan),
      jnsPelayanan: r.jnsPelayanan,
      tipeRujukan: { kode: r.tipeRujukan, nama: TIPE_LABEL[r.tipeRujukan] ?? '' },
      AsalRujukan: { kode: rec.ppkAsal, nama: asal?.nama ?? '' },
      tujuanRujukan: { kode: r.ppkDirujuk, nama: tujuan?.nama ?? '' },
      poliTujuan: { kode: poli?.kode ?? '', nama: poli?.nama ?? '' },
      diagnosa: { kode: r.diagRujukan, nama: diagnosaNama(r.diagRujukan) },
      catatan: r.catatan,
      peserta: {
        noKartu: p.noKartu,
        nama: p.nama,
        tglLahir: p.tglLahir,
        kelamin: p.sex === 'L' ? 'Laki-Laki' : 'Perempuan',
        jnsPeserta: p.jenisPeserta.keterangan,
        hakKelas: p.hakKelas.keterangan,
        noMr: rec.noMR,
        asuransi: null,
      },
    };
  }

  const terbit = (noRujukan: string) => {
    const rec = bpjs.rujukanKeluar.get(noRujukan);
    return rec && rec.status === 'terbit' ? rec : undefined;
  };

  app.post(VCLAIM_ENDPOINTS.rujukanKeluarInsert.path, async (req) => {
    const parsed = vclaimRujukanKeluarInsertRequestSchema.safeParse(req.body);
    if (!parsed.success) return vclaimFail('BPJS_VALIDASI', zodDetail(parsed.error));
    const r = parsed.data.request.t_rujukan;
    const sep = bpjs.seps.get(r.noSep);
    if (!sep || sep.status !== 'terbit') return vclaimFail('BPJS_SEP_TIDAK_DITEMUKAN', r.noSep);
    const invalid = check(r, sep.tSep.tglSep, sep.tSep.ppkPelayanan);
    if (invalid) return invalid;
    const seq = String(bpjs.nextRujukanSeq()).padStart(6, '0');
    const rec: RujukanKeluarRecord = {
      noRujukan: `${sep.tSep.ppkPelayanan}${mmyy(r.tglRujukan)}B${seq}`,
      status: 'terbit',
      tRujukan: r,
      ppkAsal: sep.tSep.ppkPelayanan,
      peserta: sep.peserta,
      noMR: sep.tSep.noMR,
      dibuat: now(),
      diubah: null,
      dihapus: null,
    };
    bpjs.rujukanKeluar.set(rec.noRujukan, rec);
    return ctx.vclaimOk(req, { rujukan: view(rec) });
  });

  app.put(VCLAIM_ENDPOINTS.rujukanKeluarUpdate.path, async (req) => {
    const parsed = vclaimRujukanKeluarUpdateRequestSchema.safeParse(req.body);
    if (!parsed.success) return vclaimFail('BPJS_VALIDASI', zodDetail(parsed.error));
    const { noRujukan, ...isi } = parsed.data.request.t_rujukan;
    const rec = terbit(noRujukan);
    if (!rec) return vclaimFail('BPJS_RUJUKAN_TIDAK_DITEMUKAN', noRujukan);
    const tglSep = bpjs.seps.get(rec.tRujukan.noSep)?.tSep.tglSep ?? rec.tRujukan.tglRujukan;
    const invalid = check(isi, tglSep, rec.ppkAsal);
    if (invalid) return invalid;
    rec.tRujukan = { ...rec.tRujukan, ...isi };
    rec.diubah = now();
    return ctx.vclaimOk(req, rec.noRujukan);
  });

  app.delete(VCLAIM_ENDPOINTS.rujukanKeluarDelete.path, async (req) => {
    const parsed = vclaimRujukanKeluarDeleteRequestSchema.safeParse(req.body);
    if (!parsed.success) return vclaimFail('BPJS_VALIDASI', zodDetail(parsed.error));
    const { noRujukan } = parsed.data.request.t_rujukan;
    const rec = terbit(noRujukan);
    if (!rec) return vclaimFail('BPJS_RUJUKAN_TIDAK_DITEMUKAN', noRujukan);
    rec.status = 'dihapus';
    rec.dihapus = now();
    return ctx.vclaimOk(req, rec.noRujukan);
  });

  app.get<{ Params: { noRujukan: string } }>(VCLAIM_ENDPOINTS.rujukanKeluarByNomor.path, async (req) => {
    const rec = terbit(req.params.noRujukan);
    if (!rec) return vclaimFail('BPJS_RUJUKAN_TIDAK_DITEMUKAN', req.params.noRujukan);
    return ctx.vclaimOk(req, { rujukan: view(rec) });
  });
}
