import { enqueueOutbox, isoFromDbDate, type OutboxMessage, type TenantTx } from '@simrs/db';
import {
  BPJS_SEP_DELETE_OPERATION,
  BPJS_SEP_INSERT_OPERATION,
  BPJS_SEP_UPDATE_OPERATION,
  bpjsPath,
  type FrontOfficeOperation,
  isoDateJakarta,
  newId,
  outboxKey,
  parseDomainEvent,
  parseFrontOfficePayload,
  VCLAIM_ASAL_RUJUKAN,
  VCLAIM_ENDPOINTS,
  VCLAIM_JENIS_PELAYANAN,
  VCLAIM_PESERTA_AKTIF,
  type VclaimHistori,
  vclaimHistoriResponseSchema,
  vclaimNoSepResponseSchema,
  type VclaimPeserta,
  vclaimPesertaResponseSchema,
  type VclaimSep,
  type VclaimSepDeleteRequest,
  type VclaimSepInsertRequest,
  vclaimSepInsertResponseSchema,
  type VclaimSepUpdateRequest,
} from '@simrs/shared';
import type { BpjsRequest } from '@simrs/shared/node';
import { z } from 'zod';
import { type BpjsRejection, defineBpjsOperation } from './bpjs-operation';
import { BPJS_DLQ_CODE, bpjsContactPhone } from './booking';
import { type OperationContext, type OutboxOperation, PermanentOperationError } from './operation-types';

/**
 * F06 · Operasi outbox SEP (VClaim 2.0), payload `{ sepId }` (ADR-0017): data peserta (no. kartu, no. HP) dibaca dan
 * didekripsi saat dikirim, tidak pernah disimpan di pesan. Hasil dicatat di baris `seps` (status + status kirim).
 *
 * Penerbitan (`bpjs.vclaim.sep.insert`) bertahap, satu panggilan BPJS per pesan; tahap ditentukan keadaan baris:
 * 1. `peserta` — kelas hak peserta belum diketahui: cek kepesertaan (kelas hak → penjaminan; tidak aktif → gagal);
 * 2. `insert` — terbitkan SEP;
 * 3. `histori` — BPJS menjawab SEP ganda (mis. kiriman sebelumnya timeout padahal sudah diproses): cari nomornya di
 *    histori pelayanan, JANGAN terbitkan ulang. Ditemukan → terbit dengan nomor itu; tidak → gagal (cek manual).
 * Tahap berikutnya = pesan baru berkunci `<operasi>:<sep>:<urut>` (`seps.sync_seq`). Pesan yang urutnya bukan urut
 * terbaru dilewati, sehingga kiriman lama/ganda tidak pernah menerbitkan SEP kedua.
 */

const SEQ = /:(\d+)$/;
const sepIdOf = (msg: { payload: unknown }) => {
  try {
    return parseFrontOfficePayload(BPJS_SEP_INSERT_OPERATION, msg.payload).sepId;
  } catch {
    throw new PermanentOperationError('Payload SEP tidak dikenali');
  }
};
const seqOf = (msg: { idempotencyKey: string }) => Number(SEQ.exec(msg.idempotencyKey)?.[1] ?? '1');

const KELAS = { '1': 'kelas_1', '2': 'kelas_2', '3': 'kelas_3' } as const;
const KELAS_KODE: Record<string, '1' | '2' | '3'> = { kelas_1: '1', kelas_2: '2', kelas_3: '3' };
const DLQ_REASON = 'Gagal terkirim ke BPJS sampai batas waktu; kirim ulang';
const VCLAIM_USER = 'SIMRS';

const SEP_PREPARE_SELECT = {
  id: true,
  status: true,
  version: true,
  sepNo: true,
  poliCode: true,
  diagnosisCode: true,
  note: true,
  lastErrorCode: true,
  syncStatus: true,
  syncSeq: true,
  encounterId: true,
  tenant: { select: { bpjsPpkCode: true } },
  coverage: {
    select: {
      id: true,
      classEntitlement: true,
      patientIdentifier: { select: { system: true, valueEnc: true } },
    },
  },
  referral: { select: { kind: true, number: true, ppkCode: true, issuedOn: true } },
  encounter: {
    select: {
      patientId: true,
      practitionerId: true,
      arrivedAt: true,
      createdAt: true,
      patient: { select: { mrn: true, phoneEnc: true } },
    },
  },
} as const;

type SepForSend = NonNullable<Awaited<ReturnType<typeof loadSep>>>;
function loadSep(tx: TenantTx, id: string) {
  return tx.sep.findUnique({ where: { id }, select: SEP_PREPARE_SELECT });
}

type InsertStage = 'peserta' | 'insert' | 'histori';
/** Tahap terbitkan SEP menurut keadaan baris (sama di `prepare` dan saat hasil dicatat). */
function insertStage(s: Pick<SepForSend, 'lastErrorCode' | 'coverage'>): InsertStage {
  if (!s.coverage.classEntitlement) return 'peserta';
  return s.lastErrorCode === 'BPJS_SEP_GANDA' ? 'histori' : 'insert';
}

/** Pesan ini masih yang terbaru untuk baris SEP-nya (bukan kiriman lama yang tergantikan kirim ulang). */
const current = (s: { syncSeq: number }, msg: { idempotencyKey: string }) => seqOf(msg) === s.syncSeq;

const tglSepOf = (s: SepForSend) => isoDateJakarta(s.encounter.arrivedAt ?? s.encounter.createdAt);

/** Data kirim yang sama untuk insert/update: no. kartu, no. HP, kode DPJP, kode PPK. */
async function sendData(s: SepForSend, ctx: OperationContext) {
  const ident = s.coverage.patientIdentifier;
  if (!ident || ident.system !== 'bpjs') throw new PermanentOperationError('Penjaminan tanpa no. kartu BPJS');
  const ppk = s.tenant.bpjsPpkCode;
  if (!ppk) throw new PermanentOperationError('Kode PPK BPJS rumah sakit belum diisi');
  if (!s.poliCode) throw new PermanentOperationError('Kode poli BPJS layanan belum dipetakan');
  if (!s.diagnosisCode) throw new PermanentOperationError('Diagnosa awal SEP kosong');
  const dpjp = s.encounter.practitionerId
    ? await ctx.read((tx) =>
        tx.externalId.findFirst({
          where: {
            entity: 'practitioner',
            entityId: s.encounter.practitionerId as string,
            system: 'bpjs:hfis-dokter',
            active: true,
          },
          select: { value: true },
        }),
      )
    : null;
  if (!dpjp) throw new PermanentOperationError('Kode DPJP BPJS dokter belum dipetakan');
  // No. HP pasien, atau no. telepon RS (`bpjs.contact_phone`) bila kosong/tidak sah.
  const phone = await bpjsContactPhone(ctx, s.encounter.patient.phoneEnc);
  return {
    kartu: ctx.crypto.decryptIdentifier(ident.valueEnc),
    ppk,
    poli: s.poliCode,
    diagnosis: s.diagnosisCode,
    dpjp: dpjp.value,
    // VClaim wajib no. telepon 8–15 digit; bentuk lokal `08…`. Tanpa no. HP pasien dan tanpa no. telepon RS:
    // `0000000000` (perilaku lama; cocokkan aturan VClaim resmi sebelum integrasi nyata).
    noTelp: phone ? `0${phone.slice(2)}` : '0000000000',
  };
}

/** Rujukan dasar SEP rawat jalan; kontrol memakai surat kontrol (`skdp`) + rujukan asal kunjungan sebelumnya. */
async function rujukanOf(s: SepForSend, ctx: OperationContext) {
  const r = s.referral;
  const empty = { asalRujukan: '' as const, tglRujukan: '' as const, noRujukan: '', ppkRujukan: '' };
  if (!r?.number) return { rujukan: empty, noSurat: '' };
  const fromReferral = (ref: {
    kind: string;
    number: string | null;
    ppkCode: string | null;
    issuedOn: Date;
  }) => ({
    asalRujukan: ref.kind === 'rujukan-fktp' ? VCLAIM_ASAL_RUJUKAN.fktp : VCLAIM_ASAL_RUJUKAN.rs,
    tglRujukan: isoFromDbDate(ref.issuedOn),
    noRujukan: ref.number ?? '',
    ppkRujukan: ref.ppkCode ?? '',
  });
  if (r.kind !== 'surat-kontrol') return { rujukan: fromReferral(r), noSurat: '' };
  // Kontrol: rujukan asal = rujukan SEP terbit terakhir pasien ini yang berdasar rujukan (bukan surat kontrol).
  const previous = await ctx.read((tx) =>
    tx.sep.findFirst({
      where: {
        status: 'issued',
        encounter: { patientId: s.encounter.patientId },
        referral: { kind: { in: ['rujukan-fktp', 'rujukan-rs'] } },
      },
      orderBy: { issuedAt: 'desc' },
      select: { referral: { select: { kind: true, number: true, ppkCode: true, issuedOn: true } } },
    }),
  );
  return { rujukan: previous?.referral ? fromReferral(previous.referral) : empty, noSurat: r.number };
}

// ---------------------------------------------------------------------------------------------------------------
// Pencatatan hasil
// ---------------------------------------------------------------------------------------------------------------

async function markFailed(tx: TenantTx, id: string, code: string, reason: string, dead = false) {
  await tx.sep.update({
    where: { id },
    data: {
      status: 'failed',
      lastErrorCode: code,
      rejectionReason: reason.slice(0, 300) || code,
      syncStatus: dead ? 'dead' : 'rejected',
      syncErrorCode: code,
    },
  });
}

/** Terbit: nomor + waktu, status kirim `sent`; trigger mengunci penjaminan. Versi 1 → event `sep.issued`. */
async function markIssued(
  tx: TenantTx,
  s: Pick<SepForSend, 'id' | 'version' | 'encounterId'>,
  sepNo: string,
) {
  const now = new Date();
  await tx.sep.update({
    where: { id: s.id },
    data: {
      status: 'issued',
      sepNo,
      issuedAt: now,
      lastErrorCode: null,
      rejectionReason: null,
      syncStatus: 'sent',
      syncedAt: now,
      syncErrorCode: null,
    },
  });
  if (s.version === 1) await recordSepIssued(tx, s.id, s.encounterId, now);
}

/**
 * Event domain `sep.issued` dari worker: disimpan di `domain_events` (jejak; belum ada pendengar di API, penangan
 * sinkron hanya berjalan di proses API).
 */
async function recordSepIssued(tx: TenantTx, sepId: string, encounterId: string, at: Date) {
  const tenant = await tx.sep.findUniqueOrThrow({ where: { id: sepId }, select: { tenantId: true } });
  await tx.domainEvent.create({
    data: {
      id: newId(),
      tenantId: tenant.tenantId,
      name: 'sep.issued',
      payload: parseDomainEvent('sep.issued', { sepId, encounterId }),
      occurredAt: at,
    },
  });
}

/** Tahap berikutnya penerbitan: urut naik + pesan baru (insert/histori). */
async function nextInsertStep(
  tx: TenantTx,
  s: { id: string; syncSeq: number },
  data: Record<string, unknown>,
) {
  const seq = s.syncSeq + 1;
  const row = await tx.sep.update({
    where: { id: s.id },
    data: { ...data, syncSeq: seq },
    select: { tenantId: true },
  });
  await enqueueOutbox(tx, row.tenantId, {
    target: 'bpjs',
    operation: BPJS_SEP_INSERT_OPERATION,
    idempotencyKey: outboxKey(BPJS_SEP_INSERT_OPERATION, s.id, seq),
    payload: { sepId: s.id },
  });
}

/**
 * SEP rawat jalan RS ini pada tanggal itu di histori (histori diminta per no. kartu, jadi semua milik peserta ini);
 * bila lebih dari satu, yang nomor rujukannya sama.
 */
function matchHistori(list: VclaimHistori[], s: SepForSend, ppk: string, tgl: string) {
  const candidates = list.filter(
    (h) => h.tglSep === tgl && h.jnsPelayanan === VCLAIM_JENIS_PELAYANAN.rawatJalan && h.ppkPelayanan === ppk,
  );
  if (candidates.length === 1) return candidates[0];
  const byRujukan = candidates.filter((h) => s.referral?.number && h.noRujukan === s.referral.number);
  return byRujukan.length === 1 ? byRujukan[0] : undefined;
}

// ---------------------------------------------------------------------------------------------------------------
// bpjs.vclaim.sep.insert
// ---------------------------------------------------------------------------------------------------------------

const insertResponseSchema = z.union([
  vclaimSepInsertResponseSchema,
  vclaimPesertaResponseSchema,
  vclaimHistoriResponseSchema,
]);
type InsertResponse = z.infer<typeof insertResponseSchema>;

export const bpjsSepInsert: OutboxOperation = defineBpjsOperation<InsertResponse>({
  response: insertResponseSchema,
  async prepare(msg, ctx) {
    const s = await ctx.read((tx) => loadSep(tx, sepIdOf(msg)));
    if (!s) return { skip: 'SEP tidak ditemukan' };
    if (s.version !== 1) return { skip: 'bukan SEP versi 1' };
    if (s.status !== 'pending') return { skip: `SEP berstatus ${s.status}` };
    if (!current(s, msg)) return { skip: 'pesan SEP sudah digantikan kiriman yang lebih baru' };
    const d = await sendData(s, ctx);
    const tglSep = tglSepOf(s);
    const stage = insertStage(s);
    if (stage === 'peserta') {
      return get(bpjsPath(VCLAIM_ENDPOINTS.pesertaByKartu.path, { noKartu: d.kartu, tglSEP: tglSep }));
    }
    if (stage === 'histori') {
      return get(
        bpjsPath(VCLAIM_ENDPOINTS.historiPelayanan.path, {
          noKartu: d.kartu,
          tglMulai: tglSep,
          tglAkhir: tglSep,
        }),
      );
    }
    const klsRawatHak = KELAS_KODE[s.coverage.classEntitlement ?? ''];
    if (!klsRawatHak) throw new PermanentOperationError('Kelas hak peserta tidak dikenal');
    const { rujukan, noSurat } = await rujukanOf(s, ctx);
    const body: VclaimSepInsertRequest = {
      request: {
        t_sep: {
          noKartu: d.kartu,
          tglSep,
          ppkPelayanan: d.ppk,
          jnsPelayanan: VCLAIM_JENIS_PELAYANAN.rawatJalan,
          klsRawat: { klsRawatHak, klsRawatNaik: '', pembiayaan: '', penanggungJawab: '' },
          noMR: s.encounter.patient.mrn,
          rujukan,
          catatan: s.note ?? '',
          diagAwal: d.diagnosis,
          poli: { tujuan: d.poli, eksekutif: '0' },
          cob: { cob: '0' },
          katarak: { katarak: '0' },
          jaminan: {
            lakaLantas: '0',
            noLP: '',
            penjamin: {
              tglKejadian: '',
              keterangan: '',
              suplesi: {
                suplesi: '0',
                noSepSuplesi: '',
                lokasiLaka: { kdPropinsi: '', kdKabupaten: '', kdKecamatan: '' },
              },
            },
          },
          tujuanKunj: '0',
          flagProcedure: '',
          kdPenunjang: '',
          assesmentPel: '',
          skdp: { noSurat, kodeDPJP: noSurat ? d.dpjp : '' },
          dpjpLayan: d.dpjp,
          noTelp: d.noTelp,
          user: VCLAIM_USER,
        },
      },
    };
    return { service: 'vclaim', ...VCLAIM_ENDPOINTS.sepInsert, body };
  },
  async onAccepted(tx, msg, response) {
    const s = await loadSep(tx, sepIdOf(msg));
    if (!s || s.status !== 'pending' || !current(s, msg)) return;
    if ('peserta' in response) return onPeserta(tx, s, response.peserta);
    if ('histori' in response) return onHistori(tx, s, response.histori);
    return onIssued(tx, s, response.sep);
  },
  async onRejected(tx, msg, rejection) {
    const s = await loadSep(tx, sepIdOf(msg));
    if (!s || s.status !== 'pending' || !current(s, msg)) return;
    const stage = insertStage(s);
    if (stage === 'insert' && rejection.code === 'BPJS_SEP_GANDA') {
      // Mungkin kiriman sebelumnya sudah diterbitkan (timeout): cari di histori, jangan terbitkan ulang.
      await nextInsertStep(tx, s, { lastErrorCode: 'BPJS_SEP_GANDA' });
      return;
    }
    if (stage === 'histori') {
      await markFailed(tx, s.id, 'BPJS_SEP_GANDA', gandaReason(rejection));
      return;
    }
    await markFailed(tx, s.id, rejection.code, rejection.message);
  },
  async onDead(tx, msg) {
    const s = await loadSep(tx, sepIdOf(msg));
    if (!s || s.status !== 'pending' || !current(s, msg)) return;
    await markFailed(tx, s.id, BPJS_DLQ_CODE, DLQ_REASON, true);
  },
});

const get = (path: string): BpjsRequest => ({ service: 'vclaim', method: 'GET', path });
const gandaReason = (r?: BpjsRejection) =>
  `Peserta sudah memiliki SEP di BPJS yang tidak ditemukan di histori RS ini; periksa di VClaim${r ? ` (${r.code})` : ''}`;

async function onPeserta(tx: TenantTx, s: SepForSend, p: VclaimPeserta) {
  if (p.statusPeserta.kode !== VCLAIM_PESERTA_AKTIF) {
    await markFailed(
      tx,
      s.id,
      'BPJS_PESERTA_TIDAK_AKTIF',
      `Status peserta tidak aktif: ${p.statusPeserta.keterangan}`,
    );
    return;
  }
  const kelas = KELAS[p.hakKelas.kode as keyof typeof KELAS];
  if (!kelas) {
    await markFailed(tx, s.id, 'BPJS_KELAS_TIDAK_DITEMUKAN', 'Kelas hak peserta tidak dikenal');
    return;
  }
  await tx.coverage.update({
    where: { id: s.coverage.id },
    data: { classEntitlement: kelas, careClass: kelas },
  });
  await tx.sep.update({ where: { id: s.id }, data: { careClass: kelas } });
  await nextInsertStep(tx, s, {});
}

async function onHistori(tx: TenantTx, s: SepForSend, list: VclaimHistori[]) {
  const ppk = s.tenant.bpjsPpkCode;
  const match = ppk ? matchHistori(list, s, ppk, tglSepOf(s)) : undefined;
  if (!match) {
    await markFailed(tx, s.id, 'BPJS_SEP_GANDA', gandaReason());
    return;
  }
  // Nomor itu sudah dipakai kunjungan lain di RS ini = SEP ganda sungguhan, bukan kiriman kita yang timeout.
  const usedElsewhere = await tx.sep.findFirst({
    where: { sepNo: match.noSep, NOT: { encounterId: s.encounterId } },
    select: { id: true },
  });
  if (usedElsewhere) {
    await markFailed(
      tx,
      s.id,
      'BPJS_SEP_GANDA',
      'Peserta sudah memiliki SEP rawat jalan pada tanggal ini untuk kunjungan lain',
    );
    return;
  }
  await markIssued(tx, s, match.noSep);
}

async function onIssued(tx: TenantTx, s: SepForSend, sep: VclaimSep) {
  await markIssued(tx, s, sep.noSep);
}

// ---------------------------------------------------------------------------------------------------------------
// bpjs.vclaim.sep.update (versi baru SEP terbit)
// ---------------------------------------------------------------------------------------------------------------

export const bpjsSepUpdate: OutboxOperation = defineBpjsOperation<string>({
  response: vclaimNoSepResponseSchema,
  async prepare(msg, ctx) {
    const s = await ctx.read((tx) => loadSep(tx, sepIdOf(msg)));
    if (!s) return { skip: 'SEP tidak ditemukan' };
    if (s.version < 2) return { skip: 'revisi SEP dimulai dari versi 2' };
    if (s.status !== 'pending') return { skip: `SEP berstatus ${s.status}` };
    if (!current(s, msg)) return { skip: 'pesan SEP sudah digantikan kiriman yang lebih baru' };
    if (!s.sepNo) throw new PermanentOperationError('Revisi SEP tanpa nomor SEP');
    const klsRawatHak = KELAS_KODE[s.coverage.classEntitlement ?? ''];
    if (!klsRawatHak) throw new PermanentOperationError('Kelas hak peserta belum diketahui');
    const d = await sendData(s, ctx);
    const body: VclaimSepUpdateRequest = {
      request: {
        t_sep: {
          noSep: s.sepNo,
          klsRawat: { klsRawatHak, klsRawatNaik: '', pembiayaan: '', penanggungJawab: '' },
          noMR: s.encounter.patient.mrn,
          catatan: s.note ?? '',
          diagAwal: d.diagnosis,
          poli: { tujuan: d.poli, eksekutif: '0' },
          cob: { cob: '0' },
          katarak: { katarak: '0' },
          dpjpLayan: d.dpjp,
          noTelp: d.noTelp,
          user: VCLAIM_USER,
        },
      },
    };
    return { service: 'vclaim', ...VCLAIM_ENDPOINTS.sepUpdate, body };
  },
  async onAccepted(tx, msg) {
    const s = await loadSep(tx, sepIdOf(msg));
    if (!s || s.status !== 'pending' || !current(s, msg) || !s.sepNo) return;
    await markIssued(tx, s, s.sepNo);
  },
  async onRejected(tx, msg, rejection) {
    const s = await loadSep(tx, sepIdOf(msg));
    if (!s || s.status !== 'pending' || !current(s, msg)) return;
    await markFailed(tx, s.id, rejection.code, rejection.message);
  },
  async onDead(tx, msg) {
    const s = await loadSep(tx, sepIdOf(msg));
    if (!s || s.status !== 'pending' || !current(s, msg)) return;
    await markFailed(tx, s.id, BPJS_DLQ_CODE, DLQ_REASON, true);
  },
});

// ---------------------------------------------------------------------------------------------------------------
// bpjs.vclaim.sep.delete (SEP dibatalkan)
// ---------------------------------------------------------------------------------------------------------------

const setSync = (tx: TenantTx, id: string, data: Record<string, unknown>) =>
  tx.sep.update({ where: { id }, data, select: { id: true } });

export const bpjsSepDelete: OutboxOperation = defineBpjsOperation<string>({
  response: vclaimNoSepResponseSchema,
  async prepare(msg, ctx) {
    const s = await ctx.read((tx) => loadSep(tx, sepIdOf(msg)));
    if (!s) return { skip: 'SEP tidak ditemukan' };
    if (s.status !== 'cancelled') return { skip: 'SEP tidak berstatus batal' };
    if (s.syncStatus !== 'pending' || !current(s, msg)) return { skip: 'hapus SEP sudah diproses' };
    if (!s.sepNo) return { skip: 'SEP tanpa nomor tidak terdaftar di BPJS' };
    const body: VclaimSepDeleteRequest = { request: { t_sep: { noSep: s.sepNo, user: VCLAIM_USER } } };
    return { service: 'vclaim', ...VCLAIM_ENDPOINTS.sepDelete, body };
  },
  async onAccepted(tx, msg) {
    await settleDelete(tx, msg, { syncStatus: 'sent', syncedAt: new Date(), syncErrorCode: null });
  },
  async onRejected(tx, msg, rejection) {
    // Sudah tidak ada di BPJS = tujuan hapus tercapai.
    await settleDelete(
      tx,
      msg,
      rejection.code === 'BPJS_SEP_TIDAK_DITEMUKAN'
        ? { syncStatus: 'sent', syncedAt: new Date(), syncErrorCode: null }
        : { syncStatus: 'rejected', syncErrorCode: rejection.code },
    );
  },
  async onDead(tx, msg) {
    await settleDelete(tx, msg, { syncStatus: 'dead', syncErrorCode: BPJS_DLQ_CODE });
  },
});

async function settleDelete(tx: TenantTx, msg: OutboxMessage, data: Record<string, unknown>) {
  const s = await tx.sep.findUnique({
    where: { id: sepIdOf(msg) },
    select: { id: true, status: true, syncStatus: true, syncSeq: true },
  });
  if (!s || s.status !== 'cancelled' || s.syncStatus !== 'pending' || !current(s, msg)) return;
  await setSync(tx, s.id, data);
}

/** Operasi SEP untuk peta `OUTBOX_OPERATIONS`. */
export const SEP_OPERATIONS: ReadonlyArray<[FrontOfficeOperation, OutboxOperation]> = [
  [BPJS_SEP_INSERT_OPERATION, bpjsSepInsert],
  [BPJS_SEP_UPDATE_OPERATION, bpjsSepUpdate],
  [BPJS_SEP_DELETE_OPERATION, bpjsSepDelete],
];
