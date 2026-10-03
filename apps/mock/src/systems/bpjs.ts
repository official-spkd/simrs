import { bpjsEncryptResponse, verifyBpjsSignature } from '@simrs/shared/node';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { MockConfig } from '../config';
import { fakeBpjsCard, fakePerson, isNik } from '../fixtures';
import type { MockState } from '../state';

/**
 * Mock BPJS: VClaim (`metaData`) dan Antrean (`metadata`) dengan tanda tangan header dan respons terenkripsi.
 * Kontrak dirangkum di docs/06-integrasi.md §2; cocokkan dengan katalog resmi BPJS sebelum integrasi nyata.
 */
export function registerBpjs(app: FastifyInstance, config: MockConfig, state: MockState): void {
  function authenticate(req: FastifyRequest, reply: FastifyReply): string | undefined {
    const consId = req.headers['x-cons-id'];
    const ts = req.headers['x-timestamp'];
    const sig = req.headers['x-signature'];
    if (typeof consId !== 'string' || typeof ts !== 'string' || typeof sig !== 'string') {
      void reply
        .code(401)
        .send({ metaData: { code: '401', message: 'Header X-cons-id, X-timestamp, X-signature wajib' } });
      return undefined;
    }
    if (consId !== config.bpjs.consId || !verifyBpjsSignature(config.bpjs, ts, sig)) {
      void reply.code(401).send({ metaData: { code: '401', message: 'Signature tidak valid' } });
      return undefined;
    }
    return ts;
  }

  function wrap(data: unknown, ts: string): unknown {
    return state.bpjsEncryption ? bpjsEncryptResponse(data, config.bpjs, ts) : data;
  }

  app.get<{ Params: { nik: string; tgl: string } }>(
    '/bpjs/vclaim/Peserta/nik/:nik/tglSEP/:tgl',
    async (req, reply) => {
      const ts = authenticate(req, reply);
      if (!ts) return reply;
      const { nik } = req.params;
      if (!isNik(nik)) return { metaData: { code: '201', message: 'NIK tidak valid' }, response: null };
      const p = fakePerson(nik);
      const active = !nik.endsWith('0000');
      return {
        metaData: { code: '200', message: 'OK' },
        response: wrap(
          {
            peserta: {
              noKartu: fakeBpjsCard(nik),
              nik,
              nama: p.nama,
              sex: p.jenisKelamin,
              tglLahir: p.tanggalLahir,
              hakKelas: { kode: '2', keterangan: 'KELAS II' },
              statusPeserta: active
                ? { kode: '0', keterangan: 'AKTIF' }
                : { kode: '1', keterangan: 'TIDAK AKTIF' },
              jenisPeserta: { kode: '14', keterangan: 'PBI (FIKTIF)' },
            },
          },
          ts,
        ),
      };
    },
  );

  app.post('/bpjs/antrean/antrean/add', async (req, reply) => {
    if (!authenticate(req, reply)) return reply;
    return { metadata: { code: 200, message: 'Ok' } };
  });

  app.post<{ Body: { kodebooking?: string; taskid?: number; waktu?: number } }>(
    '/bpjs/antrean/antrean/updatewaktu',
    async (req, reply) => {
      if (!authenticate(req, reply)) return reply;
      const { kodebooking, taskid, waktu } = req.body ?? {};
      if (!kodebooking || !taskid || !waktu) {
        return { metadata: { code: 201, message: 'kodebooking, taskid, waktu wajib diisi' } };
      }
      if (![1, 2, 3, 4, 5, 6, 7, 99].includes(taskid)) {
        return { metadata: { code: 201, message: 'TaskId tidak valid' } };
      }
      return { metadata: { code: 200, message: 'Ok' } };
    },
  );

  app.post<{ Body: Record<string, unknown> }>('/bpjs/aplicare/rest/bed/update/:ppk', async (req, reply) => {
    if (!authenticate(req, reply)) return reply;
    return { metadata: { code: 1, message: 'Sukses (mock)' } };
  });
}
