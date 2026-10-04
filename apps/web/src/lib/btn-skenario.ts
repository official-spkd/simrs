import {
  type FinancingFacility,
  type FinancingOverview,
  type InstalmentApplication,
  isoDateJakarta,
  type OrCase,
  type OrSchedule,
  type PaymentChannel,
  type PaymentOverview,
  type PaymentTrailStep,
  type PaymentTransaction,
  type ReconRow,
  type ScenarioClaim,
  type WebhookEvent,
} from '@simrs/shared';
import { formatTanggalPendek } from './btn';
import { advanceAmount, marginFor, repaymentSplit } from './btn-pembiayaan';
import {
  CICILAN,
  FASILITAS,
  HARIAN,
  JADWAL_OK_STATS,
  KAMAR_OK,
  KONEKSI,
  KONFIGURASI,
  PENCAIRAN,
  POOL_KLAIM,
  patientRef,
  REFUND,
  REKON_JADWAL,
  REKONSILIASI,
  TRANSAKSI,
} from './demo/fixtures/btn';
import { REKENING } from './demo/fixtures/rs';
import { DEMO_NOW, DEMO_TODAY } from './demo/fixtures/waktu';
import { simInstant } from './demo/engine/format';
import { taskKey } from './demo/engine/run';
import type { RunResult, TaskValue } from './demo/engine/types';

/**
 * Proyeksi pasien skenario "Elektif · TPDI × BTN" (Ny. Ratna Sari) ke layar pembayaran, pembiayaan, dan kamar
 * operasi. Murni: hanya membaca hasil replay mesin skenario (`RunResult`), jadi konsisten di semua layar dan tab.
 */

export const DEPOSIT_AMOUNT = 3_000_000n;
export const DEPOSIT_INVOICE = 'INV-DP-2610-0412';
export const DEPOSIT_TPDI_REF = 'TPDI-TX-2610-004512';
export const DEPOSIT_VA = '8808 0127 0005 2031';
export const DEPOSIT_QR = 'QR-2610-90412';
export const DEPOSIT_EVENT_ID = 'evt-2610-80412';
export const SELISIH_INVOICE = 'INV-2610-02240';
export const CICILAN_REF = 'PB-2610-0088';
export const CICILAN_AMOUNT = 6_400_000n;
export const KLAIM_AMOUNT = 7_140_000n;

/** Tugas skenario yang bisa dikerjakan dari tombol asli layar (hanya tugas giliran). */
export interface ScenarioHook {
  rev: number;
  stepIndex: number;
  stepId: string;
  /** Tugas giliran sekarang (paling banyak satu, sesuai aturan gerbang mesin). */
  enabled: string[];
}

function stepIdx(R: RunResult, stepId: string): number {
  const i = R.def.steps.findIndex((s) => s.id === stepId);
  if (i < 0) throw new Error(`Langkah ${stepId} tidak ada di skenario ${R.def.id}`);
  return i;
}

export function taskDone(R: RunResult, stepId: string, taskId: string): boolean {
  return R.done.has(taskKey(stepIdx(R, stepId), taskId));
}

export function taskValue(R: RunResult, stepId: string, taskId: string): TaskValue | undefined {
  return R.done.get(taskKey(stepIdx(R, stepId), taskId));
}

/** Waktu selesai tugas (ISO, jam skenario) atau null. */
export function taskAt(R: RunResult, stepId: string, taskId: string): string | null {
  const m = R.doneAt.get(taskKey(stepIdx(R, stepId), taskId));
  return m === undefined ? null : simInstant(R.def, m).toISOString();
}

function minutesOf(R: RunResult, stepId: string, taskId: string): number | null {
  return R.doneAt.get(taskKey(stepIdx(R, stepId), taskId)) ?? null;
}

const ratna = () => patientRef('ps-ratna');

function depositChannel(R: RunResult): PaymentChannel {
  return taskValue(R, 'deposit', 'kanal') === 'qris' ? 'QRIS' : 'VA';
}

const stepOf = (label: string, at: string | null, note: string, state: PaymentTrailStep['state']) => ({
  label,
  at,
  note,
  state,
});

/** Deposit naik kelas Rp 3.000.000 (muncul setelah admisi VIP; status mengikuti tugas langkah `deposit`). */
export function depositTransaction(R: RunResult): PaymentTransaction | null {
  if (!taskDone(R, 'admisi', 'sep') || !R.rec.vip) return null;
  const channel = depositChannel(R);
  const chosen = taskValue(R, 'deposit', 'kanal') !== undefined;
  const created = taskAt(R, 'deposit', 'buat');
  const paid = taskAt(R, 'deposit', 'bayar');
  const hooked = taskAt(R, 'deposit', 'webhook');
  const dupe = taskAt(R, 'deposit', 'dupe');
  const va = channel === 'VA';
  const op = REKENING.operasional;
  const trail: PaymentTrailStep[] = [];
  if (!created) {
    trail.push(
      stepOf(
        'Tagihan belum dibuat',
        null,
        chosen ? `kanal ${va ? 'VA BTN' : 'QRIS'} dipilih` : 'pilih kanal VA atau QRIS',
        'menunggu',
      ),
    );
  } else {
    trail.push(
      stepOf(
        'Tagihan dibuat',
        created,
        va
          ? `VA BTN ${DEPOSIT_VA} via API TPDI · dikirim ke WhatsApp dan aplikasi pasien`
          : 'QR dinamis via API TPDI · acquirer BTN',
        'selesai',
      ),
      paid
        ? stepOf('Dibayar pasien', paid, 'dari m-banking', 'selesai')
        : stepOf('Menunggu pembayaran', null, va ? 'VA berlaku 24 jam' : 'QR berlaku 10 menit', 'menunggu'),
      paid
        ? stepOf(
            `Kredit BTN ${op}`,
            paid,
            'dana langsung ke rekening operasional RS, tidak transit di TPDI',
            'selesai',
          )
        : stepOf(`Masuk mutasi BTN ${op}`, null, '', 'menunggu'),
      hooked
        ? stepOf(
            'Webhook diterima · signature valid',
            hooked,
            `HMAC-SHA256 cocok · Idempotency-Key ${DEPOSIT_TPDI_REF}`,
            'selesai',
          )
        : stepOf('Webhook diterima', null, paid ? 'menunggu notifikasi TPDI' : '', 'menunggu'),
    );
    if (dupe) {
      trail.push(
        stepOf(
          'Callback ganda diabaikan (idempoten)',
          dupe,
          'event id sama, dibalas 200 OK · saldo deposit tetap Rp 3.000.000',
          'info',
        ),
      );
    }
    trail.push(
      hooked
        ? stepOf('Kasir lunas', hooked, 'deposit tercatat otomatis · kuitansi terbit', 'selesai')
        : stepOf('Kasir lunas', null, '', 'menunggu'),
    );
  }
  const webhooks: WebhookEvent[] = [];
  const event = (receivedAt: string, duplicate: boolean): WebhookEvent => ({
    id: DEPOSIT_EVENT_ID,
    event: 'payment.paid',
    receivedAt,
    amount: DEPOSIT_AMOUNT.toString(),
    signatureValid: true,
    duplicate,
    response: duplicate ? '200 OK · diabaikan (idempoten)' : '200 OK · 84 ms',
  });
  if (hooked) webhooks.push(event(hooked, false));
  if (dupe) webhooks.push(event(dupe, true));
  const expiresAt = created
    ? new Date(Date.parse(created) + (va ? 24 * 60 : 10) * 60_000).toISOString()
    : null;
  return {
    id: 'skenario-deposit',
    invoiceNo: DEPOSIT_INVOICE,
    patient: ratna(),
    channel,
    amount: DEPOSIT_AMOUNT.toString(),
    status: !created ? 'draf' : hooked ? 'lunas' : 'menunggu',
    externalRef: created ? DEPOSIT_TPDI_REF : null,
    reference: created ? (va ? DEPOSIT_VA : DEPOSIT_QR) : null,
    purpose: 'Deposit naik kelas VIP · bedah elektif',
    createdAt: created,
    expiresAt,
    paidAt: hooked ? paid : null,
    account: op,
    trail,
    webhooks,
    openInCashier: false,
    scenario: true,
  };
}

/**
 * Baris rekonsiliasi pasien skenario: deposit (setelah webhook) dan pelunasan sisa (pencairan cicilan BTN atau
 * QRIS). Data TPDI dan mutasi BTN baru ada setelah `rekonsiliasi.tarik`; status cocok setelah `cocok`.
 */
export function scenarioReconRows(R: RunResult): ReconRow[] {
  const pulled = taskDone(R, 'rekonsiliasi', 'tarik');
  const matched = taskDone(R, 'rekonsiliasi', 'cocok');
  const posted = taskDone(R, 'rekonsiliasi', 'jurnal');
  const status: ReconRow['status'] = matched ? 'cocok' : pulled ? 'belum-dicocokkan' : 'menunggu-data';
  const note = posted
    ? 'jurnal terposting'
    : matched
      ? 'cocok di tiga sumber'
      : pulled
        ? ''
        : 'menunggu tarik data';
  const notPulled = { amount: null, note: 'belum ditarik' };
  const rows: ReconRow[] = [];
  const row = (id: string, source: string, amount: bigint, tpdiDirect: boolean, tpdiNote = ''): ReconRow => ({
    id,
    label: ratna().name,
    source,
    transactionId: id === 'skenario-deposit' ? 'skenario-deposit' : null,
    kasir: { amount: amount.toString(), note: '' },
    tpdi: tpdiDirect
      ? { amount: null, note: 'langsung BTN, bukan kanal TPDI' }
      : pulled
        ? { amount: amount.toString(), note: tpdiNote }
        : notPulled,
    bank: pulled ? { amount: amount.toString(), note: '' } : notPulled,
    status,
    note,
    exception: null,
    scenario: true,
  });
  // Garis waktu skenario (12–14 Okt) berbeda dari hari layar: sumber diberi tanggal transaksinya.
  const dated = (source: string, stepId: string, taskId: string) => {
    const at = taskAt(R, stepId, taskId);
    return at ? `${source} · ${formatTanggalPendek(isoDateJakarta(at))}` : source;
  };
  if (taskDone(R, 'deposit', 'webhook')) {
    const ch = depositChannel(R) === 'VA' ? 'VA BTN' : 'QRIS';
    const dupe = taskDone(R, 'deposit', 'dupe') ? '2 callback' : '';
    const source = dated(`${ch} · ${DEPOSIT_INVOICE}`, 'deposit', 'webhook');
    rows.push(row('skenario-deposit', source, DEPOSIT_AMOUNT, false, dupe));
  }
  if (taskDone(R, 'kasir', 'cair')) {
    const source = dated(`Pencairan cicilan BTN · ${CICILAN_REF}`, 'kasir', 'cair');
    rows.push(row('skenario-cicilan', source, CICILAN_AMOUNT, true));
  }
  if (taskDone(R, 'kasir', 'qrisbayar')) {
    const source = dated(`QRIS · ${SELISIH_INVOICE}`, 'kasir', 'qrisbayar');
    rows.push(row('skenario-qris', source, CICILAN_AMOUNT, false));
  }
  return rows;
}

/** Klaim Ny. Ratna di pool pembiayaan piutang (setelah klaim layak bayar). */
export function scenarioClaim(R: RunResult, facility: FinancingFacility): ScenarioClaim | null {
  if (!taskDone(R, 'klaim', 'layak')) return null;
  const decision = taskValue(R, 'pembiayaan', 'ajukan');
  const cair = taskDone(R, 'pembiayaan', 'cair');
  const paid = taskDone(R, 'pembiayaan', 'bpjs');
  const advance = advanceAmount(KLAIM_AMOUNT, facility.advanceRatePercent);
  const stage: ScenarioClaim['stage'] = paid
    ? 'dibayar-bpjs'
    : cair
      ? 'dicairkan'
      : decision === 'ya'
        ? 'diajukan'
        : taskDone(R, 'pembiayaan', 'pool')
          ? 'di-pool'
          : 'layak';
  let repayment: ScenarioClaim['repayment'] = null;
  if (paid) {
    if (cair) {
      const from = minutesOf(R, 'pembiayaan', 'cair') ?? 0;
      const to = minutesOf(R, 'pembiayaan', 'bpjs') ?? from;
      const days = Math.floor((to - from) / 1440);
      const margin = marginFor(advance, facility.marginBps, days);
      const split = repaymentSplit(KLAIM_AMOUNT, advance, margin);
      repayment = {
        bpjsPaid: KLAIM_AMOUNT.toString(),
        principal: advance.toString(),
        margin: margin.toString(),
        days,
        forwarded: split.forwarded.toString(),
      };
    } else {
      repayment = {
        bpjsPaid: KLAIM_AMOUNT.toString(),
        principal: '0',
        margin: '0',
        days: 0,
        forwarded: KLAIM_AMOUNT.toString(),
      };
    }
  }
  return {
    patient: ratna(),
    sep: R.rec.sep || '0301R0011026V005377',
    amount: KLAIM_AMOUNT.toString(),
    stage,
    decision: decision === 'ya' || decision === 'tidak' ? decision : null,
    advance: advance.toString(),
    repayment,
  };
}

/** Cicilan BTN Ny. Ratna (tahap mengikuti `kasir.ajukan` → `setuju` → `cair`). */
export function scenarioInstalment(R: RunResult): InstalmentApplication | null {
  const ajukan = taskAt(R, 'kasir', 'ajukan');
  if (!ajukan) return null;
  const setuju = taskAt(R, 'kasir', 'setuju');
  const cair = taskAt(R, 'kasir', 'cair');
  const plus = (iso: string, min: number) => new Date(Date.parse(iso) + min * 60_000).toISOString();
  const history: InstalmentApplication['history'] = [
    { stage: 'diajukan', at: ajukan },
    { stage: 'verifikasi', at: plus(ajukan, 1) },
  ];
  if (setuju) history.push({ stage: 'disetujui', at: setuju }, { stage: 'akad', at: setuju });
  if (cair) history.push({ stage: 'dicairkan', at: cair });
  return {
    id: 'skenario-cicilan',
    reference: CICILAN_REF,
    patient: ratna(),
    service: 'Selisih naik kelas VIP · bedah elektif',
    invoiceNo: SELISIH_INVOICE,
    amount: CICILAN_AMOUNT.toString(),
    tenorMonths: Number(R.rec.tenor ?? '6') || 6,
    source: 'Kasir',
    applicant: 'Pemohon: pasien sendiri',
    note: 'Selisih Rp 9.400.000 − deposit Rp 3.000.000 via TPDI × BTN; sisa dibiayai BTN, RS menerima pelunasan penuh.',
    stage: cair ? 'dicairkan' : setuju ? 'akad' : 'verifikasi',
    rejectReason: null,
    history,
    scenario: true,
  };
}

/** Langkah `stepId` sudah dimulai (aktif atau sudah lewat)? */
function stepReached(R: RunResult, stepId: string): boolean {
  return R.finished || R.step >= stepIdx(R, stepId);
}

/** Kasus terjadwal tanpa fase terkonfirmasi (pasien skenario belum sampai langkah `operasi`). */
function scheduledOrCase(base: OrCase): OrCase {
  return {
    ...base,
    status: 'terjadwal',
    statusNote: 'menunggu langkah operasi Simulasi',
    checklist: base.checklist.map((p) => ({
      ...p,
      items: p.items.map((i) => ({ ...i, checked: false })),
      confirmedAt: null,
      confirmedBy: null,
    })),
    counts: base.counts.map((c) => ({ ...c, final: null })),
    incisionAt: null,
    scenarioDate: null,
  };
}

/**
 * Kasus OK Ny. Ratna mengikuti langkah `operasi`: sebelum langkah dimulai = terjadwal tanpa fase terkonfirmasi;
 * langkah aktif = dasar (sign in dikonfirmasi saat langkah mulai, time out berjalan); `tilik` = ketiga fase lengkap;
 * `op` = operasi selesai; `pulih` = kembali ke kamar. Jam mengikuti garis waktu Simulasi (`scenarioDate`).
 */
export function scenarioOrCase(R: RunResult, base: OrCase): OrCase {
  if (!stepReached(R, 'operasi')) return scheduledOrCase(base);
  const startMin = R.stepStart[stepIdx(R, 'operasi')] ?? R.clock;
  const started = simInstant(R.def, startMin).toISOString();
  const scenarioDate = isoDateJakarta(started);
  const tilik = taskAt(R, 'operasi', 'tilik');
  if (!tilik) {
    return {
      ...base,
      scenarioDate,
      checklist: base.checklist.map((p) => (p.confirmedAt ? { ...p, confirmedAt: started } : p)),
    };
  }
  const op = taskAt(R, 'operasi', 'op');
  const pulih = taskDone(R, 'operasi', 'pulih');
  return {
    ...base,
    scenarioDate,
    status: op ? 'selesai' : 'berjalan',
    statusNote: op
      ? pulih
        ? 'selesai · kembali ke kamar rawat'
        : 'selesai · ruang pulih'
      : 'operasi berjalan',
    // Mesin skenario mencatat ketiga fase sebagai satu tugas: semua memakai jam skenario yang sama.
    checklist: base.checklist.map((p) => ({
      ...p,
      items: p.items.map((i) => ({ ...i, checked: true })),
      confirmedAt: tilik,
      confirmedBy: base.nurses.circulating,
    })),
    counts: base.counts.map((c) => ({ ...c, final: c.initial })),
    incisionAt: tilik,
  };
}

// ---------------------------------------------------------------- data layar (fixture + proyeksi)

/** Data layar Pembayaran digital (belum divalidasi; modul data server mem-`parse` dengan kontrak). */
export function demoPaymentOverview(R: RunResult): PaymentOverview {
  const deposit = depositTransaction(R);
  return {
    asOf: DEMO_NOW,
    connection: { ...KONEKSI },
    day: { ...HARIAN, successful: { ...HARIAN.successful } },
    transactions: deposit ? [deposit, ...TRANSAKSI] : [...TRANSAKSI],
    recon: { ...REKON_JADWAL, rows: [...scenarioReconRows(R), ...REKONSILIASI] },
    refunds: [...REFUND],
    config: KONFIGURASI,
  };
}

export function demoFinancingOverview(R: RunResult): FinancingOverview {
  const instalment = scenarioInstalment(R);
  return {
    asOf: DEMO_NOW,
    facility: FASILITAS,
    pool: [...POOL_KLAIM],
    drawdowns: PENCAIRAN.map((d) => ({ ...d, batchIds: [...d.batchIds] })),
    scenarioClaim: scenarioClaim(R, FASILITAS),
    applications: instalment ? [instalment, ...CICILAN] : [...CICILAN],
    instalmentMarginPercent: 11,
  };
}

export function demoOrSchedule(R: RunResult): OrSchedule {
  return {
    date: DEMO_TODAY,
    now: DEMO_NOW,
    dayStartMin: 7 * 60,
    dayEndMin: 16 * 60,
    stats: { ...JADWAL_OK_STATS },
    rooms: KAMAR_OK.map((room) => ({
      ...room,
      cases: room.cases.map((c) => (c.scenario ? scenarioOrCase(R, c) : c)),
    })),
  };
}
