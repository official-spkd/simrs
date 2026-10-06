import {
  CHARGE_CATEGORIES,
  type ChargeItem,
  formatDocumentNumber,
  type Invoice,
  type KasirBoard,
  type PayerSplit,
  PAYMENT_METHODS,
  type PaymentMethod,
  sumRupiah,
} from '@simrs/shared';
import { z } from 'zod';
import { defineDomain, on } from './demo/store/define';
import { INVOICE_ID } from './demo/fixtures/ids';
import {
  buildSplit,
  CBG,
  guarantorLabel,
  line as chargeLine,
  type SplitInput,
} from './demo/fixtures/keuangan';
import { patientById } from './demo/fixtures/pasien';
import { queueNo } from './demo/fixtures/rs';
import { DEMO_TODAY } from './demo/fixtures/waktu';
import { registrationDomain, type VisitRegisteredEvent } from './front-office-pendaftaran';
import { categorizeCharge, invoiceSettlement, invoiceTotal, patientDue } from './keuangan';
import { type BarisCapture, type EventCapture, line as captureLine } from './keuangan-charge';
import { autoJurnalSchema } from './keuangan-jurnal';

/**
 * U02/U03 · Domain toko demo `tagihan` (ADR-0085): Kasir + Charge capture (mode presentasi). Keadaan = penyesuaian di
 * atas fixture (item manual, final, pembayaran, tutup kunjungan, tutup shift, tindak lanjut event tertahan) plus
 * tagihan rawat jalan baru dari pendaftaran (langganan `pendaftaran` · `kunjungan.terdaftar`, charge `ADM-RJ`).
 *
 * Kontrak keluar (dilanggan Akuntansi, Klaim, Piutang, Pembayaran BTN, Pembiayaan BTN, Kas & bank):
 * - `tagihan.bayar`: pasien melunasi sisa tagihan (`amount`, `method`, `reference`) → jurnal kas/bank + pengakuan
 *   pendapatan dari `settlement`; QRIS/VA masuk rekonsiliasi 3 arah, tunai masuk laci, cicilan masuk Pembiayaan.
 * - `tagihan.tutup`: kunjungan ditutup tanpa bayar (tanggungan pasien Rp 0) → pengakuan pendapatan + klaim BPJS.
 * Semua nominal dihitung server dari tagihan versi server (tidak dari klien), rupiah utuh sebagai string digit.
 * Pelaku selalu `ev.actor` (sesi). Waktu `at` = jam demo server (ISO, hari presentasi).
 */

export const TAGIHAN_DOMAIN = 'tagihan';

const rupiah = z.string().regex(/^\d{1,15}$/);
const signed = z.string().regex(/^-?\d{1,15}$/);
const stamp = z.iso.datetime({ offset: true });
const invoiceId = z.string().regex(/^[a-z0-9-]{1,40}$/);
const eventId = z.string().regex(/^[a-z0-9-]{1,40}$/);
const reason = z.string().trim().min(15).max(300);

export const patientRefSchema = z.strictObject({
  id: z.string().min(1).max(60),
  name: z.string().min(1).max(120),
  rm: z.string().regex(/^\d{2}-\d{2}-\d{2}-\d{2}$/),
});
export type PatientRef = z.infer<typeof patientRefSchema>;

/** Pembagian penjamin saat tagihan lunas (dasar jurnal pengakuan pendapatan). */
export const settlementSchema = z.strictObject({
  scheme: z.enum(['bpjs', 'asuransi', 'umum']),
  payerLabel: z.string().min(1).max(80),
  setting: z.enum(['rawat-jalan', 'igd', 'rawat-inap']),
  hospitalTotal: rupiah,
  payerPays: rupiah,
  patientShare: rupiah,
  hospitalAbsorbs: signed,
  /** Pembayaran pasien yang sudah masuk sebelumnya (deposit/uang muka). */
  prepaid: rupiah,
  /** Kode CBG estimasi/final (BPJS) untuk klaim; null bila bukan BPJS. */
  cbg: z.string().min(1).max(20).nullable(),
});
export type Settlement = z.infer<typeof settlementSchema>;

export const tagihanEventSchema = z.discriminatedUnion('type', [
  z.strictObject({
    /** Item manual kasir (pengecualian charge capture): alasan wajib, tercatat. */
    type: z.literal('item.manual'),
    invoiceId,
    /** Pasien tagihan (untuk event charge capture `charge.manual_added`). */
    patient: z.strictObject({
      name: z.string().min(1).max(120),
      rm: z.string().regex(/^\d{2}-\d{2}-\d{2}-\d{2}$/),
      place: z.string().min(1).max(120),
      payer: z.string().min(1).max(80),
    }),
    name: z.string().trim().min(3).max(80),
    category: z.enum(CHARGE_CATEGORIES),
    qty: z.number().int().min(1).max(99),
    unitPrice: z.string().regex(/^\d{1,9}$/),
    reason,
    at: stamp,
  }),
  z.strictObject({ type: z.literal('tagihan.final'), invoiceId, at: stamp }),
  z.strictObject({
    /** Kontrak: pasien melunasi sisa tagihan. */
    type: z.literal('tagihan.bayar'),
    invoiceId,
    invoiceNo: z.string().regex(/^INV-\d{4}-\d{5}$/),
    patient: patientRefSchema,
    method: z.enum(PAYMENT_METHODS),
    amount: rupiah,
    /** Referensi kanal (QRIS/VA/approval EDC/ref transfer/no. pembiayaan/kuitansi tunai). */
    reference: z.string().min(1).max(80),
    /** Tenor cicilan BTN (bulan) bila `method` = cicilan. */
    tenor: z.number().int().min(1).max(60).nullable(),
    at: stamp,
    settlement: settlementSchema,
    /** Jurnal otomatis (pelunasan + pengakuan pendapatan), dibaca domain `akuntansi`. */
    jurnal: z.array(autoJurnalSchema).min(1).max(4),
  }),
  z.strictObject({
    /** Kontrak: kunjungan ditutup, tanggungan pasien Rp 0 (atau sudah tertutup deposit). */
    type: z.literal('tagihan.tutup'),
    invoiceId,
    invoiceNo: z.string().regex(/^INV-\d{4}-\d{5}$/),
    patient: patientRefSchema,
    at: stamp,
    settlement: settlementSchema,
    jurnal: z.array(autoJurnalSchema).min(1).max(4),
  }),
  z.strictObject({
    type: z.literal('shift.tutup'),
    at: stamp,
    settled: z.number().int().min(0).max(9999),
    cash: rupiah,
  }),
  z.strictObject({ type: z.literal('shift.buka'), at: stamp }),
  z.strictObject({
    /** Permintaan tindak lanjut event charge capture ke unit lain (tarif, kelas, koreksi baris klinis). */
    type: z.literal('capture.minta'),
    eventId,
    kind: z.enum(['tarif', 'kelas', 'koreksi']),
    reason: z.string().trim().max(300).nullable(),
    at: stamp,
  }),
  z.strictObject({
    /** Admisi menetapkan kelas rawat (jawaban ADT disimulasikan). */
    type: z.literal('capture.kelas'),
    eventId,
    at: stamp,
  }),
  z.strictObject({
    /** Event tertahan diselesaikan: baris terbentuk dari tarif/kelas/penjamin baru. */
    type: z.literal('capture.selesaikan'),
    eventId,
    at: stamp,
  }),
  z.strictObject({ type: z.literal('capture.batal-manual'), eventId, reason, at: stamp }),
]);
export type TagihanEvent = z.infer<typeof tagihanEventSchema>;
export type TagihanBayarEvent = Extract<TagihanEvent, { type: 'tagihan.bayar' }>;
export type TagihanTutupEvent = Extract<TagihanEvent, { type: 'tagihan.tutup' }>;

export interface StoredManualLine {
  id: string;
  name: string;
  category: ChargeItem['category'];
  qty: number;
  unitPrice: string;
  reason: string;
  by: string;
  at: string;
  /** Event charge capture (`charge.manual_added`) yang dibentuk baris ini. */
  captureId: string;
}

export interface StoredPayment {
  id: string;
  method: PaymentMethod;
  amount: string;
  at: string;
  reference: string;
  by: string;
}

export interface InvoiceOverlay {
  manual: StoredManualLine[];
  /** Baris dari event charge capture yang diselesaikan (tarif/kelas/penjamin baru). */
  captured: ChargeItem[];
  finalizedAt: string | null;
  finalizedBy: string | null;
  payments: StoredPayment[];
  closedAt: string | null;
  closedBy: string | null;
}

/** Tagihan rawat jalan baru dari pendaftaran (kunjungan.terdaftar). */
export interface RegisteredInvoice {
  invoiceId: string;
  visitId: string;
  seq: number;
  queue: number;
  patientId: string;
  rm: string;
  patientName: string;
  payer: VisitRegisteredEvent['payer'];
  poliName: string;
  room: string;
  doctorName: string;
  sepNo: string | null;
  diagnosis: string | null;
  jam: string;
  registeredBy: string;
  charge: { itemCode: string; label: string; amount: string };
}

export interface CaptureOverlay {
  requested: { kind: 'tarif' | 'kelas' | 'koreksi'; at: string; by: string; reason: string | null } | null;
  kelasAt: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  voided: { at: string; by: string; reason: string } | null;
}

/** Event charge capture baru (dari pendaftaran atau item manual kasir). */
export interface NewCapture extends EventCapture {
  invoiceId: string | null;
}

export interface ShiftState {
  closedAt: string | null;
  closedBy: string | null;
  settled: number;
  cash: string;
  reopenedAt: string | null;
}

export interface TagihanState {
  registered: readonly RegisteredInvoice[];
  invoices: Readonly<Record<string, InvoiceOverlay>>;
  capture: Readonly<Record<string, CaptureOverlay>>;
  newCaptures: readonly NewCapture[];
  shift: ShiftState;
  /** Jumlah pembayaran tersimpan (dasar nomor referensi). */
  paymentCount: number;
}

export const EMPTY_OVERLAY: InvoiceOverlay = {
  manual: [],
  captured: [],
  finalizedAt: null,
  finalizedBy: null,
  payments: [],
  closedAt: null,
  closedBy: null,
};

const EMPTY_CAPTURE: CaptureOverlay = {
  requested: null,
  kelasAt: null,
  resolvedAt: null,
  resolvedBy: null,
  voided: null,
};

const INITIAL_SHIFT: ShiftState = { closedAt: null, closedBy: null, settled: 0, cash: '0', reopenedAt: null };

/** Nomor tagihan rawat jalan baru: INV-2610-024xx (tidak bentrok dengan fixture 021xx–023xx). */
export const REGISTERED_INVOICE_BASE = 2400;
/** Nomor loket kasir pasien rawat jalan baru: K-021, K-022, … */
const REGISTERED_QUEUE_BASE = 20;

export const registeredInvoiceId = (visitId: string) => `inv-rj-${visitId}`;

/** Tagihan pasien skenario dimajukan lewat Simulasi, bukan toko. */
export const SCENARIO_INVOICE_IDS: ReadonlySet<string> = new Set([
  INVOICE_ID.suryo,
  INVOICE_ID.hartono,
  INVOICE_ID.ratna,
]);

function overlayOf(s: TagihanState, id: string): InvoiceOverlay {
  return s.invoices[id] ?? EMPTY_OVERLAY;
}

function patchInvoice(s: TagihanState, id: string, patch: Partial<InvoiceOverlay>): TagihanState {
  return { ...s, invoices: { ...s.invoices, [id]: { ...overlayOf(s, id), ...patch } } };
}

function patchCapture(s: TagihanState, id: string, patch: Partial<CaptureOverlay>): TagihanState {
  return { ...s, capture: { ...s.capture, [id]: { ...(s.capture[id] ?? EMPTY_CAPTURE), ...patch } } };
}

/** Penerapan kunjungan terdaftar (langganan `pendaftaran`). */
function applyVisit(s: TagihanState, v: VisitRegisteredEvent, at: string, by: string): TagihanState {
  const invoiceId = registeredInvoiceId(v.visitId);
  if (s.registered.some((r) => r.invoiceId === invoiceId)) return s;
  const n = s.registered.length + 1;
  const reg: RegisteredInvoice = {
    invoiceId,
    visitId: v.visitId,
    seq: REGISTERED_INVOICE_BASE + n,
    queue: REGISTERED_QUEUE_BASE + n,
    patientId: v.patientId,
    rm: v.rm,
    patientName: v.patientName,
    payer: v.payer,
    poliName: v.poliName,
    room: v.room,
    doctorName: v.doctorName,
    sepNo: v.sepNo,
    diagnosis: v.diagnosis,
    jam: v.jam,
    registeredBy: by,
    charge: v.charge,
  };
  const amount = BigInt(v.charge.amount);
  const capture: NewCapture = {
    id: `cc-rj-${v.visitId}`,
    at,
    source: 'pendaftaran',
    event: 'encounter.registered',
    description: `Kunjungan ${v.poliName} terdaftar · antrean ${v.queueNo}`,
    patient: {
      name: v.patientName,
      rm: v.rm,
      place: v.poliName,
      payer: v.payer === 'BPJS' ? 'BPJS' : v.payer,
    },
    status: 'tertagih',
    line: captureLine(v.charge.itemCode, v.charge.label, 1, amount),
    invoiceId,
  };
  return { ...s, registered: [...s.registered, reg], newCaptures: [...s.newCaptures, capture] };
}

export const tagihanDomain = defineDomain<TagihanState, TagihanEvent>(TAGIHAN_DOMAIN, {
  initial: () => ({
    registered: [],
    invoices: {},
    capture: {},
    newCaptures: [],
    shift: INITIAL_SHIFT,
    paymentCount: 0,
  }),
  eventSchema: tagihanEventSchema,
  screens: ['kasir', 'charge'],
  validate: (s, ev) => tagihanGate(s, ev),
  reduce: (s, ev) => {
    const d = ev.data;
    const err = tagihanGate(s, d);
    if (err) throw new Error(err);
    const by = ev.actor.name;
    switch (d.type) {
      case 'item.manual': {
        const o = overlayOf(s, d.invoiceId);
        const id = `ml-${ev.seq}`;
        const unit = BigInt(d.unitPrice);
        const captureId = `cc-ml-${ev.seq}`;
        const next = patchInvoice(s, d.invoiceId, {
          manual: [
            ...o.manual,
            {
              id,
              name: d.name,
              category: d.category,
              qty: d.qty,
              unitPrice: d.unitPrice,
              reason: d.reason,
              by,
              at: d.at,
              captureId,
            },
          ],
        });
        const capture: NewCapture = {
          id: captureId,
          at: d.at,
          source: 'kasir',
          event: 'charge.manual_added',
          description: 'Item manual kasir (alasan tercatat)',
          patient: d.patient,
          status: 'tertagih',
          line: captureLine('MNL', d.name, d.qty, unit),
          manual: { by, reason: d.reason },
          invoiceId: d.invoiceId,
        };
        return { ...next, newCaptures: [...next.newCaptures, capture] };
      }
      case 'tagihan.final':
        return patchInvoice(s, d.invoiceId, { finalizedAt: d.at, finalizedBy: by });
      case 'tagihan.bayar': {
        const o = overlayOf(s, d.invoiceId);
        const payment: StoredPayment = {
          id: `pay-${ev.seq}`,
          method: d.method,
          amount: d.amount,
          at: d.at,
          reference: d.reference,
          by,
        };
        return {
          ...patchInvoice(s, d.invoiceId, {
            payments: [...o.payments, payment],
            closedAt: d.at,
            closedBy: by,
          }),
          paymentCount: s.paymentCount + 1,
        };
      }
      case 'tagihan.tutup':
        return patchInvoice(s, d.invoiceId, { closedAt: d.at, closedBy: by });
      case 'shift.tutup':
        return {
          ...s,
          shift: { closedAt: d.at, closedBy: by, settled: d.settled, cash: d.cash, reopenedAt: null },
        };
      case 'shift.buka':
        return { ...s, shift: { ...INITIAL_SHIFT, reopenedAt: d.at } };
      case 'capture.minta':
        return patchCapture(s, d.eventId, {
          requested: { kind: d.kind, at: d.at, by, reason: d.reason },
        });
      case 'capture.kelas':
        return patchCapture(s, d.eventId, { kelasAt: d.at });
      case 'capture.selesaikan':
        return patchCapture(s, d.eventId, { resolvedAt: d.at, resolvedBy: by });
      case 'capture.batal-manual':
        return patchCapture(s, d.eventId, { voided: { at: d.at, by, reason: d.reason } });
    }
  },
  subscriptions: [
    on(registrationDomain, (s, ev) =>
      ev.data.type === 'kunjungan.terdaftar'
        ? applyVisit(s, ev.data, demoStampOf(ev.data.jam), ev.actor.name)
        : s,
    ),
  ],
});

/** Jam `HH.MM` hari demo → ISO WIB (kejadian pendaftaran membawa jam layar, bukan stempel lengkap). */
export function demoStampOf(jam: string): string {
  return `${DEMO_TODAY}T${jam.replace('.', ':')}:00+07:00`;
}

/** Gerbang murni domain (keadaan toko saja; gerbang yang butuh fixture/tagihan ada di Server Action). */
export function tagihanGate(s: TagihanState, ev: TagihanEvent): string | null {
  switch (ev.type) {
    case 'item.manual':
    case 'tagihan.final':
    case 'tagihan.bayar':
    case 'tagihan.tutup': {
      if (SCENARIO_INVOICE_IDS.has(ev.invoiceId)) {
        return 'Tagihan pasien simulasi dimajukan lewat tugas skenario, bukan aksi lokal kasir.';
      }
      const o = overlayOf(s, ev.invoiceId);
      if (o.closedAt) return 'Tagihan sudah lunas; tidak ada yang bisa diubah.';
      if ((ev.type === 'item.manual' || ev.type === 'tagihan.final') && o.finalizedAt) {
        return 'Tagihan sudah final dan terkunci; koreksi lewat unit asal.';
      }
      if ((ev.type === 'tagihan.bayar' || ev.type === 'tagihan.tutup') && s.shift.closedAt) {
        return 'Shift kasir sudah ditutup; buka shift baru untuk menerima pembayaran.';
      }
      return null;
    }
    case 'shift.tutup':
      return s.shift.closedAt ? 'Shift sudah ditutup.' : null;
    case 'shift.buka':
      return s.shift.closedAt ? null : 'Shift masih terbuka.';
    case 'capture.minta': {
      const c = s.capture[ev.eventId];
      return c?.requested?.kind === ev.kind ? 'Permintaan ini sudah dikirim.' : null;
    }
    case 'capture.kelas': {
      const c = s.capture[ev.eventId];
      if (c?.kelasAt) return 'Kelas rawat sudah ditetapkan.';
      return c?.requested?.kind === 'kelas' ? null : 'Minta admisi menetapkan kelas lebih dulu.';
    }
    case 'capture.selesaikan':
      return s.capture[ev.eventId]?.resolvedAt ? 'Event sudah tertagih.' : null;
    case 'capture.batal-manual':
      return s.capture[ev.eventId]?.voided ? 'Baris sudah dibatalkan.' : null;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Penerapan ke papan Kasir (fixture + skenario sudah dibentuk) dan monitor charge capture.
// ---------------------------------------------------------------------------------------------------------------

const RJ_PERIOD = 'Sen, 5 Okt 2026';

/** Pembagian penjamin awal kunjungan rawat jalan baru. */
function splitInputOf(r: RegisteredInvoice): SplitInput {
  if (r.payer === 'BPJS') {
    const label = guarantorLabel(r.patientId).replace('BPJS · ', '');
    return { scheme: 'bpjs', payerLabel: `BPJS ${label}`, inacbg: { ...CBG.rjKronis, estimate: true } };
  }
  if (r.payer === 'Asuransi') {
    return {
      scheme: 'asuransi',
      payerLabel: 'Asuransi swasta · plafon RJ Rp 500.000',
      insurerPays: 500_000n,
    };
  }
  return { scheme: 'umum', payerLabel: 'Umum (bayar sendiri)' };
}

/** Tagihan rawat jalan baru (status berjalan, siap difinalkan kasir; pasien selesai dilayani hari ini). */
export function registeredInvoice(r: RegisteredInvoice): Invoice {
  const p = patientById(r.patientId);
  const lines: ChargeItem[] = [
    chargeLine(
      `${r.invoiceId}-adm`,
      'administrasi',
      'Pendaftaran',
      r.jam,
      r.charge.label,
      1,
      BigInt(r.charge.amount),
    ),
  ];
  const split = buildSplit(invoiceTotal(lines), splitInputOf(r));
  const number = formatDocumentNumber('invoice', BigInt(r.seq), '2610');
  return {
    id: r.invoiceId,
    number,
    queueNo: queueNo('K', r.queue),
    scenario: null,
    patient: {
      id: r.patientId,
      rm: r.rm,
      name: r.patientName,
      sex: p?.jk ?? 'L',
      ageYears: p?.umur ?? 0,
      birthDate: p?.tanggalLahir ?? '1970-01-01',
      allergies: [...(p?.alergi ?? [])],
      guarantor: guarantorLabel(r.patientId),
    },
    encounter: {
      kind: 'rawat-jalan',
      label: `Rawat jalan ${r.poliName}`,
      location: r.room,
      period: RJ_PERIOD,
      sep: r.sepNo,
      dpjp: r.doctorName,
      discharged: true,
    },
    status: 'berjalan',
    lines,
    split,
    payments: [],
    patientDue: patientDue(split, []).toString(),
    finalizedAt: null,
    receiptNo: null,
    note: `Terdaftar ${r.jam} oleh ${r.registeredBy}`,
  };
}

function manualItem(m: StoredManualLine): ChargeItem {
  const unit = BigInt(m.unitPrice);
  return {
    id: m.id,
    name: m.name,
    category: m.category,
    source: 'Kasir (manual)',
    when: m.at.slice(11, 16).replace(':', '.'),
    qty: m.qty,
    unitPrice: m.unitPrice,
    amount: (unit * BigInt(m.qty)).toString(),
    manual: true,
    reason: m.reason,
  };
}

/**
 * Satu tagihan setelah penyesuaian toko: baris tambahan, final, pembayaran, lunas. `splitFor` = pembagian penjamin
 * dihitung ulang dari aturan asal (tagihan baru dari pendaftaran); tanpa itu dipakai `invoiceSettlement` (sama dengan
 * Server Action dan layar sebelum toko).
 */
export function applyInvoiceOverlay(
  inv: Invoice,
  o: InvoiceOverlay | undefined,
  splitFor?: (total: bigint) => PayerSplit,
): Invoice {
  if (!o || inv.scenario) return inv;
  const extra = [...o.captured, ...o.manual.map(manualItem)];
  const base = { ...inv, lines: [...inv.lines, ...extra] };
  const split =
    splitFor && extra.length ? splitFor(invoiceTotal(base.lines)) : invoiceSettlement(inv, extra).split;
  const payments = [
    ...inv.payments,
    ...o.payments.map((p) => ({
      id: p.id,
      kind: 'pelunasan' as const,
      method: p.method,
      amount: p.amount,
      at: p.at,
      reference: p.reference,
    })),
  ];
  const status: Invoice['status'] = o.closedAt ? 'lunas' : o.finalizedAt ? 'final' : inv.status;
  return {
    ...base,
    split,
    payments,
    status,
    patientDue: patientDue(
      split,
      payments.map((p) => BigInt(p.amount)),
    ).toString(),
    finalizedAt: inv.finalizedAt ?? o.finalizedAt,
    receiptNo: status === 'lunas' ? inv.number.replace('INV', 'KW') : inv.receiptNo,
    note: o.closedAt
      ? `Ditutup oleh ${o.closedBy ?? '—'}`
      : o.finalizedAt
        ? `Difinalkan oleh ${o.finalizedBy ?? '—'}`
        : inv.note,
  };
}

/** Baris tagihan dari event charge capture yang diselesaikan (sumber unit asal). */
function captureCharge(e: EventCapture, l: BarisCapture): ChargeItem {
  return {
    id: `cap-${e.id}`,
    name: l.name,
    category: categorizeCharge(l.name),
    source: `Charge capture · ${e.source.toUpperCase()}`,
    when: e.at.slice(11, 16).replace(':', '.'),
    qty: Math.max(1, l.qty),
    unitPrice: l.qty > 0 ? l.unitPrice.toString() : null,
    amount: l.amount.toString(),
    manual: false,
  };
}

/**
 * Papan Kasir = fixture + skenario (sudah dibentuk) + tagihan rawat jalan baru + penyesuaian toko. Baris dari event
 * charge capture yang diselesaikan masuk ke tagihan berjalan pasien yang sama (RM) bila ada.
 */
export function applyTagihan(
  board: KasirBoard,
  s: TagihanState,
  resolvedCaptures: ReadonlyArray<{ event: EventCapture; line: BarisCapture }> = [],
): KasirBoard {
  const added = s.registered.map(registeredInvoice);
  const splitRules = new Map(
    s.registered.map((r) => [r.invoiceId, (total: bigint) => buildSplit(total, splitInputOf(r))]),
  );
  const invoices = [...board.invoices, ...added].map((inv) => {
    const own = resolvedCaptures
      .filter((r) => r.event.patient.rm === inv.patient.rm && inv.status === 'berjalan' && !inv.scenario)
      .map((r) => captureCharge(r.event, r.line));
    const stored = s.invoices[inv.id];
    // Baris manual yang dibatalkan di Charge capture (baris pembalik) tidak lagi ditagihkan.
    const o = stored && {
      ...stored,
      manual: stored.manual.filter((m) => !s.capture[m.captureId]?.voided),
    };
    return applyInvoiceOverlay(
      inv,
      own.length ? { ...(o ?? EMPTY_OVERLAY), captured: [...(o?.captured ?? []), ...own] } : o,
      splitRules.get(inv.id),
    );
  });
  const rank = (i: Invoice) =>
    i.scenario && i.status !== 'lunas' ? -1 : ({ final: 0, berjalan: 1, lunas: 2 } as const)[i.status];
  invoices.sort((a, b) => rank(a) - rank(b) || a.number.localeCompare(b.number));
  return { ...board, invoices };
}

/** Event charge capture setelah tindak lanjut tersimpan (status, baris pembalik pembatalan manual). */
export function applyCaptures(
  fixture: readonly EventCapture[],
  s: TagihanState,
): Array<EventCapture & { requested: CaptureOverlay['requested']; kelasAt: string | null }> {
  const all: EventCapture[] = [...fixture, ...s.newCaptures];
  return all.flatMap((e) => {
    const c = s.capture[e.id] ?? EMPTY_CAPTURE;
    let cur: EventCapture = e;
    if (c.kelasAt && cur.hold?.kind === 'kelas-belum-ada') {
      cur = { ...cur, hold: { ...cur.hold, reason: `${cur.hold.reason} Kelas ditetapkan admisi.` } };
    }
    if (c.resolvedAt && cur.status === 'tertahan' && cur.hold) {
      const resolved = cur.hold.reprice ? repriceNet(cur.hold.reprice) : cur.hold.resolution;
      cur = { ...cur, status: 'tertagih', line: resolved, hold: undefined };
    }
    const out: Array<EventCapture & { requested: CaptureOverlay['requested']; kelasAt: string | null }> = [
      { ...cur, requested: c.requested, kelasAt: c.kelasAt },
    ];
    if (c.voided && cur.manual && cur.line && cur.status === 'tertagih') {
      out[0] = { ...cur, status: 'dibalik', requested: c.requested, kelasAt: c.kelasAt };
      out.push({
        id: `${cur.id}-batal`,
        at: c.voided.at,
        source: 'kasir',
        event: 'charge.manual_voided',
        description: `Pembatalan baris manual: ${c.voided.reason}`,
        patient: cur.patient,
        status: 'dibalik',
        line: { ...cur.line, qty: -cur.line.qty, amount: -cur.line.amount },
        manual: { by: c.voided.by, reason: c.voided.reason },
        reverses: cur.id,
        requested: null,
        kelasAt: null,
      });
    }
    return out;
  });
}

function repriceNet(pairs: ReadonlyArray<{ before: BarisCapture; after: BarisCapture }>): BarisCapture {
  const net = sumRupiah(pairs.map((p) => p.after.amount - p.before.amount));
  return captureLine(
    'REPRICE',
    `Selisih tarif penjamin baru (${pairs.length} baris dibalik dan dibuat ulang)`,
    1,
    net,
  );
}

/** Event fixture tertahan yang sudah diselesaikan di toko (baris masuk ke tagihan berjalan pasien itu). */
export function resolvedFixtureCaptures(
  fixture: readonly EventCapture[],
  s: TagihanState,
): Array<{ event: EventCapture; line: BarisCapture }> {
  return fixture.flatMap((e) => {
    if (!s.capture[e.id]?.resolvedAt || e.status !== 'tertahan' || !e.hold) return [];
    const l = e.hold.reprice ? repriceNet(e.hold.reprice) : e.hold.resolution;
    return l ? [{ event: e, line: l }] : [];
  });
}

/** Event tertahan per RM pasien (barrier finalisasi tagihan di Kasir). */
export function heldByRm(
  events: ReadonlyArray<Pick<EventCapture, 'status' | 'patient'>>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of events) {
    if (e.status === 'tertahan') out.set(e.patient.rm, (out.get(e.patient.rm) ?? 0) + 1);
  }
  return out;
}

/** Referensi kanal pembayaran (deterministik dari urutan pembayaran tersimpan). */
export function paymentReference(method: PaymentMethod, invoiceNo: string, n: number, extra = ''): string {
  const k = String(9000 + n).padStart(5, '0');
  switch (method) {
    case 'qris':
      return `QR-2610-${k}`;
    case 'va':
      return `VA BTN 8808 0127 ${invoiceNo.slice(4, 8)} ${invoiceNo.slice(-4)}`;
    case 'debit':
      return `EDC-LKT01 · approval ${String(480000 + n)}`;
    case 'tunai':
      return `Tunai · ${invoiceNo.replace('INV', 'KW')}`;
    case 'transfer':
      return `Transfer · ref ${extra || k}`;
    case 'cicilan':
      return `PB-2610-${String(100 + n).padStart(4, '0')}`;
  }
}
