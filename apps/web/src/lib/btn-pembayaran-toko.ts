import {
  CONNECTION_MODES,
  type PaymentOverview,
  type PaymentTransaction,
  REFUND_REASONS,
  REFUND_STAGES,
  type ReconRow,
  type Refund,
  type RefundStage,
} from '@simrs/shared';
import { z } from 'zod';
import {
  applyRefund,
  markPaid,
  nextRefundStage,
  type RefundSubmission,
  refundView,
  type Resolution,
  resolveRow,
  settleByResolution,
  settleEdc,
  settleEdcTx,
} from './btn';
import { type DemoActor, defineDomain, on } from './demo/store/define';
import { REKENING } from './demo/fixtures/rs';
import {
  AKUN_LANJUT as A,
  autoJurnalSchema,
  cr,
  dr,
  jurnal,
  refundJournal,
  toAutoJurnal,
} from './keuangan-jurnal';
import { TITIPAN } from './keuangan-kasbank';
import { tagihanDomain } from './keuangan-tagihan-toko';

/**
 * I05/U09 · Domain toko demo `pembayaran-btn` (ADR-0085): Pembayaran digital TPDI × BTN (mode presentasi). Keadaan =
 * tindakan di atas fixture: pelunasan simulasi (webhook), penyelesaian pengecualian, rekonsiliasi 3 arah, refund
 * berjenjang, konfigurasi kanal, rotasi secret.
 *
 * - Langganan `tagihan` · `tagihan.bayar` QRIS/VA: pelunasan di Kasir menjadi transaksi TPDI lunas (atau melunasi
 *   tagihan TPDI yang menunggu dengan nomor invoice sama) + baris rekonsiliasi yang menunggu mutasi BTN.
 * - `rekonsiliasi` membawa kunci rekonsiliasi (`tpdi:<invoice>`) yang cocok di tiga sumber; domain `akuntansi`
 *   memposting jurnal yang menunggu rekonsiliasi dengan kunci itu.
 * - Refund: pembuat ≠ penyetuju tingkat 1 ≠ penyetuju tingkat 2 (id pengguna sesi); dana kembali → jurnal.
 * Dana pasien tidak transit di TPDI (ADR-0005): rekening tujuan selalu rekening operasional RS di BTN.
 */

export const PEMBAYARAN_DOMAIN = 'pembayaran-btn';

const stamp = z.iso.datetime({ offset: true });
const id = z.string().regex(/^[a-z0-9-]{1,40}$/);

export const pembayaranEventSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('bayar-simulasi'),
    transactionId: id,
    invoiceNo: z.string().min(1).max(40),
    at: stamp,
    jurnal: z.array(autoJurnalSchema).length(1),
  }),
  z.strictObject({
    type: z.literal('pengecualian'),
    rowId: id,
    actionId: id,
    note: z.string().trim().min(10).max(300),
    at: stamp,
    jurnal: z.array(autoJurnalSchema).max(1),
  }),
  z.strictObject({
    type: z.literal('rekonsiliasi'),
    /** Kunci rekonsiliasi yang cocok tiga arah pada saat dijalankan (dihitung server). */
    reconKeys: z.array(z.string().min(1).max(80)).max(200),
    at: stamp,
  }),
  z.strictObject({
    type: z.literal('refund-ajukan'),
    refundId: id,
    amount: z.string().regex(/^[1-9]\d{0,12}$/),
    reason: z.enum(REFUND_REASONS),
    note: z.string().trim().min(15).max(300),
    at: stamp,
  }),
  z.strictObject({
    type: z.literal('refund-setujui'),
    refundId: id,
    stage: z.enum(REFUND_STAGES),
    at: stamp,
    jurnal: z.array(autoJurnalSchema).max(1),
  }),
  z.strictObject({
    type: z.literal('konfigurasi'),
    channels: z.strictObject({ va: z.boolean(), qris: z.boolean(), edc: z.boolean(), cicilan: z.boolean() }),
    vaExpiry: z.enum(['12', '24', '48']),
    qrisExpiry: z.enum(['5', '10', '15']),
    mode: z.enum(CONNECTION_MODES),
    at: stamp,
  }),
  z.strictObject({ type: z.literal('rotasi-secret'), at: stamp }),
]);
export type PembayaranEvent = z.infer<typeof pembayaranEventSchema>;

interface Signed {
  by: string;
  byId: string;
  at: string;
}

export interface StoredRefund {
  stage: RefundStage;
  sub: RefundSubmission | null;
  log: Array<{ at: string; text: string }>;
  submitter: Signed | null;
  level1: Signed | null;
  level2: Signed | null;
}

/** Pelunasan QRIS/VA dari Kasir. */
export interface KasirPayment {
  seq: number;
  invoiceNo: string;
  patient: { id: string; name: string; rm: string };
  channel: 'QRIS' | 'VA';
  amount: string;
  reference: string;
  at: string;
  by: string;
}

export interface PembayaranState {
  paid: Readonly<Record<string, { at: string; eventId: string; invoiceNo: string }>>;
  resolutions: Readonly<Record<string, Resolution>>;
  recon: { at: string; by: string } | null;
  /** Kunci rekonsiliasi yang sudah cocok tiga arah. */
  reconciled: readonly string[];
  refunds: Readonly<Record<string, StoredRefund>>;
  config: {
    channels: { va: boolean; qris: boolean; edc: boolean; cicilan: boolean };
    vaExpiry: string;
    qrisExpiry: string;
    mode: (typeof CONNECTION_MODES)[number];
    savedAt: string;
    by: string;
  } | null;
  rotated: { at: string; by: string } | null;
  kasir: readonly KasirPayment[];
  lastWebhookAt: string | null;
}

export const reconKeyOf = (invoiceNo: string) => `tpdi:${invoiceNo}`;

const signed = (a: DemoActor, at: string): Signed => ({ by: a.name, byId: a.userId, at });

/** Tahap refund efektif (fixture + toko). */
export function refundStageOf(s: PembayaranState, r: Pick<Refund, 'id' | 'stage'>): RefundStage {
  return s.refunds[r.id]?.stage ?? r.stage;
}

/**
 * Gerbang pemisahan tugas refund dari id pengguna sesi: penyetuju tingkat 1 ≠ pembuat; tingkat 2 ≠ pembuat dan ≠
 * penyetuju tingkat 1. Pembuat data contoh (tanpa id) tidak dibandingkan.
 */
export function refundSodProblem(
  s: PembayaranState,
  refundId: string,
  stage: RefundStage,
  actor: DemoActor,
): string | null {
  const r = s.refunds[refundId];
  if (stage === 'menunggu-supervisor' && r?.submitter?.byId === actor.userId) {
    return 'Pemisahan tugas: pengaju refund tidak boleh menyetujui tingkat 1.';
  }
  if (stage === 'menunggu-manajer') {
    if (r?.submitter?.byId === actor.userId)
      return 'Pemisahan tugas: pengaju refund tidak boleh menyetujui tingkat 2.';
    if (r?.level1?.byId === actor.userId) {
      return 'Pemisahan tugas: penyetuju tingkat 2 harus berbeda dari penyetuju tingkat 1.';
    }
  }
  return null;
}

function gate(s: PembayaranState, ev: PembayaranEvent, actor: DemoActor): string | null {
  switch (ev.type) {
    case 'bayar-simulasi':
      return s.paid[ev.transactionId] ? 'Tagihan ini sudah lunas.' : null;
    case 'pengecualian':
      return s.resolutions[ev.rowId] ? 'Pengecualian ini sudah ditangani.' : null;
    case 'rekonsiliasi':
      return null;
    case 'refund-ajukan':
      return s.refunds[ev.refundId] ? 'Refund ini sudah diajukan.' : null;
    case 'refund-setujui': {
      const cur = s.refunds[ev.refundId]?.stage;
      if (cur && cur !== ev.stage) return 'Tahap refund ini sudah lewat; muat ulang.';
      return refundSodProblem(s, ev.refundId, ev.stage, actor);
    }
    case 'konfigurasi':
      return Object.values(ev.channels).some(Boolean) ? null : 'Minimal satu kanal pembayaran harus aktif.';
    case 'rotasi-secret':
      return null;
  }
}

const EMPTY_REFUND: StoredRefund = {
  stage: 'draf',
  sub: null,
  log: [],
  submitter: null,
  level1: null,
  level2: null,
};

export const pembayaranDomain = defineDomain<PembayaranState, PembayaranEvent>(PEMBAYARAN_DOMAIN, {
  initial: () => ({
    paid: {},
    resolutions: {},
    recon: null,
    reconciled: [],
    refunds: {},
    config: null,
    rotated: null,
    kasir: [],
    lastWebhookAt: null,
  }),
  eventSchema: pembayaranEventSchema,
  screens: ['pembayaran'],
  validate: gate,
  reduce: (s, ev) => {
    const d = ev.data;
    const err = gate(s, d, ev.actor);
    if (err) throw new Error(err);
    const by = ev.actor.name;
    switch (d.type) {
      case 'bayar-simulasi':
        return {
          ...s,
          paid: {
            ...s.paid,
            [d.transactionId]: { at: d.at, eventId: `evt-toko-${ev.seq}`, invoiceNo: d.invoiceNo },
          },
          lastWebhookAt: d.at,
        };
      case 'pengecualian':
        return {
          ...s,
          resolutions: { ...s.resolutions, [d.rowId]: { actionId: d.actionId, note: d.note, at: d.at, by } },
          lastWebhookAt: d.actionId === 'ulang' ? d.at : s.lastWebhookAt,
        };
      case 'rekonsiliasi':
        return {
          ...s,
          recon: { at: d.at, by },
          reconciled: [...new Set([...s.reconciled, ...d.reconKeys])],
        };
      case 'refund-ajukan': {
        const sub: RefundSubmission = { amount: d.amount, reason: d.reason, note: d.note };
        return {
          ...s,
          refunds: {
            ...s.refunds,
            [d.refundId]: {
              ...EMPTY_REFUND,
              stage: 'menunggu-supervisor',
              sub,
              submitter: signed(ev.actor, d.at),
              log: [{ at: d.at, text: `Diajukan oleh ${by}` }],
            },
          },
        };
      }
      case 'refund-setujui': {
        const cur = s.refunds[d.refundId] ?? { ...EMPTY_REFUND, stage: d.stage };
        const next = nextRefundStage(d.stage) ?? d.stage;
        const text =
          d.stage === 'menunggu-supervisor'
            ? `Disetujui supervisor kasir (tingkat 1) · ${by}`
            : d.stage === 'menunggu-manajer'
              ? `Disetujui manajer keuangan (tingkat 2) · ${by}`
              : 'Dana diterima rekening pasien · webhook refund.completed dari TPDI';
        const extra =
          d.stage === 'menunggu-manajer'
            ? [{ at: d.at, text: `Instruksi transfer dikirim via TPDI → BTN, debit ${REKENING.operasional}` }]
            : [];
        return {
          ...s,
          refunds: {
            ...s.refunds,
            [d.refundId]: {
              ...cur,
              stage: next,
              log: [...cur.log, { at: d.at, text }, ...extra],
              level1: d.stage === 'menunggu-supervisor' ? signed(ev.actor, d.at) : cur.level1,
              level2: d.stage === 'menunggu-manajer' ? signed(ev.actor, d.at) : cur.level2,
            },
          },
          lastWebhookAt: d.stage === 'diproses-btn' ? d.at : s.lastWebhookAt,
        };
      }
      case 'konfigurasi':
        return {
          ...s,
          config: {
            channels: d.channels,
            vaExpiry: d.vaExpiry,
            qrisExpiry: d.qrisExpiry,
            mode: d.mode,
            savedAt: d.at,
            by,
          },
        };
      case 'rotasi-secret':
        return { ...s, rotated: { at: d.at, by } };
    }
  },
  subscriptions: [
    on(tagihanDomain, (s, ev) => {
      const d = ev.data;
      if (d.type !== 'tagihan.bayar' || (d.method !== 'qris' && d.method !== 'va')) return s;
      if (s.kasir.some((k) => k.invoiceNo === d.invoiceNo)) return s;
      return {
        ...s,
        kasir: [
          ...s.kasir,
          {
            seq: ev.seq,
            invoiceNo: d.invoiceNo,
            patient: d.patient,
            channel: d.method === 'qris' ? 'QRIS' : 'VA',
            amount: d.amount,
            reference: d.reference,
            at: d.at,
            by: ev.actor.name,
          },
        ],
        lastWebhookAt: d.at,
      };
    }),
  ],
});

// ---------------------------------------------------------------------------------------------------------------
// Jurnal dan penerapan ke papan Pembayaran digital.
// ---------------------------------------------------------------------------------------------------------------

/** Jurnal pelunasan simulasi tagihan TPDI (deposit/uang muka atau piutang pasien), menunggu rekonsiliasi. */
export function simulatedPaymentJournal(
  tx: Pick<PaymentTransaction, 'invoiceNo' | 'amount' | 'purpose' | 'channel'>,
) {
  const amount = BigInt(tx.amount);
  const deposit = /deposit|uang muka/i.test(tx.purpose);
  return toAutoJurnal(
    jurnal(`${tx.channel} TPDI ${tx.invoiceNo} lunas (webhook)`, [
      dr(A.bankOps, amount),
      cr(deposit ? A.uangMuka : A.piutangPasien, amount),
    ]),
    {
      source: 'tpdi-btn',
      reference: `TPDI · ${tx.invoiceNo}`,
      status: 'menunggu-rekonsiliasi',
      reconKey: reconKeyOf(tx.invoiceNo),
    },
  );
}

/** Jurnal penyelesaian pengecualian rekonsiliasi (null bila tidak ada mutasi uang yang dicatat). */
export function exceptionJournal(row: ReconRow, actionId: string) {
  const ex = row.exception;
  if (!ex) return null;
  const ref = { source: 'tpdi-btn' as const, reference: `Rekonsiliasi · ${row.source}` };
  if (ex.kind === 'webhook-gagal' && actionId === 'lunas') {
    const v = BigInt(row.tpdi.amount ?? '0');
    return v > 0n
      ? toAutoJurnal(
          jurnal(`Pelunasan dari laporan TPDI + mutasi BTN`, [dr(A.bankOps, v), cr(A.uangMuka, v)]),
          ref,
        )
      : null;
  }
  if (ex.kind === 'nominal-beda' && actionId === 'mdr') {
    const v = -BigInt(ex.adjustment);
    return v > 0n
      ? toAutoJurnal(jurnal('Beban MDR QRIS dari selisih mutasi', [dr(A.bebanMdr, v), cr(A.bankOps, v)]), ref)
      : null;
  }
  if (ex.kind === 'hanya-di-bank') {
    const v = BigInt(row.bank.amount ?? '0');
    if (v <= 0n) return null;
    const credit = actionId === 'padan' ? A.piutangPasien : TITIPAN;
    return toAutoJurnal(
      jurnal(`Mutasi masuk tanpa referensi · ${actionId}`, [dr(A.bankOps, v), cr(credit, v)]),
      ref,
    );
  }
  return null;
}

/** Jurnal dana refund kembali ke pasien (debit rekening operasional BTN). */
export function refundDoneJournal(r: Pick<Refund, 'number' | 'amount'>) {
  return toAutoJurnal(refundJournal(r.number, BigInt(r.amount)), {
    source: 'tpdi-btn',
    reference: `Refund · ${r.number}`,
  });
}

function kasirTransaction(k: KasirPayment): PaymentTransaction {
  const eventId = `evt-kasir-${k.seq}`;
  return {
    id: `tx-kasir-${k.seq}`,
    invoiceNo: k.invoiceNo,
    patient: k.patient,
    channel: k.channel,
    amount: k.amount,
    status: 'lunas',
    externalRef: `TPDI-TX-2610-${String(k.seq).padStart(6, '0')}`,
    reference: k.reference,
    purpose: `Pelunasan tagihan di Kasir (${k.by})`,
    createdAt: k.at,
    expiresAt: null,
    paidAt: k.at,
    account: REKENING.operasional,
    trail: [
      {
        label: 'Tagihan dibuat',
        at: k.at,
        note: `${k.channel === 'VA' ? 'VA' : 'QR'} diterbitkan via API TPDI`,
        state: 'selesai',
      },
      { label: 'Dibayar pasien', at: k.at, note: k.reference, state: 'selesai' },
      {
        label: 'Webhook diterima · signature valid',
        at: k.at,
        note: `HMAC-SHA256 cocok · ${eventId}`,
        state: 'selesai',
      },
      { label: 'Kasir lunas', at: k.at, note: 'kuitansi terbit · jurnal bank otomatis', state: 'selesai' },
      {
        label: `Masuk mutasi BTN ${REKENING.operasional}`,
        at: k.at,
        note: 'kredit langsung ke rekening operasional',
        state: 'selesai',
      },
    ],
    webhooks: [
      {
        id: eventId,
        event: 'payment.paid',
        receivedAt: k.at,
        amount: k.amount,
        signatureValid: true,
        duplicate: false,
        response: '200 OK · 84 ms',
      },
    ],
    openInCashier: false,
    scenario: false,
  };
}

function newReconRow(id: string, tx: PaymentTransaction, reconciled: boolean): ReconRow {
  return {
    id,
    label: tx.patient.name,
    source: `${tx.channel === 'VA' ? 'VA BTN' : 'QRIS'} · ${tx.invoiceNo}`,
    transactionId: tx.id,
    kasir: { amount: tx.amount, note: 'kuitansi kasir' },
    tpdi: { amount: tx.amount, note: 'laporan TPDI' },
    bank: reconciled
      ? { amount: tx.amount, note: 'mutasi H2H BTN' }
      : { amount: null, note: 'menunggu tarik mutasi BTN' },
    status: reconciled ? 'cocok' : 'belum-dicocokkan',
    note: reconciled ? '' : 'jalankan rekonsiliasi',
    exception: null,
    scenario: false,
  };
}

/** Kunci rekonsiliasi transaksi toko (kasir + pelunasan simulasi) yang belum cocok. */
export function pendingReconKeys(s: PembayaranState): string[] {
  const keys = [...s.kasir.map((k) => k.invoiceNo), ...Object.values(s.paid).map((p) => p.invoiceNo)].map(
    reconKeyOf,
  );
  return [...new Set(keys)].filter((k) => !s.reconciled.includes(k));
}

/**
 * Papan Pembayaran digital setelah keadaan toko diterapkan. `localPaid` = transaksi yang lunas karena aksi tersimpan
 * (untuk KPI harian).
 */
export function applyPembayaran(
  data: PaymentOverview,
  s: PembayaranState,
): { data: PaymentOverview; localPaid: string[] } {
  const rec = new Set(s.reconciled);
  const kasirByInvoice = new Map(s.kasir.map((k) => [k.invoiceNo, k]));
  const localPaid: string[] = [];
  const reconAt = s.recon?.at ?? null;
  // Transaksi fixture: pelunasan simulasi atau pelunasan Kasir dengan nomor invoice sama.
  let txs = data.transactions.map((t) => {
    const p = s.paid[t.id];
    const k = kasirByInvoice.get(t.invoiceNo);
    if (p) {
      localPaid.push(t.id);
      return markPaid(t, p.at, p.eventId);
    }
    if (k && t.status === 'menunggu' && !t.scenario && t.channel === k.channel && t.amount === k.amount) {
      kasirByInvoice.delete(t.invoiceNo);
      localPaid.push(t.id);
      return markPaid(t, k.at, `evt-kasir-${k.seq}`);
    }
    return t;
  });
  const fresh = [...kasirByInvoice.values()].map(kasirTransaction);
  for (const t of fresh) localPaid.push(t.id);
  txs = [...fresh.reverse(), ...txs];

  let rows = data.recon.rows.map((r) => {
    const res = s.resolutions[r.id];
    const row = res ? resolveRow(r, res) : r;
    return reconAt ? settleEdc(row) : row;
  });
  const withRow = new Set(rows.map((r) => r.transactionId));
  const added = txs
    .filter((t) => localPaid.includes(t.id) && !withRow.has(t.id))
    .map((t) => newReconRow(`r-toko-${t.id}`.slice(0, 60), t, rec.has(reconKeyOf(t.invoiceNo))));
  rows = [...added, ...rows];
  txs = txs.map((t) => {
    let tx = t;
    for (const r of rows) tx = settleByResolution(tx, r);
    tx = settleEdcTx(tx, reconAt);
    for (const rf of data.refunds) {
      const st = s.refunds[rf.id];
      const done = st?.stage === 'dana-kembali' ? (st.log.at(-1)?.at ?? null) : null;
      tx = applyRefund(tx, refundView(rf, st?.stage, st?.sub ?? undefined), done);
    }
    return tx;
  });
  const refunds = data.refunds.map((r) => {
    const st = s.refunds[r.id];
    if (!st) return r;
    const v = refundView(r, st.stage, st.sub ?? undefined);
    return { ...v, log: [...r.log, ...st.log] };
  });
  const cfg = s.config;
  const config = cfg
    ? {
        ...data.config,
        mode: cfg.mode,
        channels: data.config.channels.map((c) => ({
          ...c,
          enabled: cfg.channels[c.id],
          expiry: c.expiry
            ? {
                ...c.expiry,
                value: c.id === 'va' ? cfg.vaExpiry : c.id === 'qris' ? cfg.qrisExpiry : c.expiry.value,
              }
            : null,
        })),
      }
    : data.config;
  return {
    localPaid,
    data: {
      ...data,
      connection: {
        ...data.connection,
        lastWebhookAt:
          s.lastWebhookAt && Date.parse(s.lastWebhookAt) > Date.parse(data.connection.lastWebhookAt)
            ? s.lastWebhookAt
            : data.connection.lastWebhookAt,
        lastBankPullAt: reconAt ?? data.connection.lastBankPullAt,
      },
      transactions: txs,
      recon: { ...data.recon, rows },
      refunds,
      config,
    },
  };
}
