import {
  bpjsDateSchema,
  formatHfisJadwal,
  HFIS_ENDPOINTS,
  HFIS_HARI,
  type HfisHari,
  type HfisJadwalDokter,
  hfisHariOf,
  hfisUpdateJadwalRequestSchema,
} from '@simrs/shared';
import type { FastifyInstance } from 'fastify';
import { antreanFail, type BpjsContext, zodDetail } from './context';
import { dokterByKode, MOCK_DOKTER, poliByKode } from './master';
import { type BpjsState, hfisKey } from './state';

/**
 * Jadwal dokter HFIS: templat mingguan (diganti lewat `updatejadwaldokter`) + perubahan per tanggal yang dicatat
 * petugas di aplikasi HFIS (panel: libur/cuti, kapasitas). Sesi hari 8 (libur nasional) disimpan, tetapi mock tidak
 * punya kalender libur sehingga tidak pernah muncul pada tanggal tertentu.
 */

/** Sesi HFIS satu poli pada satu tanggal (opsional disaring per dokter), urut kode dokter lalu jam buka. */
export function hfisJadwalOn(
  state: BpjsState,
  kodepoli: string,
  tanggal: string,
  kodedokter?: number,
): HfisJadwalDokter[] {
  const poli = poliByKode(kodepoli);
  if (!poli) return [];
  const hari = hfisHariOf(tanggal);
  const out: HfisJadwalDokter[] = [];
  for (const d of MOCK_DOKTER) {
    if (kodedokter !== undefined && d.kode !== kodedokter) continue;
    const sesi = state.hfisTemplat.get(hfisKey(kodepoli, d.kode)) ?? [];
    const ov = state.hfisOverride.get(`${d.kode}|${tanggal}`);
    for (const s of sesi.filter((x) => x.hari === hari).sort((a, b) => a.buka.localeCompare(b.buka))) {
      out.push({
        kodedokter: d.kode,
        namadokter: d.nama,
        kodepoli: poli.kode,
        namapoli: poli.nama,
        kodesubspesialis: poli.kode,
        namasubspesialis: poli.nama,
        hari,
        namahari: HFIS_HARI[hari],
        jadwal: formatHfisJadwal(s.buka, s.tutup),
        kapasitaspasien: ov?.kapasitaspasien ?? s.kapasitas,
        libur: ov?.libur ? 1 : 0,
      });
    }
  }
  return out;
}

export function registerHfis(app: FastifyInstance, ctx: BpjsContext): void {
  const { state } = ctx;

  app.get<{ Params: { kodepoli: string; tanggal: string } }>(
    HFIS_ENDPOINTS.jadwalDokter.path,
    async (req) => {
      const { kodepoli, tanggal } = req.params;
      if (!bpjsDateSchema.safeParse(tanggal).success) {
        return antreanFail('BPJS_VALIDASI', 'tanggal harus YYYY-MM-DD');
      }
      if (!poliByKode(kodepoli)) return antreanFail('BPJS_POLI_TIDAK_DITEMUKAN', kodepoli);
      const list = hfisJadwalOn(state.bpjs, kodepoli, tanggal);
      if (list.length === 0) return antreanFail('BPJS_JADWAL_TIDAK_DITEMUKAN', `${kodepoli} ${tanggal}`);
      return ctx.antreanOk(req, list);
    },
  );

  app.post(HFIS_ENDPOINTS.updateJadwalDokter.path, async (req) => {
    const parsed = hfisUpdateJadwalRequestSchema.safeParse(req.body);
    if (!parsed.success) return antreanFail('BPJS_VALIDASI', zodDetail(parsed.error));
    const b = parsed.data;
    const poli = poliByKode(b.kodepoli);
    if (!poli || b.kodesubspesialis !== poli.kode) {
      return antreanFail('BPJS_POLI_TIDAK_DITEMUKAN', `${b.kodepoli}/${b.kodesubspesialis}`);
    }
    const dokter = dokterByKode(b.kodedokter);
    if (!dokter || dokter.kodepoli !== poli.kode) {
      return antreanFail('BPJS_DOKTER_TIDAK_DITEMUKAN', `${b.kodedokter} di poli ${poli.kode}`);
    }
    const key = hfisKey(poli.kode, dokter.kode);
    const lama = state.bpjs.hfisTemplat.get(key) ?? [];
    // Kapasitas tidak ikut dikirim web service: pakai kapasitas sesi lama di hari yang sama.
    const kapasitasBawaan = lama[0]?.kapasitas ?? 20;
    state.bpjs.hfisTemplat.set(
      key,
      b.jadwal.map((j) => {
        const hari = Number(j.hari) as HfisHari;
        return {
          hari,
          buka: j.buka,
          tutup: j.tutup,
          kapasitas: lama.find((s) => s.hari === hari)?.kapasitas ?? kapasitasBawaan,
        };
      }),
    );
    state.bpjs.hfisUpdates.unshift({
      at: ctx.config.now().toISOString(),
      kodepoli: poli.kode,
      kodedokter: dokter.kode,
      jadwal: b.jadwal.map((j) => `${HFIS_HARI[Number(j.hari) as HfisHari]} ${j.buka}-${j.tutup}`),
    });
    state.bpjs.hfisUpdates.length = Math.min(state.bpjs.hfisUpdates.length, 50);
    return ctx.antreanOk(req);
  });
}
