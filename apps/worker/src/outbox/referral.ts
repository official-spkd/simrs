import { dbDateFromIso, enqueueOutbox, isoFromDbDate, type OutboxMessage, type TenantTx } from '@simrs/db';
import {
  BPJS_RENCANA_KONTROL_DELETE_OPERATION,
  BPJS_RENCANA_KONTROL_INSERT_OPERATION,
  BPJS_RUJUKAN_DELETE_OPERATION,
  BPJS_RUJUKAN_INSERT_OPERATION,
  BPJS_SPRI_INSERT_OPERATION,
  bpjsPath,
  type FrontOfficeOperation,
  outboxKey,
  parseFrontOfficePayload,
  VCLAIM_ENDPOINTS,
  VCLAIM_FILTER_SURAT,
  VCLAIM_JENIS_PELAYANAN,
  VCLAIM_JENIS_SURAT,
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
  type VclaimSuratKontrolListItem,
  vclaimSuratKontrolListResponseSchema,
  vclaimNoRujukanResponseSchema,
  vclaimNoSuratResponseSchema,
} from '@simrs/shared';
import { z } from 'zod';
import { type BpjsRejection, defineBpjsOperation } from './bpjs-operation';
import { BPJS_DLQ_CODE } from './booking';
import {
  type OperationContext,
  type OutboxMessageLike,
  type OutboxOperation,
  PermanentOperationError,
} from './operation-types';

/**
 * F06/F07 · Operasi outbox surat kontrol, SPRI, dan rujukan keluar (VClaim), payload `{ referralId }` (ADR-0017):
 * no. kartu, no. SEP, kode DPJP, dan kode poli dibaca saat dikirim. Hasil dicatat di baris `referrals`:
 * - terbit → nomor BPJS + `active` + status kirim `sent` (rujukan keluar: masa berlaku dari BPJS);
 * - ditolak BPJS → status kirim `rejected` + kode (baris tetap `pending` tanpa nomor; petugas kirim ulang/batal);
 * - DLQ → `dead` + `BPJS_DLQ`;
 * - hapus (batal) → status kirim `sent`; "tidak ditemukan" di BPJS juga dianggap tercapai.
 * Kunci pesan `<operasi>:<rujukan>:<urut>` (`referrals.sync_seq`); pesan yang urutnya bukan urut terbaru dilewati.
 * Surat kontrol/SPRI yang mungkin sudah diproses BPJS dicari dulu di daftar surat kartu sebelum dikirim ulang
 * (lihat `suratInsertOperation`).
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

/** Pembaca data tenant: `ctx.read` saat menyiapkan, atau transaksi pencatatan hasil (`inTx`). */
type Read = OperationContext['read'];
const inTx =
  (tx: TenantTx): Read =>
  (fn) =>
    fn(tx);

async function externalValue(
  read: Read,
  entity: 'practitioner' | 'queue_service',
  entityId: string | null,
  system: string,
  missing: string,
): Promise<string> {
  if (!entityId) throw new PermanentOperationError(missing);
  const ext = await read((tx) =>
    tx.externalId.findFirst({ where: { entity, entityId, system, active: true }, select: { value: true } }),
  );
  if (!ext) throw new PermanentOperationError(missing);
  return ext.value;
}

const dpjpCode = (r: ReferralForSend, read: Read) =>
  externalValue(
    read,
    'practitioner',
    r.practitionerId,
    'bpjs:hfis-dokter',
    'Kode DPJP BPJS dokter belum dipetakan',
  );
const poliCode = (r: ReferralForSend, read: Read) =>
  externalValue(
    read,
    'queue_service',
    r.targetServiceId,
    'bpjs:poli',
    'Kode poli BPJS tujuan belum dipetakan',
  );

/** No. kartu BPJS penjaminan kunjungan asal (didekripsi saat dikirim). */
function kartuOf(r: ReferralForSend, ctx: OperationContext): string {
  const ident = r.encounter?.coverages[0]?.patientIdentifier;
  if (!ident || ident.system !== 'bpjs') throw new PermanentOperationError('Penjaminan tanpa no. kartu BPJS');
  return ctx.crypto.decryptIdentifier(ident.valueEnc);
}

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

// ---------------------------------------------------------------------------------------------------------------
// Surat kontrol + SPRI: cari surat yang sudah terbit sebelum mengirim ulang
// ---------------------------------------------------------------------------------------------------------------

type SuratKind = 'surat-kontrol' | 'spri';

/** Isian surat yang dicocokkan dengan daftar surat BPJS (dibaca ulang dari baris saat hasil dicatat). */
interface SuratKeys {
  jnsKontrol: '1' | '2';
  /** SEP asal (surat kontrol); null untuk SPRI. */
  sepNo: string | null;
  dpjp: string;
  poli: string;
  planned: string;
}

async function suratKeys(r: ReferralForSend, kind: SuratKind, read: Read): Promise<SuratKeys> {
  return {
    jnsKontrol: kind === 'spri' ? VCLAIM_JENIS_SURAT.spri : VCLAIM_JENIS_SURAT.kontrol,
    sepNo: kind === 'spri' ? null : sepNoOf(r),
    dpjp: await dpjpCode(r, read),
    poli: await poliCode(r, read),
    planned: plannedOf(r),
  };
}

/**
 * Kiriman sebelumnya mungkin sudah diproses BPJS walau jawabannya tidak sampai:
 * - pesan ini pernah dicoba (`attempts > 0`: gangguan/timeout, termasuk pencarian yang belum terjawab), atau
 * - kirim ulang petugas setelah DLQ: pesan urut sebelumnya untuk baris ini berstatus `dead`.
 * Pesan urut sebelumnya yang `sent` berarti jawaban BPJS pasti (ditolak, atau pencarian tidak menemukan surat).
 */
async function mayHaveIssued(
  msg: Pick<OutboxMessageLike, 'attempts' | 'operation'>,
  r: { id: string; syncSeq: number },
  statusOf: (idempotencyKey: string) => Promise<string | null>,
): Promise<boolean> {
  if (msg.attempts > 0) return true;
  if (r.syncSeq <= 1) return false;
  const prev = outboxKey(msg.operation as FrontOfficeOperation, r.id, r.syncSeq - 1);
  return (await statusOf(prev)) === 'dead';
}

/**
 * Surat di daftar BPJS yang cocok dengan baris ini dan belum dipakai baris rujukan lain di RS ini. Lebih dari satu
 * (kiriman ganda sebelum mitigasi ini) → nomor terkecil; sisanya dibiarkan kedaluwarsa di BPJS.
 */
async function matchSurat(
  tx: TenantTx,
  referralId: string,
  list: VclaimSuratKontrolListItem[],
  k: SuratKeys,
): Promise<string | undefined> {
  const candidates = list
    .filter(
      (s) =>
        s.jnsKontrol === k.jnsKontrol &&
        s.tglRencanaKontrol === k.planned &&
        s.poliTujuan === k.poli &&
        s.kodeDokter === k.dpjp &&
        (k.sepNo === null || s.noSepAsalKontrol === k.sepNo),
    )
    .map((s) => s.noSuratKontrol)
    .sort();
  if (candidates.length === 0) return undefined;
  const taken = await tx.referral.findMany({
    where: { number: { in: candidates }, NOT: { id: referralId } },
    select: { number: true },
  });
  const used = new Set(taken.map((t) => t.number));
  return candidates.find((no) => !used.has(no));
}

/** Pencarian tidak menemukan surat: pesan urut berikutnya menerbitkan (percobaan pertamanya langsung insert). */
async function nextInsert(tx: TenantTx, msg: OutboxMessage, r: { id: string; syncSeq: number }) {
  const seq = r.syncSeq + 1;
  const row = await tx.referral.update({
    where: { id: r.id },
    data: { syncSeq: seq },
    select: { tenantId: true },
  });
  const operation = msg.operation as FrontOfficeOperation;
  await enqueueOutbox(tx, row.tenantId, {
    target: 'bpjs',
    operation,
    idempotencyKey: outboxKey(operation, r.id, seq),
    payload: { referralId: r.id },
  });
}

/** Status pesan outbox lain (tenant + target sama) dari transaksi pencatatan hasil. */
const statusInTx = (tx: TenantTx, msg: OutboxMessage) => async (idempotencyKey: string) =>
  (
    await tx.outboxMessage.findUnique({
      where: {
        tenantId_target_idempotencyKey: { tenantId: msg.tenantId, target: msg.target, idempotencyKey },
      },
      select: { status: true },
    })
  )?.status ?? null;

/**
 * VClaim tidak idempoten untuk surat kontrol/SPRI: kiriman yang timeout setelah BPJS memprosesnya lalu dikirim ulang
 * menerbitkan surat kedua. Pola histori SEP (5a): kiriman yang mungkin sudah diproses (`mayHaveIssued`) didahului
 * `GET` daftar surat milik kartu pada bulan tanggal rencana (`filter` = tanggal rencana).
 * - Ditemukan surat yang cocok (jenis, SEP asal untuk surat kontrol, tanggal rencana, poli, DPJP) → nomornya dipakai,
 *   tanpa menerbitkan lagi.
 * - Tidak ditemukan (tidak ada yang cocok, atau BPJS menjawab "data tidak ditemukan") → pesan urut berikutnya.
 * - Pencarian ditolak BPJS dengan alasan lain → DLQ (bukan "ditolak"), agar kirim ulang petugas tetap didahului
 *   pencarian.
 * Sisa celah: worker mati setelah BPJS memproses tetapi sebelum percobaan tercatat (pesan diklaim ulang setelah lease
 * habis dengan `attempts` yang sama) masih bisa menerbitkan surat kedua.
 */
function suratInsertOperation<R extends object>(def: {
  kind: SuratKind;
  response: z.ZodType<R>;
  path: string;
  request(r: ReferralForSend, ctx: OperationContext, k: SuratKeys): unknown;
  number(res: R): string;
}): OutboxOperation {
  const listSchema = vclaimSuratKontrolListResponseSchema;
  type List = z.infer<typeof listSchema>;
  const isList = (res: R | List): res is List => 'list' in res;

  return defineBpjsOperation<R | List>({
    response: z.union([def.response, listSchema]),
    async prepare(msg, ctx) {
      const r = await ctx.read((tx) => loadReferral(tx, referralIdOf(msg)));
      const skip = insertSkip(r, def.kind, msg);
      if (skip || !r) return { skip: skip ?? 'rujukan tidak ditemukan' };
      const k = await suratKeys(r, def.kind, ctx.read);
      const lookup = await mayHaveIssued(
        msg,
        r,
        async (idempotencyKey) => (await ctx.findMessage({ target: 'bpjs', idempotencyKey }))?.status ?? null,
      );
      if (!lookup) return { service: 'vclaim', method: 'POST', path: def.path, body: def.request(r, ctx, k) };
      const [tahun, bulan] = k.planned.split('-') as [string, string];
      return {
        service: 'vclaim',
        method: 'GET',
        path: bpjsPath(VCLAIM_ENDPOINTS.rencanaKontrolListByKartu.path, {
          bulan,
          tahun,
          noKartu: kartuOf(r, ctx),
          filter: VCLAIM_FILTER_SURAT.tglRencana,
        }),
      };
    },
    async onAccepted(tx, msg, res) {
      if (!isList(res)) {
        await settle(tx, msg, 'pending', issued(def.number(res)));
        return;
      }
      const r = await loadReferral(tx, referralIdOf(msg));
      if (!r || insertSkip(r, def.kind, msg)) return;
      const found = await matchSurat(tx, r.id, res.list, await suratKeys(r, def.kind, inTx(tx)));
      if (found) await settle(tx, msg, 'pending', issued(found));
      else await nextInsert(tx, msg, r);
    },
    async onRejected(tx, msg, rejection) {
      const r = await loadReferral(tx, referralIdOf(msg));
      if (!r || insertSkip(r, def.kind, msg)) return;
      if (!(await mayHaveIssued(msg, r, statusInTx(tx, msg)))) {
        await settle(tx, msg, 'pending', rejected(rejection));
        return;
      }
      // Jawaban pencarian daftar surat.
      if (rejection.code === 'BPJS_DATA_TIDAK_DITEMUKAN') {
        await nextInsert(tx, msg, r);
        return;
      }
      throw new PermanentOperationError(`Pencarian surat BPJS ditolak: ${rejection.code}`);
    },
    async onDead(tx, msg) {
      await settle(tx, msg, 'pending', dead);
    },
  });
}

export const bpjsRencanaKontrolInsert = suratInsertOperation<VclaimRencanaKontrolResponse>({
  kind: 'surat-kontrol',
  response: vclaimRencanaKontrolResponseSchema,
  path: VCLAIM_ENDPOINTS.rencanaKontrolInsert.path,
  request(_r, _ctx, k): VclaimRencanaKontrolRequest {
    return {
      request: {
        noSEP: k.sepNo as string,
        kodeDokter: k.dpjp,
        poliKontrol: k.poli,
        tglRencanaKontrol: k.planned,
        user: VCLAIM_USER,
      },
    };
  },
  number: (res) => res.noSuratKontrol,
});

export const bpjsSpriInsert = suratInsertOperation<VclaimSpriResponse>({
  kind: 'spri',
  response: vclaimSpriResponseSchema,
  path: VCLAIM_ENDPOINTS.spriInsert.path,
  request(r, ctx, k): VclaimSpriRequest {
    return {
      request: {
        noKartu: kartuOf(r, ctx),
        kodeDokter: k.dpjp,
        poliKontrol: k.poli,
        tglRencanaKontrol: k.planned,
        user: VCLAIM_USER,
      },
    };
  },
  number: (res) => res.noSPRI,
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
