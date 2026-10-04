import {
  APLICARE_ENDPOINTS,
  APLICARE_ERROR_CODE,
  APLICARE_KELAS,
  APLICARE_OK,
  type AplicareBed,
  aplicareBedDeleteRequestSchema,
  aplicareBedRequestSchema,
  type BpjsRejectionKnownCode,
  bpjsKodePpkSchema,
  bpjsRejectionMessage,
} from '@simrs/shared';
import type { FastifyInstance } from 'fastify';
import type { BpjsContext } from './context';
import { zodDetail } from './context';
import type { AplicareRuangRecord, BpjsState } from './state';

/**
 * Aplicare (I03 → K05): ketersediaan tempat tidur per kelas + ruang per PPK. Ruang harus didaftarkan (`create`)
 * sebelum diperbarui (`update`); `read` berhalaman (`start` mulai 1). Respons polos (tidak terenkripsi), sukses
 * `metadata.code` = 1. Awalnya kosong: papan bed (fase 3) yang mendaftarkan ruang.
 */

const ok = (extra: object = {}) => ({ metadata: { code: APLICARE_OK, message: 'OK', ...extra } });
const fail = (code: BpjsRejectionKnownCode, detail?: string) => ({
  metadata: { code: APLICARE_ERROR_CODE, message: bpjsRejectionMessage(code, detail) },
});

const ruangKey = (kodekelas: string, koderuang: string) => `${kodekelas}|${koderuang}`;

/** `YYYY-MM-DD HH:mm:ss` WIB (UTC+7). */
function waktuWib(d: Date): string {
  return new Date(d.getTime() + 7 * 3_600_000).toISOString().slice(0, 19).replace('T', ' ');
}

export function aplicareList(state: BpjsState, kodeppk: string): AplicareBed[] {
  return [...(state.aplicare.get(kodeppk)?.values() ?? [])].map((r, i) => ({
    kodeppk,
    kodekelas: r.kodekelas,
    namakelas: APLICARE_KELAS.find((k) => k.kodekelas === r.kodekelas)?.namakelas ?? r.kodekelas,
    koderuang: r.koderuang,
    namaruang: r.namaruang,
    kapasitas: r.kapasitas,
    tersedia: r.tersedia,
    tersediapria: r.tersediapria,
    tersediawanita: r.tersediawanita,
    tersediapriawanita: r.tersediapriawanita,
    lastupdate: r.lastupdate,
    rownumber: i + 1,
  }));
}

export function registerAplicare(app: FastifyInstance, ctx: BpjsContext): void {
  const bpjs = ctx.state.bpjs;
  const isPpk = (v: string) => bpjsKodePpkSchema.safeParse(v).success;
  const kelasAda = (kode: string) => APLICARE_KELAS.some((k) => k.kodekelas === kode);

  app.get(APLICARE_ENDPOINTS.refKelas.path, async () => ({
    response: { list: APLICARE_KELAS.map((k) => ({ ...k })) },
    ...ok({ totalitems: APLICARE_KELAS.length }),
  }));

  app.get<{ Params: { kodeppk: string; start: string; limit: string } }>(
    APLICARE_ENDPOINTS.bedRead.path,
    async (req) => {
      const { kodeppk } = req.params;
      const start = Number(req.params.start);
      const limit = Number(req.params.limit);
      if (!isPpk(kodeppk)) return fail('BPJS_VALIDASI', 'kodeppk harus 8 karakter');
      if (!Number.isInteger(start) || start < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
        return fail('BPJS_VALIDASI', 'start ≥ 1 dan limit 1–100');
      }
      const all = aplicareList(bpjs, kodeppk);
      return {
        response: { list: all.slice(start - 1, start - 1 + limit) },
        ...ok({ totalitems: all.length }),
      };
    },
  );

  const tulis = (mode: 'create' | 'update') =>
    async function handler(req: { params: { kodeppk: string }; body: unknown }) {
      const { kodeppk } = req.params;
      if (!isPpk(kodeppk)) return fail('BPJS_VALIDASI', 'kodeppk harus 8 karakter');
      const parsed = aplicareBedRequestSchema.safeParse(req.body);
      if (!parsed.success) return fail('BPJS_VALIDASI', zodDetail(parsed.error));
      const b = parsed.data;
      if (!kelasAda(b.kodekelas)) return fail('BPJS_KELAS_TIDAK_DITEMUKAN', b.kodekelas);
      const ruang = bpjs.aplicare.get(kodeppk) ?? new Map<string, AplicareRuangRecord>();
      const key = ruangKey(b.kodekelas, b.koderuang);
      if (mode === 'create' && ruang.has(key))
        return fail('BPJS_RUANG_GANDA', `${b.kodekelas}/${b.koderuang}`);
      if (mode === 'update' && !ruang.has(key)) {
        return fail('BPJS_RUANG_TIDAK_DITEMUKAN', `${b.kodekelas}/${b.koderuang}`);
      }
      ruang.set(key, { ...b, lastupdate: waktuWib(ctx.config.now()) });
      bpjs.aplicare.set(kodeppk, ruang);
      return ok();
    };

  app.post<{ Params: { kodeppk: string } }>(APLICARE_ENDPOINTS.bedCreate.path, tulis('create'));
  app.post<{ Params: { kodeppk: string } }>(APLICARE_ENDPOINTS.bedUpdate.path, tulis('update'));

  app.post<{ Params: { kodeppk: string } }>(APLICARE_ENDPOINTS.bedDelete.path, async (req) => {
    const { kodeppk } = req.params;
    if (!isPpk(kodeppk)) return fail('BPJS_VALIDASI', 'kodeppk harus 8 karakter');
    const parsed = aplicareBedDeleteRequestSchema.safeParse(req.body);
    if (!parsed.success) return fail('BPJS_VALIDASI', zodDetail(parsed.error));
    const { kodekelas, koderuang } = parsed.data;
    const ruang = bpjs.aplicare.get(kodeppk);
    if (!ruang?.delete(ruangKey(kodekelas, koderuang))) {
      return fail('BPJS_RUANG_TIDAK_DITEMUKAN', `${kodekelas}/${koderuang}`);
    }
    return ok();
  });
}
