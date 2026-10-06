import {
  type Drawdown,
  type FinancingOverview,
  INSTALMENT_STAGES,
  type InstalmentApplication,
  isoDateJakarta,
  type ReceivableBatch,
} from '@simrs/shared';
import { z } from 'zod';
import { addDays, nextInstalmentStage, simulateBpjsPayment } from './btn-pembiayaan';
import { defineDomain, on } from './demo/store/define';
import { FASILITAS, PENCAIRAN } from './demo/fixtures/btn';
import { DEMO_TODAY } from './demo/fixtures/waktu';
import { AKUN_LANJUT as A, autoJurnalSchema, cr, dr, jurnal, toAutoJurnal } from './keuangan-jurnal';
import { klaimDomain } from './keuangan-klaim-toko';
import { tagihanDomain } from './keuangan-tagihan-toko';

/**
 * U04 · Domain toko demo `pembiayaan-btn` (ADR-0085): Pembiayaan BTN (mode presentasi).
 *
 * - Langganan `klaim` · `klaim.verifikasi`: klaim layak bayar (BA verifikasi, mock E-Klaim) masuk pool pembiayaan
 *   piutang BPJS sebagai batch baru yang bisa dijaminkan.
 * - Langganan `tagihan` · `tagihan.bayar` metode cicilan: pelunasan Kasir dengan cicilan BTN tercatat sebagai
 *   pengajuan cicilan pasien yang sudah dicairkan (RS menerima pelunasan penuh, pasien mengangsur ke BTN).
 * - Pengajuan → persetujuan → pencairan (jurnal Bank/utang pembiayaan) → pembayaran BPJS (auto-debit pokok + margin,
 *   sisa diteruskan; jurnal) dan tahap cicilan pasien (penolakan beralasan) tersimpan atas nama pengguna sesi.
 */

export const PEMBIAYAAN_DOMAIN = 'pembiayaan-btn';

const stamp = z.iso.datetime({ offset: true });
const id = z.string().regex(/^[A-Za-z0-9-]{1,60}$/);
const rupiah = z.string().regex(/^[1-9]\d{0,15}$/);

export const pembiayaanEventSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('pencairan.ajukan'),
    batchIds: z.array(id).min(1).max(20),
    principal: rupiah,
    at: stamp,
  }),
  z.strictObject({
    type: z.literal('pencairan.lanjut'),
    drawdownId: id,
    at: stamp,
    jurnal: z.array(autoJurnalSchema).max(1),
  }),
  z.strictObject({
    type: z.literal('bpjs.bayar'),
    drawdownId: id,
    claims: z.string().regex(/^\d{1,15}$/),
    principal: z.string().regex(/^\d{1,15}$/),
    margin: z.string().regex(/^\d{1,15}$/),
    forwarded: z.string().regex(/^\d{1,15}$/),
    days: z.number().int().min(0).max(400),
    basis: z.string().min(1).max(200),
    at: stamp,
    jurnal: z.array(autoJurnalSchema).min(1).max(2),
  }),
  z.strictObject({
    type: z.literal('cicilan.lanjut'),
    applicationId: id,
    stage: z.enum(INSTALMENT_STAGES),
    at: stamp,
  }),
  z.strictObject({
    type: z.literal('cicilan.tolak'),
    applicationId: id,
    reason: z.string().trim().min(10).max(300),
    at: stamp,
  }),
]);
export type PembiayaanEvent = z.infer<typeof pembiayaanEventSchema>;

export interface AppPatch {
  stage: InstalmentApplication['stage'];
  history: InstalmentApplication['history'];
  rejectReason: string | null;
  by: string;
}

export interface PembiayaanState {
  /** Pencairan baru (pengajuan di layar) dan perubahan tahap pencairan fixture. */
  drawdowns: Readonly<Record<string, Drawdown>>;
  /** Jam tiap tahap pencairan (aju/ok/cair) + pelaku. */
  stamps: Readonly<Record<string, { aju?: string; ok?: string; cair?: string; by?: string }>>;
  lastPay: {
    drawdownId: string;
    at: string;
    claims: string;
    principal: string;
    margin: string;
    forwarded: string;
    days: number;
    basis: string;
    by: string;
  } | null;
  /** Batch pool baru dari klaim layak bayar (layar Klaim). */
  pool: readonly ReceivableBatch[];
  apps: Readonly<Record<string, AppPatch>>;
  /** Pengajuan cicilan baru dari Kasir. */
  newApps: readonly InstalmentApplication[];
  newDrawdownSeq: number;
}

/** Pencairan efektif (fixture + toko). */
export function drawdownsOf(base: readonly Drawdown[], s: PembiayaanState): Drawdown[] {
  const known = new Set(base.map((d) => d.id));
  return [
    ...base.map((d) => s.drawdowns[d.id] ?? d),
    ...Object.values(s.drawdowns).filter((d) => !known.has(d.id)),
  ];
}

export const nextDrawdownId = (s: Pick<PembiayaanState, 'newDrawdownSeq'>) =>
  `PCR-2610-${String(s.newDrawdownSeq).padStart(2, '0')}`;

function gate(s: PembiayaanState, ev: PembiayaanEvent): string | null {
  switch (ev.type) {
    case 'pencairan.ajukan':
      return Object.values(s.drawdowns).some((d) => d.stage === 'diajukan' || d.stage === 'disetujui')
        ? 'Masih ada pengajuan yang diproses BTN.'
        : null;
    case 'pencairan.lanjut': {
      const d = s.drawdowns[ev.drawdownId];
      if (!d) return 'Pengajuan tidak ditemukan.';
      return d.stage === 'diajukan' || d.stage === 'disetujui' ? null : 'Pengajuan ini sudah dicairkan.';
    }
    case 'bpjs.bayar': {
      const cur = drawdownById(s, ev.drawdownId);
      return cur?.stage === 'cair' ? null : 'Hanya pencairan yang sudah cair yang bisa dilunasi BPJS.';
    }
    case 'cicilan.lanjut':
    case 'cicilan.tolak': {
      const a = s.apps[ev.applicationId];
      if (a && (a.stage === 'ditolak' || a.stage === 'dicairkan'))
        return 'Pengajuan ini sudah diputuskan BTN.';
      if (ev.type === 'cicilan.lanjut' && a && a.stage !== ev.stage)
        return 'Tahap cicilan sudah berubah; muat ulang.';
      return null;
    }
  }
}

export const pembiayaanDomain = defineDomain<PembiayaanState, PembiayaanEvent>(PEMBIAYAAN_DOMAIN, {
  initial: () => ({
    drawdowns: {},
    stamps: {},
    lastPay: null,
    pool: [],
    apps: {},
    newApps: [],
    newDrawdownSeq: 1,
  }),
  eventSchema: pembiayaanEventSchema,
  screens: ['pembiayaan'],
  validate: (s, ev) => gate(s, ev),
  reduce: (s, ev) => {
    const d = ev.data;
    const err = gate(s, d);
    if (err) throw new Error(err);
    const by = ev.actor.name;
    const day = isoDateJakarta(d.at);
    switch (d.type) {
      case 'pencairan.ajukan': {
        const idNew = nextDrawdownId(s);
        return {
          ...s,
          newDrawdownSeq: s.newDrawdownSeq + 1,
          drawdowns: {
            ...s.drawdowns,
            [idNew]: {
              id: idNew,
              batchIds: [...d.batchIds],
              principal: d.principal,
              stage: 'diajukan',
              disbursedOn: null,
              dueOn: null,
              settledOn: null,
              marginPaid: null,
            },
          },
          stamps: { ...s.stamps, [idNew]: { aju: d.at, by } },
        };
      }
      case 'pencairan.lanjut': {
        const cur = s.drawdowns[d.drawdownId];
        if (!cur) return s;
        const next: Drawdown =
          cur.stage === 'diajukan'
            ? { ...cur, stage: 'disetujui' }
            : { ...cur, stage: 'cair', disbursedOn: day, dueOn: addDays(day, FASILITAS.maxTenorDays) };
        const st = s.stamps[d.drawdownId] ?? {};
        return {
          ...s,
          drawdowns: { ...s.drawdowns, [d.drawdownId]: next },
          stamps: {
            ...s.stamps,
            [d.drawdownId]: cur.stage === 'diajukan' ? { ...st, ok: d.at } : { ...st, cair: d.at },
          },
        };
      }
      case 'bpjs.bayar':
        return {
          ...s,
          drawdowns: {
            ...s.drawdowns,
            [d.drawdownId]: {
              ...(drawdownById(s, d.drawdownId) as Drawdown),
              stage: 'lunas',
              settledOn: day,
              marginPaid: d.margin,
            },
          },
          lastPay: {
            drawdownId: d.drawdownId,
            at: d.at,
            claims: d.claims,
            principal: d.principal,
            margin: d.margin,
            forwarded: d.forwarded,
            days: d.days,
            basis: d.basis,
            by,
          },
        };
      case 'cicilan.lanjut': {
        const next = nextInstalmentStage(d.stage);
        if (!next) return s;
        const cur = s.apps[d.applicationId];
        const history = [...(cur?.history ?? []), { stage: next, at: d.at }];
        return {
          ...s,
          apps: { ...s.apps, [d.applicationId]: { stage: next, history, rejectReason: null, by } },
        };
      }
      case 'cicilan.tolak': {
        const cur = s.apps[d.applicationId];
        const history = [...(cur?.history ?? []), { stage: 'ditolak' as const, at: d.at }];
        return {
          ...s,
          apps: { ...s.apps, [d.applicationId]: { stage: 'ditolak', history, rejectReason: d.reason, by } },
        };
      }
    }
  },
  subscriptions: [
    on(klaimDomain, (s, ev) => {
      const d = ev.data;
      if (d.type !== 'klaim.verifikasi') return s;
      const bid = `p-${d.claimId}`.slice(0, 60);
      if (s.pool.some((b) => b.id === bid)) return s;
      const batch: ReceivableBatch = {
        id: bid,
        period: 'Okt 2026',
        kind: `${d.kind === 'rawat-inap' ? 'RI' : 'RJ'} · ${d.patient.name}`.slice(0, 60),
        files: 1,
        amount: d.amount,
        status: 'layak',
        note: `BA verifikasi (mock E-Klaim) · SEP ${d.sep}`,
        drawdownId: null,
      };
      return { ...s, pool: [batch, ...s.pool] };
    }),
    on(tagihanDomain, (s, ev) => {
      const d = ev.data;
      if (d.type !== 'tagihan.bayar' || d.method !== 'cicilan') return s;
      const appId = `kasir-${ev.seq}`;
      const app: InstalmentApplication = {
        id: appId,
        reference: /^PB-\d{4}-\d{4}$/.test(d.reference)
          ? d.reference
          : `PB-2610-${String(ev.seq % 10000).padStart(4, '0')}`,
        patient: d.patient,
        service: d.settlement.label,
        invoiceNo: d.invoiceNo,
        amount: d.amount,
        tenorMonths: d.tenor ?? 12,
        source: 'Kasir',
        applicant: `Diajukan di Kasir oleh ${ev.actor.name}`,
        note: 'Diproses di loket Kasir; BTN mencairkan pelunasan penuh ke rekening operasional RS.',
        stage: 'dicairkan',
        rejectReason: null,
        history: [
          { stage: 'diajukan', at: d.at },
          { stage: 'dicairkan', at: d.at },
        ],
        scenario: false,
      };
      return { ...s, newApps: [app, ...s.newApps] };
    }),
  ],
});

/** Pencairan efektif menurut id (toko, lalu fixture). */
function drawdownById(s: PembiayaanState, drawdownId: string): Drawdown | undefined {
  const base = PENCAIRAN.find((d) => d.id === drawdownId);
  return s.drawdowns[drawdownId] ?? (base ? { ...base, batchIds: [...base.batchIds] } : undefined);
}

// ---------------------------------------------------------------------------------------------------------------
// Jurnal dan penerapan ke papan Pembiayaan.
// ---------------------------------------------------------------------------------------------------------------

/** Jurnal pencairan: Dr Bank BTN operasional / Cr Utang pembiayaan piutang. */
export function disbursementJournal(d: Pick<Drawdown, 'id' | 'principal'>) {
  const v = BigInt(d.principal);
  return toAutoJurnal(
    jurnal(`Pencairan ${d.id} (advance klaim layak bayar)`, [dr(A.bankOps, v), cr(A.utangPembiayaan, v)]),
    { source: 'tpdi-btn', reference: `BTN · ${d.id}` },
  );
}

/**
 * Jurnal pembayaran BPJS atas klaim dasar: dana masuk penampungan, auto-debit pokok + margin, sisa diteruskan ke
 * rekening operasional (dua jurnal, masing-masing seimbang).
 */
export function bpjsRepaymentJournals(
  d: Pick<Drawdown, 'id'>,
  pay: { claims: bigint; principal: bigint; margin: bigint; forwarded: bigint },
  inpatient: boolean,
) {
  const ref = { source: 'klaim' as const, reference: `BPJS · klaim dasar ${d.id}` };
  return [
    toAutoJurnal(
      jurnal(`BPJS membayar klaim dasar ${d.id}`, [
        dr(A.bankKlaim, pay.claims),
        cr(inpatient ? A.piutangBpjsRi : A.piutangBpjsRj, pay.claims),
      ]),
      ref,
    ),
    toAutoJurnal(
      jurnal(`Auto-debit pelunasan ${d.id} + sisa diteruskan`, [
        dr(A.utangPembiayaan, pay.principal),
        dr(A.bebanMargin, pay.margin),
        dr(A.bankOps, pay.forwarded),
        cr(A.bankKlaim, pay.claims),
      ]),
      { ...ref, source: 'tpdi-btn' },
    ),
  ];
}

/** Papan Pembiayaan setelah keadaan toko diterapkan. */
export function applyPembiayaan(data: FinancingOverview, s: PembiayaanState): FinancingOverview {
  const pool = [...s.pool, ...data.pool];
  const drawdowns = drawdownsOf(data.drawdowns, s);
  const applications = [
    ...s.newApps,
    ...data.applications.map((a) => {
      const p = s.apps[a.id];
      return a.scenario || !p
        ? a
        : { ...a, stage: p.stage, history: [...a.history, ...p.history], rejectReason: p.rejectReason };
    }),
  ];
  return { ...data, pool, drawdowns, applications };
}

/** Pembayaran BPJS terhitung server untuk pencairan `drawdownId` (null bila tidak sedang cair). */
export function bpjsPaymentFor(data: FinancingOverview, drawdownId: string) {
  const d = data.drawdowns.find((x) => x.id === drawdownId);
  if (!d || d.stage !== 'cair') return null;
  const pay = simulateBpjsPayment(data.facility, d, data.pool, DEMO_TODAY);
  const inpatient = data.pool.some((b) => d.batchIds.includes(b.id) && /RI/.test(b.kind));
  return { drawdown: d, pay, inpatient };
}

/** Tanggal hari demo (untuk posisi fasilitas). */
export const FINANCING_TODAY = DEMO_TODAY;
