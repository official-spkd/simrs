import { z } from 'zod';
import {
  bpjsAddDays,
  type BpjsEndpoint,
  bpjsDateSchema,
  bpjsIcd10Schema,
  bpjsDiffDays,
  bpjsKodeKeteranganSchema,
  bpjsKodeNamaSchema,
  bpjsKodePpkSchema,
  bpjsNoKartuSchema,
} from './common';

/**
 * I03 → F06/F07 · VClaim 2.0: kepesertaan, rujukan, SEP, rencana kontrol/SPRI, sidik jari, referensi, histori.
 * Path relatif terhadap `BPJS_SERVICE_PREFIX.vclaim`; semua respons sukses berisi data terenkripsi.
 * Nama field mengikuti kabel BPJS (bukan camelCase domain): pemetaan ke domain dikerjakan mapper konektor.
 */
export const VCLAIM_ENDPOINTS = {
  /** Kepesertaan per no. kartu pada tanggal pelayanan → `vclaimPesertaResponseSchema`. */
  pesertaByKartu: { method: 'GET', path: '/Peserta/nokartu/:noKartu/tglSEP/:tglSEP' },
  /** Kepesertaan per NIK → `vclaimPesertaResponseSchema`. */
  pesertaByNik: { method: 'GET', path: '/Peserta/nik/:nik/tglSEP/:tglSEP' },
  /** Rujukan FKTP per nomor → `vclaimRujukanResponseSchema`. */
  rujukanByNomor: { method: 'GET', path: '/Rujukan/:noRujukan' },
  /** Rujukan dari RS lain per nomor → `vclaimRujukanResponseSchema`. */
  rujukanRsByNomor: { method: 'GET', path: '/Rujukan/RS/:noRujukan' },
  /** Semua rujukan FKTP milik kartu (termasuk yang kedaluwarsa) → `vclaimRujukanListResponseSchema`. */
  rujukanListByKartu: { method: 'GET', path: '/Rujukan/List/Peserta/:noKartu' },
  /** Semua rujukan RS milik kartu → `vclaimRujukanListResponseSchema`. */
  rujukanRsListByKartu: { method: 'GET', path: '/Rujukan/RS/List/Peserta/:noKartu' },
  /** Jumlah SEP yang sudah memakai rujukan (kunjungan ke-n = jumlah + 1); jenis 1 = FKTP, 2 = RS. */
  rujukanJumlahSep: { method: 'GET', path: '/Rujukan/JumlahSEP/:jenisRujukan/:noRujukan' },
  /** Terbitkan SEP → `vclaimSepInsertResponseSchema`. */
  sepInsert: { method: 'POST', path: '/SEP/2.0/insert' },
  /** Ubah SEP → `vclaimNoSepResponseSchema`. */
  sepUpdate: { method: 'PUT', path: '/SEP/2.0/update' },
  /** Hapus SEP (body JSON pada DELETE) → `vclaimNoSepResponseSchema`. */
  sepDelete: { method: 'DELETE', path: '/SEP/2.0/delete' },
  /** Tanggal + status pulang SEP rawat inap → `vclaimNoSepResponseSchema`. */
  sepUpdateTglPulang: { method: 'PUT', path: '/SEP/2.0/updtglplg' },
  /** Detail SEP → `vclaimSepDetailSchema`. */
  sepByNomor: { method: 'GET', path: '/SEP/:noSep' },
  /** Status rekam sidik jari peserta pada tanggal pelayanan → `vclaimFingerprintResponseSchema`. */
  fingerprintStatus: { method: 'GET', path: '/SEP/FingerPrint/Peserta/:noKartu/TglPelayanan/:tglPelayanan' },
  /** Rencana kontrol (surat kontrol) dari SEP → `vclaimRencanaKontrolResponseSchema`. */
  rencanaKontrolInsert: { method: 'POST', path: '/RencanaKontrol/insert' },
  /** Surat perintah rawat inap → `vclaimSpriResponseSchema`. */
  spriInsert: { method: 'POST', path: '/RencanaKontrol/InsertSPRI' },
  /** Ubah surat kontrol (belum dipakai SEP) → `vclaimRencanaKontrolResponseSchema`. */
  rencanaKontrolUpdate: { method: 'PUT', path: '/RencanaKontrol/Update' },
  /** Ubah SPRI (belum dipakai SEP) → `vclaimSpriResponseSchema`. */
  spriUpdate: { method: 'PUT', path: '/RencanaKontrol/UpdateSPRI' },
  /** Hapus surat kontrol/SPRI yang belum dipakai SEP (body JSON pada DELETE) → `vclaimNoSuratResponseSchema`. */
  rencanaKontrolDelete: { method: 'DELETE', path: '/RencanaKontrol/Delete' },
  /** Detail surat kontrol/SPRI → `vclaimSuratKontrolSchema`. */
  suratKontrolByNomor: { method: 'GET', path: '/RencanaKontrol/noSuratKontrol/:noSuratKontrol' },
  /** F07 · Rujukan keluar dari SEP RS ini → `vclaimRujukanKeluarResponseSchema`. */
  rujukanKeluarInsert: { method: 'POST', path: '/Rujukan/2.0/insert' },
  /** Ubah rujukan keluar → `vclaimNoRujukanResponseSchema`. */
  rujukanKeluarUpdate: { method: 'PUT', path: '/Rujukan/2.0/Update' },
  /** Hapus rujukan keluar (body JSON pada DELETE) → `vclaimNoRujukanResponseSchema`. */
  rujukanKeluarDelete: { method: 'DELETE', path: '/Rujukan/delete' },
  /** Detail rujukan keluar → `vclaimRujukanKeluarResponseSchema`. */
  rujukanKeluarByNomor: { method: 'GET', path: '/Rujukan/Keluar/:noRujukan' },
  /** Referensi poli (kode atau nama mengandung `param`) → `vclaimRefPoliResponseSchema`. */
  refPoli: { method: 'GET', path: '/referensi/poli/:param' },
  /** Referensi DPJP per jenis pelayanan (1 RI, 2 RJ), tanggal, spesialis/poli → `vclaimRefDokterResponseSchema`. */
  refDokter: {
    method: 'GET',
    path: '/referensi/dokter/pelayanan/:jnsPelayanan/tglPelayanan/:tglPelayanan/Spesialis/:kodeSpesialis',
  },
  /** Referensi diagnosa ICD-10 (kode berawalan / nama mengandung `param`) → `vclaimRefDiagnosaResponseSchema`. */
  refDiagnosa: { method: 'GET', path: '/referensi/diagnosa/:param' },
  /** Referensi faskes (kode / nama mengandung `param`); jenis 1 = FKTP, 2 = RS → `vclaimRefFaskesResponseSchema`. */
  refFaskes: { method: 'GET', path: '/referensi/faskes/:param/:jenisFaskes' },
  /** Histori SEP peserta pada rentang tanggal → `vclaimHistoriResponseSchema` (cek SEP sebelum kirim ulang). */
  historiPelayanan: {
    method: 'GET',
    path: '/monitoring/HistoriPelayanan/NoKartu/:noKartu/tglMulai/:tglMulai/tglAkhir/:tglAkhir',
  },
} as const satisfies Record<string, BpjsEndpoint>;

// ---------------------------------------------------------------------------------------------------------------
// Peserta
// ---------------------------------------------------------------------------------------------------------------

/** `statusPeserta.kode` untuk peserta aktif. */
export const VCLAIM_PESERTA_AKTIF = '0';

const nullableText = z.string().nullable();

export const vclaimPesertaSchema = z.object({
  noKartu: bpjsNoKartuSchema,
  nik: z.string(),
  nama: z.string(),
  pisa: z.string(),
  sex: z.enum(['L', 'P']),
  tglLahir: bpjsDateSchema,
  tglCetakKartu: bpjsDateSchema,
  tglTMT: bpjsDateSchema,
  tglTAT: bpjsDateSchema,
  statusPeserta: bpjsKodeKeteranganSchema,
  /** `kode` 1/2/3 = kelas I/II/III. */
  hakKelas: bpjsKodeKeteranganSchema,
  jenisPeserta: bpjsKodeKeteranganSchema,
  /** FKTP tempat peserta terdaftar. */
  provUmum: z.object({ kdProvider: z.string(), nmProvider: z.string() }),
  mr: z.object({ noMR: nullableText, noTelepon: nullableText }),
  umur: z.object({ umurSekarang: z.string(), umurSaatPelayanan: z.string() }),
  informasi: z
    .object({ dinsos: nullableText, prolanisPRB: nullableText, noSKTM: nullableText, eSEP: nullableText })
    .optional(),
  cob: z
    .object({
      noAsuransi: nullableText,
      nmAsuransi: nullableText,
      tglTAT: nullableText,
      tglTMT: nullableText,
    })
    .optional(),
});
export type VclaimPeserta = z.infer<typeof vclaimPesertaSchema>;

export const vclaimPesertaResponseSchema = z.object({ peserta: vclaimPesertaSchema });
export type VclaimPesertaResponse = z.infer<typeof vclaimPesertaResponseSchema>;

// ---------------------------------------------------------------------------------------------------------------
// Rujukan
// ---------------------------------------------------------------------------------------------------------------

/** Rujukan berlaku 90 hari sejak tanggal kunjungan di faskes perujuk. */
export const VCLAIM_RUJUKAN_BERLAKU_HARI = 90;

/** Hari terakhir rujukan masih boleh dipakai untuk SEP. */
export function vclaimRujukanBerlakuSampai(tglKunjungan: string): string {
  return bpjsAddDays(tglKunjungan, VCLAIM_RUJUKAN_BERLAKU_HARI);
}

export function vclaimRujukanKedaluwarsa(tglKunjungan: string, tanggalPelayanan: string): boolean {
  return bpjsDiffDays(vclaimRujukanBerlakuSampai(tglKunjungan), tanggalPelayanan) > 0;
}

export const vclaimRujukanSchema = z.object({
  /** Nomor rujukan. */
  noKunjungan: z.string(),
  tglKunjungan: bpjsDateSchema,
  provPerujuk: bpjsKodeNamaSchema,
  peserta: vclaimPesertaSchema,
  poliRujukan: bpjsKodeNamaSchema,
  /** `{ kode: "2", nama: "Rawat Jalan" }`. */
  pelayanan: bpjsKodeNamaSchema,
  diagnosa: bpjsKodeNamaSchema,
  keluhan: z.string(),
});
export type VclaimRujukan = z.infer<typeof vclaimRujukanSchema>;

export const vclaimRujukanResponseSchema = z.object({ rujukan: vclaimRujukanSchema });
export const vclaimRujukanListResponseSchema = z.object({ rujukan: z.array(vclaimRujukanSchema) });
export const vclaimJumlahSepResponseSchema = z.object({ jumlahSEP: z.string().regex(/^\d+$/) });

/** `asalRujukan` / `jenisRujukan`: 1 = FKTP, 2 = RS. */
export const VCLAIM_ASAL_RUJUKAN = { fktp: '1', rs: '2' } as const;

// ---------------------------------------------------------------------------------------------------------------
// SEP 2.0
// ---------------------------------------------------------------------------------------------------------------

/** `jnsPelayanan`: 1 = rawat inap, 2 = rawat jalan. */
export const VCLAIM_JENIS_PELAYANAN = { rawatInap: '1', rawatJalan: '2' } as const;

const flag01 = z.enum(['0', '1']);
/** BPJS mengirim string kosong untuk isian yang tidak dipakai. */
const optionalText = z.string().max(200);

export const vclaimSepInsertRequestSchema = z.object({
  request: z.object({
    t_sep: z.object({
      noKartu: bpjsNoKartuSchema,
      tglSep: bpjsDateSchema,
      ppkPelayanan: bpjsKodePpkSchema,
      jnsPelayanan: z.enum(['1', '2']),
      klsRawat: z.object({
        klsRawatHak: z.enum(['1', '2', '3']),
        klsRawatNaik: optionalText,
        pembiayaan: optionalText,
        penanggungJawab: optionalText,
      }),
      noMR: z.string().min(1).max(20),
      rujukan: z.object({
        /** 1 FKTP, 2 RS; kosong untuk SEP tanpa rujukan (rawat inap dari SPRI). */
        asalRujukan: z.enum(['1', '2', '']),
        tglRujukan: z.union([bpjsDateSchema, z.literal('')]),
        noRujukan: optionalText,
        ppkRujukan: optionalText,
      }),
      catatan: optionalText,
      diagAwal: bpjsIcd10Schema,
      /** `tujuan` = kode poli BPJS (wajib untuk rawat jalan). */
      poli: z.object({ tujuan: optionalText, eksekutif: flag01 }),
      cob: z.object({ cob: flag01 }),
      katarak: z.object({ katarak: flag01 }),
      jaminan: z.object({
        lakaLantas: z.enum(['0', '1', '2', '3']),
        noLP: optionalText,
        penjamin: z.object({
          tglKejadian: optionalText,
          keterangan: optionalText,
          suplesi: z.object({
            suplesi: flag01,
            noSepSuplesi: optionalText,
            lokasiLaka: z.object({
              kdPropinsi: optionalText,
              kdKabupaten: optionalText,
              kdKecamatan: optionalText,
            }),
          }),
        }),
      }),
      /** 0 normal, 1 prosedur, 2 konsul dokter. */
      tujuanKunj: z.enum(['0', '1', '2']),
      flagProcedure: z.enum(['', '0', '1']),
      kdPenunjang: optionalText,
      assesmentPel: optionalText,
      /** Surat kontrol (kunjungan kontrol) atau SPRI (rawat inap) beserta DPJP pemberi surat. */
      skdp: z.object({ noSurat: optionalText, kodeDPJP: optionalText }),
      /** Kode DPJP yang melayani (wajib untuk rawat jalan). */
      dpjpLayan: optionalText,
      noTelp: z.string().min(8).max(15),
      user: z.string().min(1).max(30),
    }),
  }),
});
export type VclaimSepInsertRequest = z.infer<typeof vclaimSepInsertRequestSchema>;
export type VclaimSepInsertTSep = VclaimSepInsertRequest['request']['t_sep'];

export const vclaimSepPesertaSchema = z.object({
  noKartu: bpjsNoKartuSchema,
  nama: z.string(),
  tglLahir: bpjsDateSchema,
  kelamin: z.string(),
  jnsPeserta: z.string(),
  hakKelas: z.string(),
  noMr: z.string(),
  asuransi: z.string().nullable(),
});

export const vclaimSepSchema = z.object({
  /** Format `<PPK 8><MMYY>V<6 digit>`, mis. `0301R0011026V000001`. */
  noSep: z.string().min(1),
  tglSep: bpjsDateSchema,
  /** `Rawat Jalan` | `Rawat Inap`. */
  jnsPelayanan: z.string(),
  kelasRawat: z.string(),
  /** `<kode> - <nama>`. */
  diagnosa: z.string(),
  noRujukan: z.string(),
  poli: z.string(),
  poliEksekutif: z.string(),
  catatan: z.string(),
  penjamin: z.string().nullable(),
  peserta: vclaimSepPesertaSchema,
  informasi: z
    .object({ dinsos: nullableText, prolanisPRB: nullableText, noSKTM: nullableText, eSEP: nullableText })
    .nullable(),
});
export type VclaimSep = z.infer<typeof vclaimSepSchema>;

export const vclaimSepInsertResponseSchema = z.object({ sep: vclaimSepSchema });
export type VclaimSepInsertResponse = z.infer<typeof vclaimSepInsertResponseSchema>;

/** `GET /SEP/{noSep}`: data SEP + DPJP + surat yang dipakai. */
export const vclaimSepDetailSchema = vclaimSepSchema.extend({
  dpjp: z.object({ kdDPJP: z.string(), nmDPJP: z.string() }),
  kontrolinap: z.object({ noSurat: z.string(), tglSurat: z.string() }),
  tujuanKunj: bpjsKodeNamaSchema,
});
export type VclaimSepDetail = z.infer<typeof vclaimSepDetailSchema>;

export const vclaimSepUpdateRequestSchema = z.object({
  request: z.object({
    t_sep: z.object({
      noSep: z.string().min(1),
      klsRawat: z.object({
        klsRawatHak: z.enum(['1', '2', '3']),
        klsRawatNaik: optionalText,
        pembiayaan: optionalText,
        penanggungJawab: optionalText,
      }),
      noMR: z.string().min(1).max(20),
      catatan: optionalText,
      diagAwal: bpjsIcd10Schema,
      poli: z.object({ tujuan: optionalText, eksekutif: flag01 }),
      cob: z.object({ cob: flag01 }),
      katarak: z.object({ katarak: flag01 }),
      dpjpLayan: optionalText,
      noTelp: z.string().min(8).max(15),
      user: z.string().min(1).max(30),
    }),
  }),
});
export type VclaimSepUpdateRequest = z.infer<typeof vclaimSepUpdateRequestSchema>;

export const vclaimSepDeleteRequestSchema = z.object({
  request: z.object({ t_sep: z.object({ noSep: z.string().min(1), user: z.string().min(1).max(30) }) }),
});
export type VclaimSepDeleteRequest = z.infer<typeof vclaimSepDeleteRequestSchema>;

/** Respons ubah/hapus SEP: nomor SEP (string terenkripsi). */
export const vclaimNoSepResponseSchema = z.string().min(1);

// ---------------------------------------------------------------------------------------------------------------
// Sidik jari
// ---------------------------------------------------------------------------------------------------------------

/** `kode`: 1 = sudah rekam sidik jari pada tanggal itu, 0 = belum. */
export const vclaimFingerprintResponseSchema = z.object({ kode: z.enum(['0', '1']), status: z.string() });
export type VclaimFingerprintResponse = z.infer<typeof vclaimFingerprintResponseSchema>;

// ---------------------------------------------------------------------------------------------------------------
// Rencana kontrol + SPRI
// ---------------------------------------------------------------------------------------------------------------

export const vclaimRencanaKontrolRequestSchema = z.object({
  request: z.object({
    noSEP: z.string().min(1),
    kodeDokter: z.string().min(1),
    poliKontrol: z.string().min(1),
    tglRencanaKontrol: bpjsDateSchema,
    user: z.string().min(1).max(30),
  }),
});
export type VclaimRencanaKontrolRequest = z.infer<typeof vclaimRencanaKontrolRequestSchema>;

export const vclaimSpriRequestSchema = z.object({
  request: z.object({
    noKartu: bpjsNoKartuSchema,
    kodeDokter: z.string().min(1),
    poliKontrol: z.string().min(1),
    tglRencanaKontrol: bpjsDateSchema,
    user: z.string().min(1).max(30),
  }),
});
export type VclaimSpriRequest = z.infer<typeof vclaimSpriRequestSchema>;

const suratResponseBase = {
  tglRencanaKontrol: bpjsDateSchema,
  namaDokter: z.string(),
  noKartu: bpjsNoKartuSchema,
  nama: z.string(),
  kelamin: z.string(),
  tglLahir: bpjsDateSchema,
  namaDiagnosa: z.string().nullable(),
};

/** Format nomor surat: `<PPK 8><MMYY>K<6 digit>`. */
export const vclaimRencanaKontrolResponseSchema = z.object({
  noSuratKontrol: z.string(),
  ...suratResponseBase,
});
export type VclaimRencanaKontrolResponse = z.infer<typeof vclaimRencanaKontrolResponseSchema>;
export const vclaimSpriResponseSchema = z.object({ noSPRI: z.string(), ...suratResponseBase });
export type VclaimSpriResponse = z.infer<typeof vclaimSpriResponseSchema>;

/** `jnsKontrol`: 1 = SPRI, 2 = surat kontrol. */
export const VCLAIM_JENIS_SURAT = { spri: '1', kontrol: '2' } as const;

export const vclaimSuratKontrolSchema = z.object({
  noSuratKontrol: z.string(),
  jnsKontrol: z.enum(['1', '2']),
  namaJnsKontrol: z.string(),
  tglRencanaKontrol: bpjsDateSchema,
  tglTerbit: bpjsDateSchema,
  poliTujuan: z.string(),
  namaPoliTujuan: z.string(),
  kodeDokter: z.string(),
  namaDokter: z.string(),
  noKartu: bpjsNoKartuSchema,
  nama: z.string(),
  /** SEP asal (surat kontrol); null untuk SPRI. */
  noSepAsal: z.string().nullable(),
});
export type VclaimSuratKontrol = z.infer<typeof vclaimSuratKontrolSchema>;

// ---------------------------------------------------------------------------------------------------------------
// Referensi + histori
// ---------------------------------------------------------------------------------------------------------------

export const vclaimRefPoliResponseSchema = z.object({ poli: z.array(bpjsKodeNamaSchema) });
export type VclaimRefPoliResponse = z.infer<typeof vclaimRefPoliResponseSchema>;
export const vclaimRefDokterResponseSchema = z.object({ list: z.array(bpjsKodeNamaSchema) });
export type VclaimRefDokterResponse = z.infer<typeof vclaimRefDokterResponseSchema>;

export const vclaimHistoriSchema = z.object({
  noSep: z.string(),
  tglSep: bpjsDateSchema,
  /** Kosong selama belum pulang. */
  tglPlgSep: z.string(),
  jnsPelayanan: z.enum(['1', '2']),
  kelasRawat: z.string(),
  diagnosa: z.string(),
  noKartu: bpjsNoKartuSchema,
  namaPeserta: z.string(),
  noRujukan: z.string(),
  poli: z.string(),
  ppkPelayanan: z.string(),
});
export type VclaimHistori = z.infer<typeof vclaimHistoriSchema>;
export const vclaimHistoriResponseSchema = z.object({ histori: z.array(vclaimHistoriSchema) });
export type VclaimHistoriResponse = z.infer<typeof vclaimHistoriResponseSchema>;

export const vclaimRefDiagnosaResponseSchema = z.object({ diagnosa: z.array(bpjsKodeNamaSchema) });
export type VclaimRefDiagnosaResponse = z.infer<typeof vclaimRefDiagnosaResponseSchema>;
export const vclaimRefFaskesResponseSchema = z.object({ faskes: z.array(bpjsKodeNamaSchema) });
export type VclaimRefFaskesResponse = z.infer<typeof vclaimRefFaskesResponseSchema>;
/** `jenisFaskes` referensi faskes. */
export const VCLAIM_JENIS_FASKES = { fktp: '1', rs: '2' } as const;

// ---------------------------------------------------------------------------------------------------------------
// SEP pulang (rawat inap)
// ---------------------------------------------------------------------------------------------------------------

/** `statusPulang`: 1 atas persetujuan dokter, 3 atas permintaan sendiri, 4 meninggal, 5 lain-lain. */
export const VCLAIM_STATUS_PULANG = {
  persetujuanDokter: '1',
  permintaanSendiri: '3',
  meninggal: '4',
  lainLain: '5',
} as const;

export const vclaimSepPulangRequestSchema = z.object({
  request: z.object({
    t_sep: z
      .object({
        noSep: z.string().min(1),
        statusPulang: z.enum(['1', '3', '4', '5']),
        /** Wajib bila meninggal. */
        noSuratMeninggal: optionalText,
        tglMeninggal: z.union([bpjsDateSchema, z.literal('')]),
        tglPulang: bpjsDateSchema,
        noLPManual: optionalText,
        user: z.string().min(1).max(30),
      })
      .refine((t) => t.statusPulang !== '4' || (t.noSuratMeninggal !== '' && t.tglMeninggal !== ''), {
        message: 'noSuratMeninggal dan tglMeninggal wajib bila meninggal',
        path: ['noSuratMeninggal'],
      }),
  }),
});
export type VclaimSepPulangRequest = z.infer<typeof vclaimSepPulangRequestSchema>;

// ---------------------------------------------------------------------------------------------------------------
// Ubah/hapus rencana kontrol + SPRI
// ---------------------------------------------------------------------------------------------------------------

export const vclaimRencanaKontrolUpdateRequestSchema = z.object({
  request: z.object({
    noSuratKontrol: z.string().min(1),
    noSEP: z.string().min(1),
    kodeDokter: z.string().min(1),
    poliKontrol: z.string().min(1),
    tglRencanaKontrol: bpjsDateSchema,
    user: z.string().min(1).max(30),
  }),
});
export type VclaimRencanaKontrolUpdateRequest = z.infer<typeof vclaimRencanaKontrolUpdateRequestSchema>;

export const vclaimSpriUpdateRequestSchema = z.object({
  request: z.object({
    noSPRI: z.string().min(1),
    kodeDokter: z.string().min(1),
    poliKontrol: z.string().min(1),
    tglRencanaKontrol: bpjsDateSchema,
    user: z.string().min(1).max(30),
  }),
});
export type VclaimSpriUpdateRequest = z.infer<typeof vclaimSpriUpdateRequestSchema>;

export const vclaimRencanaKontrolDeleteRequestSchema = z.object({
  request: z.object({
    t_suratkontrol: z.object({ noSuratKontrol: z.string().min(1), user: z.string().min(1).max(30) }),
  }),
});
export type VclaimRencanaKontrolDeleteRequest = z.infer<typeof vclaimRencanaKontrolDeleteRequestSchema>;

/** Respons hapus surat: nomor surat (string terenkripsi). */
export const vclaimNoSuratResponseSchema = z.string().min(1);

// ---------------------------------------------------------------------------------------------------------------
// F07 · Rujukan keluar
// ---------------------------------------------------------------------------------------------------------------

/** `tipeRujukan`: 0 penuh, 1 partial (ke RS), 2 rujuk balik (ke FKTP). */
export const VCLAIM_TIPE_RUJUKAN = { penuh: '0', partial: '1', rujukBalik: '2' } as const;

const rujukanKeluarFields = {
  tglRujukan: bpjsDateSchema,
  tglRencanaKunjungan: bpjsDateSchema,
  ppkDirujuk: bpjsKodePpkSchema,
  jnsPelayanan: z.enum(['1', '2']),
  catatan: optionalText,
  diagRujukan: bpjsIcd10Schema,
  tipeRujukan: z.enum(['0', '1', '2']),
  /** Kode poli BPJS tujuan; boleh kosong untuk rujuk balik dan rawat inap. */
  poliRujukan: optionalText,
  user: z.string().min(1).max(30),
};

export const vclaimRujukanKeluarInsertRequestSchema = z.object({
  request: z.object({ t_rujukan: z.object({ noSep: z.string().min(1), ...rujukanKeluarFields }) }),
});
export type VclaimRujukanKeluarInsertRequest = z.infer<typeof vclaimRujukanKeluarInsertRequestSchema>;
export type VclaimRujukanKeluarTRujukan = VclaimRujukanKeluarInsertRequest['request']['t_rujukan'];

export const vclaimRujukanKeluarUpdateRequestSchema = z.object({
  request: z.object({ t_rujukan: z.object({ noRujukan: z.string().min(1), ...rujukanKeluarFields }) }),
});
export type VclaimRujukanKeluarUpdateRequest = z.infer<typeof vclaimRujukanKeluarUpdateRequestSchema>;

export const vclaimRujukanKeluarDeleteRequestSchema = z.object({
  request: z.object({
    t_rujukan: z.object({ noRujukan: z.string().min(1), user: z.string().min(1).max(30) }),
  }),
});
export type VclaimRujukanKeluarDeleteRequest = z.infer<typeof vclaimRujukanKeluarDeleteRequestSchema>;

/** Format nomor `<PPK asal 8><MMYY>B<6 digit>`; berlaku s.d. `tglBerlakuKunjungan` (90 hari). */
export const vclaimRujukanKeluarSchema = z.object({
  noRujukan: z.string(),
  noSep: z.string(),
  tglRujukan: bpjsDateSchema,
  tglRencanaKunjungan: bpjsDateSchema,
  tglBerlakuKunjungan: bpjsDateSchema,
  jnsPelayanan: z.enum(['1', '2']),
  tipeRujukan: bpjsKodeNamaSchema,
  AsalRujukan: bpjsKodeNamaSchema,
  tujuanRujukan: bpjsKodeNamaSchema,
  poliTujuan: bpjsKodeNamaSchema,
  diagnosa: bpjsKodeNamaSchema,
  catatan: z.string(),
  peserta: vclaimSepPesertaSchema,
});
export type VclaimRujukanKeluar = z.infer<typeof vclaimRujukanKeluarSchema>;
export const vclaimRujukanKeluarResponseSchema = z.object({ rujukan: vclaimRujukanKeluarSchema });
export type VclaimRujukanKeluarResponse = z.infer<typeof vclaimRujukanKeluarResponseSchema>;
/** Respons ubah/hapus rujukan keluar: nomor rujukan (string terenkripsi). */
export const vclaimNoRujukanResponseSchema = z.string().min(1);
