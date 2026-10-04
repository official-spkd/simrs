import { ANTREAN_TASK_LABEL, type AntreanTaskId, bpjsDateSchema, isoDateJakarta } from '@simrs/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { MockConfig } from '../../config';
import type { MockState } from '../../state';
import { aplicareList } from './aplicare';
import { dokterByKode, MOCK_DOKTER } from './master';
import { isFictionalKartu, pesertaByKartu } from './peserta';
import type { AntreanRecord, BpjsState, RujukanKeluarRecord, SepRecord, SuratRecord } from './state';

/**
 * API panel BPJS untuk panel HTML dan helper E2E (agen A, potongan 1d). Bukan bagian kontrak BPJS: hanya di mock.
 *
 * - `GET  /_panel/api/bpjs`                       → ringkasan: antrean + task, SEP, surat, sidik jari, HFIS
 * - `GET  /_panel/api/bpjs/antrean/:kodebooking`  → satu antrean + task (404 bila tidak ada)
 * - `GET  /_panel/api/bpjs/sep/:noSep`            → satu SEP (termasuk yang dihapus; 404 bila tidak ada)
 * - `GET  /_panel/api/bpjs/aplicare/:kodeppk`     → ruang Aplicare terdaftar milik PPK (kosong bila belum ada)
 * - `POST /_panel/api/bpjs/fingerprint`           → `{ noKartu, tanggal? }` peserta rekam sidik jari (bawaan hari ini)
 * - `POST /_panel/api/bpjs/hfis`                  → `{ kodedokter, tanggal, libur?, kapasitaspasien? }` seperti
 *                                                  petugas mengubah aplikasi HFIS (libur/cuti, kapasitas per tanggal)
 * - `POST /_panel/api/bpjs/peserta`               → `{ noKartu, nik, nama?, sex?, tglLahir?, aktif?, hakKelas? }`
 *                                                  tetapkan peserta (mis. agar cocok dengan pasien seed)
 */

export interface AntreanView {
  kodebooking: string;
  status: AntreanRecord['status'];
  jenispasien: string;
  nomorkartu: string;
  kodepoli: string;
  kodedokter: number;
  namadokter: string;
  tanggalperiksa: string;
  jampraktek: string;
  nomorantrean: string;
  dibuat: string;
  /** Task terurut sesuai diterima; `waktu` milidetik epoch dari RS. */
  tasks: Array<{ taskid: number; taskname: string; waktu: number; waktuIso: string; diterima: string }>;
  batal: AntreanRecord['batal'];
}

export interface SepView {
  noSep: string;
  status: SepRecord['status'];
  tglSep: string;
  jnsPelayanan: string;
  noKartu: string;
  nama: string;
  poli: string;
  dpjpLayan: string;
  noRujukan: string;
  noSurat: string;
  diagAwal: string;
  versi: number;
  dibuat: string;
  diubah: string | null;
  dihapus: string | null;
  /** Rawat inap: tanggal pulang (`updtglplg`), null bila belum. */
  tglPulang: string | null;
}

export function antreanView(a: AntreanRecord): AntreanView {
  return {
    kodebooking: a.kodebooking,
    status: a.status,
    jenispasien: a.request.jenispasien,
    nomorkartu: a.request.nomorkartu,
    kodepoli: a.request.kodepoli,
    kodedokter: a.request.kodedokter,
    namadokter: a.request.namadokter,
    tanggalperiksa: a.request.tanggalperiksa,
    jampraktek: a.request.jampraktek,
    nomorantrean: a.request.nomorantrean,
    dibuat: a.dibuat,
    tasks: a.tasks.map((t) => ({
      taskid: t.taskid,
      taskname: ANTREAN_TASK_LABEL[t.taskid as AntreanTaskId] ?? '',
      waktu: t.waktu,
      waktuIso: new Date(t.waktu).toISOString(),
      diterima: new Date(t.diterima).toISOString(),
    })),
    batal: a.batal,
  };
}

export function sepPanelView(s: SepRecord): SepView {
  return {
    noSep: s.noSep,
    status: s.status,
    tglSep: s.tSep.tglSep,
    jnsPelayanan: s.tSep.jnsPelayanan === '1' ? 'Rawat Inap' : 'Rawat Jalan',
    noKartu: s.tSep.noKartu,
    nama: s.peserta.nama,
    poli: s.tSep.poli.tujuan,
    dpjpLayan: s.tSep.dpjpLayan,
    noRujukan: s.tSep.rujukan.noRujukan,
    noSurat: s.tSep.skdp.noSurat,
    diagAwal: s.tSep.diagAwal,
    versi: s.versi,
    dibuat: s.dibuat,
    diubah: s.diubah,
    dihapus: s.dihapus,
    tglPulang: s.pulang?.tglPulang ?? null,
  };
}

function rujukanKeluarView(r: RujukanKeluarRecord) {
  return {
    noRujukan: r.noRujukan,
    status: r.status,
    noSep: r.tRujukan.noSep,
    noKartu: r.peserta.noKartu,
    tglRujukan: r.tRujukan.tglRujukan,
    tglRencanaKunjungan: r.tRujukan.tglRencanaKunjungan,
    ppkDirujuk: r.tRujukan.ppkDirujuk,
    tipeRujukan: r.tRujukan.tipeRujukan,
    poliRujukan: r.tRujukan.poliRujukan,
    diagRujukan: r.tRujukan.diagRujukan,
    dibuat: r.dibuat,
    diubah: r.diubah,
    dihapus: r.dihapus,
  };
}

function suratView(s: SuratRecord) {
  return { ...s, namaDokter: dokterByKode(s.kodeDokter)?.nama ?? '' };
}

/** Terbaru di depan (Map menyimpan urutan sisip). */
const newestFirst = <T>(m: Map<string, T>, limit: number) => [...m.values()].reverse().slice(0, limit);

export function bpjsPanelSummary(bpjs: BpjsState, limit = 100) {
  return {
    antrean: newestFirst(bpjs.antrean, limit).map(antreanView),
    seps: newestFirst(bpjs.seps, limit).map(sepPanelView),
    surat: newestFirst(bpjs.surat, limit).map(suratView),
    rujukanKeluar: newestFirst(bpjs.rujukanKeluar, limit).map(rujukanKeluarView),
    aplicare: [...bpjs.aplicare.keys()].map((kodeppk) => ({ kodeppk, ruang: aplicareList(bpjs, kodeppk) })),
    fingerprints: [...bpjs.fingerprints].map((k) => {
      const [noKartu = '', tanggal = ''] = k.split('|');
      return { noKartu, tanggal };
    }),
    hfis: {
      overrides: [...bpjs.hfisOverride.values()],
      updates: bpjs.hfisUpdates,
    },
  };
}

const kartu = z.string().regex(/^0000\d{9}$/, 'No. kartu fiktif: 13 digit berawalan 0000');

const fingerprintSchema = z.strictObject({ noKartu: kartu, tanggal: bpjsDateSchema.optional() });

const hfisOverrideSchema = z
  .strictObject({
    kodedokter: z.number().int().positive(),
    tanggal: bpjsDateSchema,
    libur: z.boolean().optional(),
    kapasitaspasien: z.number().int().min(0).max(500).optional(),
  })
  .refine((b) => b.libur !== undefined || b.kapasitaspasien !== undefined, {
    message: 'Isi libur dan/atau kapasitaspasien',
  });

const pesertaSchema = z.strictObject({
  noKartu: kartu,
  nik: z.string().regex(/^9999\d{12}$/, 'NIK fiktif: 16 digit berawalan 9999'),
  nama: z.string().min(1).max(120).optional(),
  sex: z.enum(['L', 'P']).optional(),
  tglLahir: bpjsDateSchema.optional(),
  aktif: z.boolean().optional(),
  hakKelas: z.enum(['1', '2', '3']).optional(),
});

export function registerBpjsPanel(app: FastifyInstance, config: MockConfig, state: MockState): void {
  const bad = (message: string) => ({ code: 'VALIDATION_FAILED', message });
  const today = () => isoDateJakarta(config.now());

  app.get('/_panel/api/bpjs', async () => bpjsPanelSummary(state.bpjs));

  app.get<{ Params: { kodebooking: string } }>(
    '/_panel/api/bpjs/antrean/:kodebooking',
    async (req, reply) => {
      const a = state.bpjs.antrean.get(req.params.kodebooking);
      if (!a) return reply.code(404).send({ code: 'NOT_FOUND', message: 'Antrean tidak ada di mock' });
      return antreanView(a);
    },
  );

  app.get<{ Params: { noSep: string } }>('/_panel/api/bpjs/sep/:noSep', async (req, reply) => {
    const s = state.bpjs.seps.get(req.params.noSep);
    if (!s) return reply.code(404).send({ code: 'NOT_FOUND', message: 'SEP tidak ada di mock' });
    return sepPanelView(s);
  });

  app.get<{ Params: { kodeppk: string } }>('/_panel/api/bpjs/aplicare/:kodeppk', async (req) => ({
    kodeppk: req.params.kodeppk,
    ruang: aplicareList(state.bpjs, req.params.kodeppk),
  }));

  app.post('/_panel/api/bpjs/fingerprint', async (req, reply) => {
    const parsed = fingerprintSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(bad('noKartu fiktif wajib; tanggal YYYY-MM-DD'));
    const tanggal = parsed.data.tanggal ?? today();
    state.bpjs.fingerprints.add(`${parsed.data.noKartu}|${tanggal}`);
    return { noKartu: parsed.data.noKartu, tanggal, kode: '1' };
  });

  app.post('/_panel/api/bpjs/hfis', async (req, reply) => {
    const parsed = hfisOverrideSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send(bad('kodedokter, tanggal, dan libur/kapasitaspasien wajib'));
    }
    const b = parsed.data;
    if (!MOCK_DOKTER.some((d) => d.kode === b.kodedokter)) {
      return reply.code(404).send({ code: 'NOT_FOUND', message: 'Dokter HFIS tidak ada di mock' });
    }
    const key = `${b.kodedokter}|${b.tanggal}`;
    const cur = state.bpjs.hfisOverride.get(key);
    const next = {
      kodedokter: b.kodedokter,
      tanggal: b.tanggal,
      ...(cur?.libur !== undefined ? { libur: cur.libur } : {}),
      ...(cur?.kapasitaspasien !== undefined ? { kapasitaspasien: cur.kapasitaspasien } : {}),
      ...(b.libur !== undefined ? { libur: b.libur } : {}),
      ...(b.kapasitaspasien !== undefined ? { kapasitaspasien: b.kapasitaspasien } : {}),
    };
    state.bpjs.hfisOverride.set(key, next);
    return next;
  });

  app.post('/_panel/api/bpjs/peserta', async (req, reply) => {
    const parsed = pesertaSchema.safeParse(req.body);
    if (!parsed.success || !isFictionalKartu(parsed.data.noKartu)) {
      return reply.code(400).send(bad('noKartu (0000…) dan nik (9999…) fiktif wajib'));
    }
    const p = parsed.data;
    state.bpjs.pesertaOverride.set(p.noKartu, p);
    state.bpjs.nikByKartu.set(p.noKartu, p.nik);
    state.bpjs.kartuByNik.set(p.nik, p.noKartu);
    return pesertaByKartu(state.bpjs, p.noKartu, today(), today());
  });
}
