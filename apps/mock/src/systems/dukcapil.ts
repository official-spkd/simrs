import { dukcapilVerifyRequestSchema, type DukcapilVerifyResponse, nikBirthInfo } from '@simrs/shared';
import type { FastifyInstance } from 'fastify';
import { fakePerson, isNik } from '../fixtures';

/**
 * Mock Dukcapil (P05 → I05). Aturan fiktif yang bisa diandalkan tes dan demo:
 * - NIK berakhiran 9999 → tidak ditemukan;
 * - NIK berakhiran 8888 → nama tidak sesuai (`verify-data`);
 * - tanggal lahir dan jenis kelamin dicocokkan dengan struktur NIK (DDMMYY, tanggal perempuan + 40).
 */
export function registerDukcapil(app: FastifyInstance): void {
  /** Data demografi fiktif per NIK (docs/06 §5); dipakai pendaftaran (F03) untuk isian otomatis. */
  app.post<{ Body: { nik?: string } }>('/dukcapil/verify', async (req, reply) => {
    const nik = req.body?.nik ?? '';
    if (!isNik(nik))
      return reply.code(400).send({ code: 'VALIDATION_FAILED', message: 'NIK harus 16 digit' });
    if (nik.endsWith('9999')) return { found: false };
    return { found: true, person: fakePerson(nik) };
  });

  /**
   * Verifikasi data (pola layanan verifikasi untuk instansi): cocokkan data yang dikirim RS, jawab per elemen
   * tanpa mengembalikan data pribadi. Dipakai worker untuk status verifikasi NIK di MPI.
   */
  app.post('/dukcapil/verify-data', async (req, reply) => {
    const parsed = dukcapilVerifyRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ code: 'VALIDATION_FAILED', message: 'Permintaan verifikasi tidak valid' });
    }
    const { nik, nama, tanggalLahir, jenisKelamin } = parsed.data;
    if (nik.endsWith('9999')) return { found: false };
    const fromNik = nikBirthInfo(nik);
    const birthMatches = (iso: string) => {
      if (!fromNik) return false;
      const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
      return d === fromNik.day && m === fromNik.month && y % 100 === fromNik.yearSuffix;
    };
    const result: DukcapilVerifyResponse = {
      found: true,
      match: {
        nama: nama === undefined ? null : !nik.endsWith('8888'),
        tanggalLahir: tanggalLahir === undefined ? null : birthMatches(tanggalLahir),
        jenisKelamin: jenisKelamin === undefined || !fromNik ? null : jenisKelamin === fromNik.sex,
      },
    };
    return result;
  });
}
