import { dbDateFromIso, isoFromDbDate, type OutboxMessage, type TenantTx } from '@simrs/db';
import {
  BPJS_RENCANA_KONTROL_DELETE_OPERATION,
  BPJS_RENCANA_KONTROL_INSERT_OPERATION,
  BPJS_RUJUKAN_DELETE_OPERATION,
  BPJS_RUJUKAN_INSERT_OPERATION,
  BPJS_SPRI_INSERT_OPERATION,
  type FrontOfficeOperation,
  parseFrontOfficePayload,
  VCLAIM_ENDPOINTS,
  VCLAIM_JENIS_PELAYANAN,
  VCLAIM_TIPE_RUJUKAN,
  type VclaimRencanaKontrolDeleteRequest,
  type VclaimRencanaKontrolRequest,
  type VclaimRencanaKontrolResponse,
  vclaimRencanaKontrolResponseSchema,
  type VclaimRujukanKeluarDeleteRequest,
  type VclaimRujukanKeluarInsertRequest,
  type VclaimRujukanKeluarResponse,
  vclaimRujukanKeluarResponseSchema,
  type VclaimSpriRequest,
  type VclaimSpriResponse,
  vclaimSpriResponseSchema,
  vclaimNoRujukanResponseSchema,
  vclaimNoSuratResponseSchema,
} from '@simrs/shared';
import type { z } from 'zod';
import { type BpjsRejection, defineBpjsOperation } from './bpjs-operation';
import { BPJS_DLQ_CODE } from './booking';
import { type OperationContext, type OutboxOperation, PermanentOperationError } from './operation-types';

/**
 * F06/F07 · Operasi outbox surat kontrol, SPRI, dan rujukan keluar (VClaim), payload `{ referralId }` (ADR-0017):
 * no. kartu, no. SEP, kode DPJP, dan kode poli dibaca saat dikirim. Hasil dicatat di baris `referrals`:
 * - terbit → nomor BPJS + `active` + status kirim `sent` (rujukan keluar: masa berlaku dari BPJS);
 * - ditolak BPJS → status kirim `rejected` + kode (baris tetap `pending` tanpa nomor; petugas kirim ulang/batal);
 * - DLQ → `dead` + `BPJS_DLQ`;
 * - hapus (batal) → status kirim `sent`; "tidak ditemukan" di BPJS juga dianggap tercapai.
 * Kunci pesan `<operasi>:<rujukan>:<urut>` (`referrals.sync_seq`); pesan yang urutnya bukan urut terbaru dilewati.
 */

const SEQ = /:(\d+)$/;
const seqOf = (msg: { idempotencyKey: string }) => Number(SEQ.exec(msg.idempotencyKey)?.[1] ?? '1');
const VCLAIM_USER = 'SIMRS';
const TIPE: Record<string, '0' | '1' | '2'> = {
  penuh: VCLAIM_TIPE_RUJUKAN.penuh,
  partial: VCLAIM_TIPE_RUJUKAN.partial,
  rujuk_balik: VCLAIM_TIPE_RUJUKAN.rujukBalik,
};

function referralIdOf(msg: { operation: string; payload: unknown }): string {
  try {
    return parseFrontOfficePayload(msg.operation as typeof BPJS_SPRI_INSERT_OPERATION, msg.payload)
      .referralId;
  } catch {
    throw new PermanentOperationError('Payload rujukan tidak dikenali');
  }
}

const SEND_SELECT = {
  id: true,
  kind: true,
  status: true,
  number: true,
  syncStatus: true,
  syncSeq: true,
  issuedOn: true,
  plannedDate: true,
  ppkCode: true,
  serviceType: true,
  referralType: true,
  bpjsPoliCode: true,
  note: true,
  diagnosisCode: true,
  practitionerId: true,
  targetServiceId: true,
  encounter: {
    select: {
      coverages: {
        where: { status: 'active' },
        orderBy: { priority: 'asc' },
        take: 1,
        select: { patientIdentifier: { select: { system: true, valueEnc: true } } },
      },
      seps: {
        where: { status: 'issued' },
        orderBy: { version: 'desc' },
        take: 1,
        select: { sepNo: true },
      },
    },
  },
} as const;
type ReferralForSend = NonNullable<Awaited<ReturnType<typeof loadReferral>>>;
function loadReferral(tx: TenantTx, id: string) {
  return tx.referral.findUnique({ where: { id }, select: SEND_SELECT });
}

/** Pesan ini masih yang terbaru untuk baris rujukannya. */
const current = (r: { syncSeq: number; syncStatus: string }, msg: { idempotencyKey: string }) =>
  r.syncStatus === 'pending' && seqOf(msg) === r.syncSeq;

async function externalValue(
  ctx: OperationContext,
  entity: 'practitioner' | 'queue_service',
  entityId: string | null,
  system: string,
  missing: string,
): Promise<string> {
  if (!entityId) throw new PermanentOperationError(missing);
  const ext = await ctx.read((tx) =>
    tx.externalId.findFirst({ where: { entity, entityId, system, active: true }, select: { value: true } }),
  );
  if (!ext) throw new PermanentOperationError(missing);
  return ext.value;
}

const dpjpCode = (r: ReferralForSend, ctx: OperationContext) =>
  externalValue(
    ctx,
    'practitioner',
    r.practitionerId,
    'bpjs:hfis-dokter',
    'Kode DPJP BPJS dokter belum dipetakan',
  );
const poliCode = (r: ReferralForSend, ctx: OperationContext) =>
  externalValue(
    ctx,
    'queue_service',
    r.targetServiceId,
    'bpjs:poli',
    'Kode poli BPJS tujuan belum dipetakan',
  );

function sepNoOf(r: ReferralForSend): string {
  const no = r.encounter?.seps[0]?.sepNo;
  if (!no) throw new PermanentOperationError('SEP kunjungan asal belum terbit');
  return no;
}

function plannedOf(r: ReferralForSend): string {
  if (!r.plannedDate) throw new PermanentOperationError('Tanggal rencana kosong');
  return isoFromDbDate(r.plannedDate);
}

/** Pengecekan bersama penerbitan: jenis, status, belum bernomor, pesan terbaru. */
function insertSkip(r: ReferralForSend | null, kind: string, msg: { idempotencyKey: string }) {
  if (!r) return 'rujukan tidak ditemukan';
  if (r.kind !== kind) return `bukan ${kind}`;
  if (r.status !== 'pending' || r.number) return `rujukan berstatus ${r.status}`;
  if (!current(r, msg)) return 'pesan rujukan sudah digantikan kiriman yang lebih baru';
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Pencatatan hasil
// ---------------------------------------------------------------------------------------------------------------

async function settle(
  tx: TenantTx,
  msg: OutboxMessage,
  expect: 'pending' | 'cancelled',
  data: Record<string, unknown>,
): Promise<void> {
  const r = await tx.referral.findUnique({
    where: { id: referralIdOf(msg) },
    select: { id: true, status: true, number: true, syncStatus: true, syncSeq: true },
  });
  if (!r || r.status !== expect || !current(r, msg)) return;
  if (expect === 'pending' && r.number) return;
  await tx.referral.update({ where: { id: r.id }, data });
}

const issued = (number: string, extra: Record<string, unknown> = {}) => ({
  number,
  status: 'active',
  syncStatus: 'sent',
  syncedAt: new Date(),
  syncErrorCode: null,
  ...extra,
});
const rejected = (r: BpjsRejection) => ({ syncStatus: 'rejected', syncErrorCode: r.code });
const dead = { syncStatus: 'dead', syncErrorCode: BPJS_DLQ_CODE };

function insertOperation<R>(def: {
  kind: string;
  response: z.ZodType<R>;
  build(r: ReferralForSend, ctx: OperationContext): Promise<{ method: 'POST'; path: string; body: unknown }>;
  number(res: R): { number: string; extra?: Record<string, unknown> };
}): OutboxOperation {
  return defineBpjsOperation<R>({
    response: def.response,
    async prepare(msg, ctx) {
      const r = await ctx.read((tx) => loadReferral(tx, referralIdOf(msg)));
      const skip = insertSkip(r, def.kind, msg);
      if (skip || !r) return { skip: skip ?? 'rujukan tidak ditemukan' };
      return { service: 'vclaim', ...(await def.build(r, ctx)) };
    },
    async onAccepted(tx, msg, res) {
      const { number, extra } = def.number(res);
      await settle(tx, msg, 'pending', issued(number, extra));
    },
    async onRejected(tx, msg, rejection) {
      await settle(tx, msg, 'pending', rejected(rejection));
    },
    async onDead(tx, msg) {
      await settle(tx, msg, 'pending', dead);
    },
  });
}

function deleteOperation(def: {
  kinds: string[];
  notFound: string;
  build(r: ReferralForSend): { method: 'DELETE'; path: string; body: unknown };
}): OutboxOperation {
  const sent = () => ({ syncStatus: 'sent', syncedAt: new Date(), syncErrorCode: null });
  return defineBpjsOperation<string>({
    response: def.kinds.includes('rujukan-keluar')
      ? vclaimNoRujukanResponseSchema
      : vclaimNoSuratResponseSchema,
    async prepare(msg, ctx) {
      const r = await ctx.read((tx) => loadReferral(tx, referralIdOf(msg)));
      if (!r || !def.kinds.includes(r.kind)) return { skip: 'rujukan tidak ditemukan' };
      if (r.status !== 'cancelled') return { skip: 'rujukan tidak berstatus batal' };
      if (!current(r, msg)) return { skip: 'hapus rujukan sudah diproses' };
      if (!r.number) return { skip: 'rujukan tanpa nomor tidak terdaftar di BPJS' };
      return { service: 'vclaim', ...def.build(r) };
    },
    async onAccepted(tx, msg) {
      await settle(tx, msg, 'cancelled', sent());
    },
    async onRejected(tx, msg, rejection) {
      // Sudah tidak ada di BPJS = tujuan hapus tercapai.
      await settle(tx, msg, 'cancelled', rejection.code === def.notFound ? sent() : rejected(rejection));
    },
    async onDead(tx, msg) {
      await settle(tx, msg, 'cancelled', dead);
    },
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Operasi
// ---------------------------------------------------------------------------------------------------------------

export const bpjsRencanaKontrolInsert = insertOperation<VclaimRencanaKontrolResponse>({
  kind: 'surat-kontrol',
  response: vclaimRencanaKontrolResponseSchema,
  async build(r, ctx) {
    const body: VclaimRencanaKontrolRequest = {
      request: {
        noSEP: sepNoOf(r),
        kodeDokter: await dpjpCode(r, ctx),
        poliKontrol: await poliCode(r, ctx),
        tglRencanaKontrol: plannedOf(r),
        user: VCLAIM_USER,
      },
    };
    return { ...VCLAIM_ENDPOINTS.rencanaKontrolInsert, body };
  },
  number: (res) => ({ number: res.noSuratKontrol }),
});

export const bpjsSpriInsert = insertOperation<VclaimSpriResponse>({
  kind: 'spri',
  response: vclaimSpriResponseSchema,
  async build(r, ctx) {
    const ident = r.encounter?.coverages[0]?.patientIdentifier;
    if (!ident || ident.system !== 'bpjs')
      throw new PermanentOperationError('Penjaminan tanpa no. kartu BPJS');
    const body: VclaimSpriRequest = {
      request: {
        noKartu: ctx.crypto.decryptIdentifier(ident.valueEnc),
        kodeDokter: await dpjpCode(r, ctx),
        poliKontrol: await poliCode(r, ctx),
        tglRencanaKontrol: plannedOf(r),
        user: VCLAIM_USER,
      },
    };
    return { ...VCLAIM_ENDPOINTS.spriInsert, body };
  },
  number: (res) => ({ number: res.noSPRI }),
});

export const bpjsRujukanKeluarInsert = insertOperation<VclaimRujukanKeluarResponse>({
  kind: 'rujukan-keluar',
  response: vclaimRujukanKeluarResponseSchema,
  async build(r) {
    if (!r.ppkCode || !r.diagnosisCode) throw new PermanentOperationError('Isi rujukan keluar tidak lengkap');
    const body: VclaimRujukanKeluarInsertRequest = {
      request: {
        t_rujukan: {
          noSep: sepNoOf(r),
          tglRujukan: isoFromDbDate(r.issuedOn),
          tglRencanaKunjungan: plannedOf(r),
          ppkDirujuk: r.ppkCode,
          jnsPelayanan:
            r.serviceType === 'rawat_inap'
              ? VCLAIM_JENIS_PELAYANAN.rawatInap
              : VCLAIM_JENIS_PELAYANAN.rawatJalan,
          catatan: r.note ?? '',
          diagRujukan: r.diagnosisCode,
          tipeRujukan: TIPE[r.referralType ?? 'penuh'] ?? VCLAIM_TIPE_RUJUKAN.penuh,
          poliRujukan: r.bpjsPoliCode ?? '',
          user: VCLAIM_USER,
        },
      },
    };
    return { ...VCLAIM_ENDPOINTS.rujukanKeluarInsert, body };
  },
  number: (res) => ({
    number: res.rujukan.noRujukan,
    extra: { validUntil: dbDateFromIso(res.rujukan.tglBerlakuKunjungan) },
  }),
});

export const bpjsRencanaKontrolDelete = deleteOperation({
  kinds: ['surat-kontrol', 'spri'],
  notFound: 'BPJS_SURAT_TIDAK_DITEMUKAN',
  build(r) {
    const body: VclaimRencanaKontrolDeleteRequest = {
      request: { t_suratkontrol: { noSuratKontrol: r.number as string, user: VCLAIM_USER } },
    };
    return { ...VCLAIM_ENDPOINTS.rencanaKontrolDelete, body };
  },
});

export const bpjsRujukanKeluarDelete = deleteOperation({
  kinds: ['rujukan-keluar'],
  notFound: 'BPJS_RUJUKAN_TIDAK_DITEMUKAN',
  build(r) {
    const body: VclaimRujukanKeluarDeleteRequest = {
      request: { t_rujukan: { noRujukan: r.number as string, user: VCLAIM_USER } },
    };
    return { ...VCLAIM_ENDPOINTS.rujukanKeluarDelete, body };
  },
});

/** Operasi rujukan/surat untuk peta `OUTBOX_OPERATIONS`. */
export const REFERRAL_OPERATIONS: ReadonlyArray<[FrontOfficeOperation, OutboxOperation]> = [
  [BPJS_RENCANA_KONTROL_INSERT_OPERATION, bpjsRencanaKontrolInsert],
  [BPJS_SPRI_INSERT_OPERATION, bpjsSpriInsert],
  [BPJS_RUJUKAN_INSERT_OPERATION, bpjsRujukanKeluarInsert],
  [BPJS_RENCANA_KONTROL_DELETE_OPERATION, bpjsRencanaKontrolDelete],
  [BPJS_RUJUKAN_DELETE_OPERATION, bpjsRujukanKeluarDelete],
];
