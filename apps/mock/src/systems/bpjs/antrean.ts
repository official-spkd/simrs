import {
  ANTREAN_ENDPOINTS,
  ANTREAN_JENIS_KUNJUNGAN,
  ANTREAN_TASK_BATAL,
  ANTREAN_TASK_LABEL,
  type AntreanRefDokter,
  type AntreanRefPoli,
  type AntreanTask,
  type AntreanTaskId,
  antreanAddRequestSchema,
  antreanBatalRequestSchema,
  antreanGetListTaskRequestSchema,
  antreanNextTaskIds,
  antreanUpdateWaktuRequestSchema,
  checkAntreanTask,
  formatAntreanWaktu,
  hfisJamPraktek,
  vclaimRujukanKedaluwarsa,
} from '@simrs/shared';
import type { FastifyInstance } from 'fastify';
import { antreanFail, type BpjsContext, zodDetail } from './context';
import { hfisJadwalOn } from './hfis';
import { dokterByKode, MOCK_DOKTER, MOCK_POLI, poliByKode } from './master';
import { pesertaAktif, pesertaByKartu } from './peserta';
import { buildRujukan, parseNoRujukan } from './rujukan';
import type { AntreanRecord } from './state';

/** Toleransi jam RS lebih cepat dari jam BPJS untuk `waktu` task (ms). */
const TOLERANSI_WAKTU_MASA_DEPAN_MS = 5 * 60_000;

/**
 * Antrean RS: tambah antrean (validasi isian, jadwal HFIS, kuota), waktu task ID (urutan ditegakkan seperti BPJS:
 * `checkAntreanTask` di kontrak bersama), batal, daftar task, dan referensi.
 */
export function registerAntrean(app: FastifyInstance, ctx: BpjsContext): void {
  const bpjs = ctx.state.bpjs;

  app.post(ANTREAN_ENDPOINTS.add.path, async (req) => {
    const parsed = antreanAddRequestSchema.safeParse(req.body);
    if (!parsed.success) return antreanFail('BPJS_VALIDASI', zodDetail(parsed.error));
    const b = parsed.data;
    if (bpjs.antrean.has(b.kodebooking)) return antreanFail('BPJS_ANTREAN_GANDA', b.kodebooking);
    const today = ctx.today();
    if (b.tanggalperiksa < today)
      return antreanFail('BPJS_TANGGAL_TIDAK_VALID', 'tanggalperiksa sudah lewat');

    const poli = poliByKode(b.kodepoli);
    if (!poli) return antreanFail('BPJS_POLI_TIDAK_DITEMUKAN', b.kodepoli);
    const dokter = dokterByKode(b.kodedokter);
    if (!dokter || dokter.kodepoli !== poli.kode) {
      return antreanFail('BPJS_DOKTER_TIDAK_DITEMUKAN', `${b.kodedokter} di poli ${poli.kode}`);
    }
    const sesi = hfisJadwalOn(bpjs, poli.kode, b.tanggalperiksa, dokter.kode).find(
      (j) => hfisJamPraktek(j.jadwal) === b.jampraktek,
    );
    if (!sesi) {
      return antreanFail('BPJS_JADWAL_TIDAK_DITEMUKAN', `${dokter.kode} ${b.tanggalperiksa} ${b.jampraktek}`);
    }
    if (sesi.libur === 1) return antreanFail('BPJS_JADWAL_LIBUR', b.tanggalperiksa);

    if (b.jenispasien === 'JKN') {
      const peserta = pesertaByKartu(bpjs, b.nomorkartu, b.tanggalperiksa, today);
      if (!peserta) return antreanFail('BPJS_PESERTA_TIDAK_DITEMUKAN');
      if (!pesertaAktif(peserta)) return antreanFail('BPJS_PESERTA_TIDAK_AKTIF');
      const viaRujukan =
        b.jeniskunjungan === ANTREAN_JENIS_KUNJUNGAN.rujukanFktp ||
        b.jeniskunjungan === ANTREAN_JENIS_KUNJUNGAN.rujukanAntarRs;
      const ruj = viaRujukan ? parseNoRujukan(b.nomorreferensi) : null;
      if (ruj && vclaimRujukanKedaluwarsa(buildRujukan(ruj, peserta, today).tglKunjungan, b.tanggalperiksa)) {
        return antreanFail('BPJS_RUJUKAN_KEDALUWARSA', b.nomorreferensi);
      }
    }

    const terisi = [...bpjs.antrean.values()].filter(
      (a) =>
        a.status === 'aktif' &&
        a.request.kodedokter === b.kodedokter &&
        a.request.tanggalperiksa === b.tanggalperiksa &&
        a.request.jampraktek === b.jampraktek,
    ).length;
    if (terisi >= sesi.kapasitaspasien) {
      return antreanFail('BPJS_KUOTA_PENUH', `${terisi}/${sesi.kapasitaspasien}`);
    }

    const rec: AntreanRecord = {
      kodebooking: b.kodebooking,
      request: b,
      status: 'aktif',
      dibuat: ctx.config.now().toISOString(),
      tasks: [],
      batal: null,
    };
    bpjs.antrean.set(b.kodebooking, rec);
    return ctx.antreanOk(req);
  });

  app.post(ANTREAN_ENDPOINTS.updateWaktu.path, async (req) => {
    const parsed = antreanUpdateWaktuRequestSchema.safeParse(req.body);
    if (!parsed.success) return antreanFail('BPJS_VALIDASI', zodDetail(parsed.error));
    const { kodebooking, taskid, waktu, jenisresep } = parsed.data;
    const rec = bpjs.antrean.get(kodebooking);
    if (!rec) return antreanFail('BPJS_ANTREAN_TIDAK_DITEMUKAN', kodebooking);
    if (rec.status === 'batal') return antreanFail('BPJS_ANTREAN_SUDAH_BATAL', kodebooking);
    const now = ctx.config.now().getTime();
    if (waktu > now + TOLERANSI_WAKTU_MASA_DEPAN_MS) {
      return antreanFail('BPJS_TANGGAL_TIDAK_VALID', `waktu TaskId=${taskid} melewati waktu sekarang`);
    }
    const rejection = checkAntreanTask(rec.tasks, { taskid, waktu });
    if (rejection === 'BPJS_TASK_TIDAK_BERURUTAN') {
      const next = antreanNextTaskIds(rec.tasks.map((t) => t.taskid));
      return antreanFail(
        rejection,
        `TaskId=${taskid}, yang diterima berikutnya: ${next.length ? next.join(' atau ') : 'tidak ada'}`,
      );
    }
    if (rejection) return antreanFail(rejection, `TaskId=${taskid}`);
    rec.tasks.push({ taskid, waktu, diterima: now, ...(jenisresep ? { jenisresep } : {}) });
    if (taskid === ANTREAN_TASK_BATAL) {
      rec.status = 'batal';
      rec.batal = { keterangan: 'Task 99', at: new Date(now).toISOString(), lewat: 'task99' };
    }
    return ctx.antreanOk(req);
  });

  app.post(ANTREAN_ENDPOINTS.batal.path, async (req) => {
    const parsed = antreanBatalRequestSchema.safeParse(req.body);
    if (!parsed.success) return antreanFail('BPJS_VALIDASI', zodDetail(parsed.error));
    const { kodebooking, keterangan } = parsed.data;
    const rec = bpjs.antrean.get(kodebooking);
    if (!rec) return antreanFail('BPJS_ANTREAN_TIDAK_DITEMUKAN', kodebooking);
    if (rec.status === 'batal') return antreanFail('BPJS_ANTREAN_SUDAH_BATAL', kodebooking);
    if (rec.tasks.some((t) => t.taskid >= 4 && t.taskid !== ANTREAN_TASK_BATAL)) {
      return antreanFail('BPJS_ANTREAN_SUDAH_DILAYANI', kodebooking);
    }
    rec.status = 'batal';
    rec.batal = { keterangan, at: ctx.config.now().toISOString(), lewat: 'batal' };
    return ctx.antreanOk(req);
  });

  app.post(ANTREAN_ENDPOINTS.getListTask.path, async (req) => {
    const parsed = antreanGetListTaskRequestSchema.safeParse(req.body);
    if (!parsed.success) return antreanFail('BPJS_VALIDASI', zodDetail(parsed.error));
    const rec = bpjs.antrean.get(parsed.data.kodebooking);
    if (!rec) return antreanFail('BPJS_ANTREAN_TIDAK_DITEMUKAN', parsed.data.kodebooking);
    const list: AntreanTask[] = rec.tasks.map((t) => ({
      kodebooking: rec.kodebooking,
      taskid: t.taskid,
      taskname: ANTREAN_TASK_LABEL[t.taskid as AntreanTaskId] ?? '',
      waktu: formatAntreanWaktu(t.waktu),
      wakturs: formatAntreanWaktu(t.diterima),
    }));
    return ctx.antreanOk(req, list);
  });

  app.get(ANTREAN_ENDPOINTS.refPoli.path, async (req) => {
    const list: AntreanRefPoli[] = MOCK_POLI.map((p) => ({
      kdpoli: p.kode,
      nmpoli: p.nama,
      kdsubspesialis: p.kode,
      nmsubspesialis: p.nama,
    }));
    return ctx.antreanOk(req, list);
  });

  app.get(ANTREAN_ENDPOINTS.refDokter.path, async (req) => {
    const list: AntreanRefDokter[] = MOCK_DOKTER.map((d) => ({ kodedokter: d.kode, namadokter: d.nama }));
    return ctx.antreanOk(req, list);
  });
}
