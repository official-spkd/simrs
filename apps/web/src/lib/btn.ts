import {
  formatJam,
  formatRupiah,
  isoDateJakarta,
  type PaymentChannel,
  type PaymentOverview,
  type PaymentStatus,
  type PaymentTransaction,
  type ReconRow,
  type Refund,
  type RefundReason,
  type RefundStage,
  type TrailState,
  type WebhookEvent,
} from '@simrs/shared';
import type { ChipTone } from '@simrs/ui';
import { DEMO_TODAY } from './demo/fixtures/waktu';

/**
 * I05/U09 · Fungsi murni tampilan pembayaran digital TPDI × BTN (data dari `lib/server/data/btn.ts`): label,
 * idempotensi webhook, pelunasan simulasi, dan hitungan rekonsiliasi 3 arah. Uang selalu bigint.
 */

export const STATUS_LABEL: Record<PaymentStatus, string> = {
  draf: 'Draf',
  menunggu: 'Menunggu',
  lunas: 'Lunas',
  kedaluwarsa: 'Kedaluwarsa',
  gagal: 'Gagal',
  selisih: 'Selisih nominal',
  dikembalikan: 'Dikembalikan',
};

export const STATUS_TONE: Record<PaymentStatus, ChipTone> = {
  draf: 'neutral',
  menunggu: 'warning',
  lunas: 'success',
  kedaluwarsa: 'neutral',
  gagal: 'danger',
  selisih: 'danger',
  dikembalikan: 'info',
};

export const CHANNEL_LABEL: Record<PaymentChannel, string> = { VA: 'VA BTN', QRIS: 'QRIS', EDC: 'EDC BTN' };

/** Tanda status jejak (bukan hanya warna). */
export const TRAIL_MARK: Record<TrailState, string> = {
  selesai: '✓',
  menunggu: '○',
  gagal: '✕',
  peringatan: '!',
  info: 'i',
  lewati: '–',
};

/** Angka rupiah tanpa awalan untuk kolom tabel: "5.000.000". */
export function digits(amount: bigint): string {
  return formatRupiah(amount).replace(/^(−?)Rp /, '$1');
}

/** "Rp 48,62 jt" untuk KPI (pembulatan dua desimal, tanpa float). */
export function formatJuta(amount: bigint): string {
  const sign = amount < 0n ? '−' : '';
  const abs = amount < 0n ? -amount : amount;
  const hundredths = (abs + 5_000n) / 10_000n;
  const whole = hundredths / 100n;
  const frac = String(hundredths % 100n).padStart(2, '0');
  return `${sign}Rp ${digits(whole)},${frac} jt`;
}

/** Jam bila hari demo, selain itu tanggal + jam: "09.12", "1 Okt 16.02". */
export function formatWhen(iso: string, today: string = DEMO_TODAY): string {
  const date = isoDateJakarta(iso);
  if (date === today) return formatJam(iso);
  return `${formatTanggalPendek(date)} ${formatJam(iso)}`;
}

const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

/**
 * Tanda pasien skenario beserta tanggalnya: skenario Simulasi berjalan di garis waktunya sendiri (12–14 Okt),
 * berbeda dari hari layar, jadi tanggal ditampilkan. "skenario 12 Okt"; tanpa waktu → "skenario".
 */
export function scenarioTag(iso: string | null): string {
  return iso ? `skenario ${formatTanggalPendek(isoDateJakarta(iso))}` : 'skenario';
}

/** `2026-10-02` → "2 Okt"; dengan tahun → "2 Okt 2026". */
export function formatTanggalPendek(isoDate: string, withYear = false): string {
  const [y = '', m = '1', d = '1'] = isoDate.split('-');
  return `${Number(d)} ${BULAN[Number(m) - 1] ?? ''}${withYear ? ` ${y}` : ''}`;
}

/**
 * Idempotensi webhook (CLAUDE.md §4.6): hanya event `payment.paid` bertanda tangan sah yang dikreditkan, dan satu
 * event id hanya dihitung sekali walau TPDI mengirim ulang.
 */
export function creditedAmount(events: readonly WebhookEvent[]): bigint {
  const seen = new Set<string>();
  let total = 0n;
  for (const e of events) {
    if (e.event !== 'payment.paid' || !e.signatureValid || !webhookDelivered(e) || seen.has(e.id)) continue;
    seen.add(e.id);
    total += BigInt(e.amount);
  }
  return total;
}

/**
 * Webhook benar-benar sampai dan dibalas 2xx oleh SIM RS. Event yang timeout (TPDI masih me-retry) belum diterima,
 * jadi belum diverifikasi tanda tangannya dan belum dikreditkan.
 */
export function webhookDelivered(e: Pick<WebhookEvent, 'response'>): boolean {
  return /^2\d\d\b/.test(e.response);
}

export type WebhookOutcome = 'diproses' | 'diabaikan-duplikat' | 'ditolak-signature';

/** Keputusan penerima webhook untuk satu event baru terhadap event yang sudah tercatat. */
export function webhookOutcome(processed: readonly WebhookEvent[], incoming: WebhookEvent): WebhookOutcome {
  if (!incoming.signatureValid) return 'ditolak-signature';
  return processed.some((e) => e.id === incoming.id && !e.duplicate) ? 'diabaikan-duplikat' : 'diproses';
}

/** Tagihan yang boleh dilunasi lewat simulasi webhook: VA/QRIS menunggu, bukan pasien skenario (ikut mesin). */
export function canSimulatePay(
  tx: Pick<PaymentTransaction, 'scenario' | 'status' | 'channel' | 'paidAt'>,
): boolean {
  return !tx.scenario && tx.status === 'menunggu' && tx.channel !== 'EDC' && !tx.paidAt;
}

/** Pelunasan simulasi tagihan VA/QRIS yang masih menunggu (tombol "Simulasikan pembayaran"). */
export function markPaid(tx: PaymentTransaction, at: string, eventId: string): PaymentTransaction {
  if (tx.status !== 'menunggu' || tx.channel === 'EDC' || tx.paidAt) return tx;
  const created = tx.trail[0] ?? { label: 'Tagihan dibuat', at: tx.createdAt, note: '', state: 'selesai' };
  const paidNote =
    tx.channel === 'VA' ? `transfer ke VA ${tx.reference ?? ''}` : 'dipindai dari m-banking / e-wallet';
  const event: WebhookEvent = {
    id: eventId,
    event: 'payment.paid',
    receivedAt: at,
    amount: tx.amount,
    signatureValid: true,
    duplicate: false,
    response: '200 OK · 84 ms',
  };
  return {
    ...tx,
    status: 'lunas',
    paidAt: at,
    trail: [
      created,
      { label: 'Dibayar pasien', at, note: paidNote, state: 'selesai' },
      {
        label: 'Webhook diterima · signature valid',
        at,
        note: `HMAC-SHA256 cocok · ${eventId}`,
        state: 'selesai',
      },
      { label: 'Kasir lunas', at, note: 'kuitansi terbit · jurnal bank otomatis', state: 'selesai' },
      {
        label: `Masuk mutasi BTN ${tx.account}`,
        at,
        note: 'kredit langsung ke rekening operasional',
        state: 'selesai',
      },
    ],
    webhooks: [...tx.webhooks, event],
  };
}

// ---------------------------------------------------------------- rekonsiliasi 3 arah

export const RESOLUTION_NOTE_MIN = 10;

export const RECON_STATUS_LABEL: Record<ReconRow['status'], string> = {
  cocok: 'Cocok',
  'menunggu-settlement': 'Menunggu settlement',
  'menunggu-data': 'Menunggu data',
  'belum-dicocokkan': 'Belum dicocokkan',
  pengecualian: 'Pengecualian',
};

export interface Resolution {
  actionId: string;
  note: string;
  at: string;
  by: string;
}

/** Galat penyelesaian pengecualian (tindakan wajib dipilih, catatan wajib); null = sah. */
export function resolutionError(row: ReconRow, actionId: string, note: string): string | null {
  const ex = row.exception;
  if (!ex) return 'Baris ini bukan pengecualian.';
  if (ex.resolution) return 'Pengecualian ini sudah ditangani.';
  if (!ex.actions.some((a) => a.id === actionId)) return 'Pilih tindakan penyelesaian.';
  const n = note.trim().length;
  if (n < RESOLUTION_NOTE_MIN) {
    return `Catatan penyelesaian wajib, minimal ${RESOLUTION_NOTE_MIN} karakter (sekarang ${n}).`;
  }
  return null;
}

/** Baris setelah pengecualian ditangani: ketiga sumber dijelaskan, nilai kasir disesuaikan. */
export function resolveRow(row: ReconRow, res: Resolution): ReconRow {
  const ex = row.exception;
  if (!ex || ex.resolution || resolutionError(row, res.actionId, res.note)) return row;
  const adj = BigInt(ex.adjustment);
  let { kasir, bank } = row;
  if (ex.kind === 'webhook-gagal') kasir = { amount: row.tpdi.amount, note: 'dilunasi lewat rekonsiliasi' };
  if (ex.kind === 'nominal-beda') {
    bank = {
      amount: bank.amount,
      note:
        res.actionId === 'koreksi'
          ? `+ ${digits(-adj)} koreksi diajukan ke BTN`
          : `+ ${digits(-adj)} beban MDR`,
    };
  }
  if (ex.kind === 'hanya-di-bank') {
    kasir =
      res.actionId === 'padan'
        ? { amount: row.bank.amount, note: 'dipadankan ke tagihan' }
        : {
            amount: null,
            note: res.actionId === 'titip' ? 'dicatat sebagai titipan' : 'dikembalikan lewat refund',
          };
  }
  return {
    ...row,
    kasir,
    bank,
    status: 'cocok',
    note: 'ditangani',
    exception: { ...ex, resolution: { ...res, note: res.note.trim() } },
  };
}

/** Settlement batch EDC masuk mutasi BTN saat rekonsiliasi dijalankan. */
export function settleEdc(row: ReconRow): ReconRow {
  if (row.status !== 'menunggu-settlement') return row;
  return { ...row, bank: { amount: row.kasir.amount, note: 'settlement EDC' }, status: 'cocok' };
}

export interface ReconTotals {
  /** Dana masuk menurut mutasi BTN. */
  bankIn: bigint;
  /** Tercatat di kasir SIM RS. */
  recorded: bigint;
  /** Selisih yang belum dijelaskan (bankIn − recorded). */
  unexplained: bigint;
  exceptionsLeft: number;
}

/**
 * Saldo harian 3 arah. Pengecualian yang belum ditangani hanya ada di sisi bank; penyelesaiannya memindahkan
 * nilainya ke sisi tercatat. Settlement EDC yang belum masuk ada di sisi tercatat saja.
 */
export function reconTotals(
  base: bigint,
  rows: readonly ReconRow[],
  edcUnsettled: bigint,
  extraPaid: bigint = 0n,
): ReconTotals {
  let all = 0n;
  let resolved = 0n;
  let left = 0;
  for (const r of rows) {
    if (!r.exception) continue;
    const adj = BigInt(r.exception.adjustment);
    all += adj;
    if (r.exception.resolution) resolved += adj;
    else left++;
  }
  const edcPending = rows.some((r) => r.status === 'menunggu-settlement') ? edcUnsettled : 0n;
  const recorded = base + extraPaid + resolved;
  const bankIn = base + extraPaid + all - edcPending;
  return { bankIn, recorded, unexplained: bankIn - recorded, exceptionsLeft: left };
}

/**
 * Pengecualian rekonsiliasi yang ditangani ikut memperbarui transaksi asal (mockup Pembayaran: tab Transaksi
 * mencerminkan tab Rekonsiliasi): kasir lunas, webhook yang gagal diganti keterangan penyelesaiannya, selisih MDR
 * di langkah mutasi BTN dijelaskan, dan transfer tanpa referensi yang dipadankan tercatat di tagihan tujuannya.
 */
export function settleByResolution(tx: PaymentTransaction, row: ReconRow): PaymentTransaction {
  const ex = row.exception;
  const res = ex?.resolution;
  if (!ex || !res) return tx;
  const label = ex.actions.find((a) => a.id === res.actionId)?.label ?? 'ditangani';
  if (ex.kind === 'hanya-di-bank') {
    // Baris tanpa referensi: tagihan tujuan disebut di label tindakan "padankan".
    const inv = res.actionId === 'padan' ? /INV-\d{4}-\d{5}/.exec(label)?.[0] : null;
    if (!inv || inv !== tx.invoiceNo || tx.trail.some((s) => s.label === 'Dibayar lewat transfer manual')) {
      return tx;
    }
    return {
      ...tx,
      trail: [
        ...tx.trail,
        {
          label: 'Dibayar lewat transfer manual',
          at: res.at,
          note: `${formatRupiah(BigInt(row.bank.amount ?? '0'))} dipadankan saat rekonsiliasi · tagihan lunas`,
          state: 'info',
        },
      ],
    };
  }
  if (row.transactionId !== tx.id || tx.status === 'lunas') return tx;
  const resent = ex.kind === 'webhook-gagal' && res.actionId === 'ulang';
  return {
    ...tx,
    status: 'lunas',
    paidAt: tx.paidAt ?? res.at,
    webhooks: resent
      ? tx.webhooks.map((w) =>
          webhookDelivered(w) ? w : { ...w, response: '200 OK · dikirim ulang TPDI atas permintaan' },
        )
      : tx.webhooks,
    trail: tx.trail.map((s) => {
      if (s.label === 'Kasir lunas') {
        return { ...s, at: res.at, state: 'selesai', note: `diselesaikan lewat rekonsiliasi: ${label}` };
      }
      if (ex.kind === 'webhook-gagal' && s.state === 'peringatan' && s.label.startsWith('Webhook gagal')) {
        return {
          label: 'Webhook diterima · signature valid',
          at: res.at,
          state: 'selesai',
          note: resent
            ? 'dikirim ulang oleh TPDI atas permintaan'
            : 'dilewati: dilunasi dari laporan TPDI + mutasi BTN',
        };
      }
      if (ex.kind === 'nominal-beda' && s.state === 'peringatan' && s.label.startsWith('Masuk mutasi BTN')) {
        return {
          ...s,
          state: 'selesai',
          note: `${s.note} · ${res.actionId === 'koreksi' ? 'koreksi diajukan ke BTN' : 'dicatat sebagai beban MDR'}`,
        };
      }
      return s;
    }),
  };
}

/** Settlement batch EDC yang masuk mutasi BTN saat rekonsiliasi dijalankan menuntaskan langkah bank transaksinya. */
export function settleEdcTx(tx: PaymentTransaction, at: string | null): PaymentTransaction {
  if (!at || tx.channel !== 'EDC' || tx.status !== 'lunas') return tx;
  return {
    ...tx,
    trail: tx.trail.map((s) =>
      s.label.startsWith('Masuk mutasi BTN') && s.state === 'menunggu'
        ? { ...s, at, state: 'selesai', note: 'settlement batch EDC cocok saat rekonsiliasi' }
        : s,
    ),
  };
}

/**
 * Refund yang dananya sudah kembali ke pasien memperbarui transaksi asal: refund penuh mengubah status menjadi
 * dikembalikan; langkah "Refund … diajukan" diganti "Refund … selesai".
 */
export function applyRefund(
  tx: PaymentTransaction,
  refund: Pick<Refund, 'number' | 'transactionRef' | 'amount'>,
  doneAt: string | null,
): PaymentTransaction {
  if (!doneAt || !tx.externalRef || !refund.transactionRef.includes(tx.externalRef)) return tx;
  const label = `Refund ${refund.number} selesai`;
  if (tx.trail.some((s) => s.label === label)) return tx;
  const step = { label, at: doneAt, note: 'dana kembali ke rekening pasien', state: 'info' as const };
  const has = tx.trail.some((s) => s.label.startsWith(`Refund ${refund.number}`));
  return {
    ...tx,
    status: tx.status === 'lunas' && BigInt(refund.amount) === BigInt(tx.amount) ? 'dikembalikan' : tx.status,
    trail: has
      ? tx.trail.map((s) => (s.label.startsWith(`Refund ${refund.number}`) ? step : s))
      : [...tx.trail, step],
  };
}

/** Waktu ISO jatuh pada tanggal kalender WIB `day` (`YYYY-MM-DD`)? */
export function onDay(iso: string | null, day: string): boolean {
  return !!iso && isoDateJakarta(iso) === day;
}

/**
 * Tambahan penerimaan hari `day` di atas angka harian fixture: pelunasan simulasi di layar ini dan transaksi pasien
 * skenario yang lunas pada hari itu. Skenario berjalan di garis waktu Simulasi (12–14 Okt), jadi deposit yang lunas
 * di hari lain tidak ikut "hari ini".
 */
export function dayPaidExtra(
  txs: readonly PaymentTransaction[],
  localPaid: ReadonlySet<string>,
  day: string,
): bigint {
  let extra = 0n;
  for (const t of txs) {
    if ((localPaid.has(t.id) || t.scenario) && t.status === 'lunas' && onDay(t.paidAt, day)) {
      extra += BigInt(t.amount);
    }
  }
  return extra;
}

export interface PaymentKpis {
  recorded: bigint;
  success: number;
  successDetail: string;
  pending: number;
  exceptionsLeft: number;
  unexplained: bigint;
}

/**
 * KPI harian tanggal `date`: angka seluruh hari (fixture) + perubahan di layar ini (pelunasan simulasi `localPaid`,
 * transaksi pasien skenario yang terjadi pada tanggal itu). Pengecualian dan selisih dari `reconTotals`.
 */
export function paymentKpis(
  day: PaymentOverview['day'],
  txs: readonly PaymentTransaction[],
  localPaid: ReadonlySet<string>,
  totals: ReconTotals,
  date: string = DEMO_TODAY,
): PaymentKpis {
  let va = day.successful.va;
  let qris = day.successful.qris;
  let pending = day.pending;
  for (const t of txs) {
    const fresh = localPaid.has(t.id) || (t.scenario && t.status === 'lunas' && onDay(t.paidAt, date));
    if (fresh && t.channel === 'VA') va++;
    if (fresh && t.channel === 'QRIS') qris++;
    if (localPaid.has(t.id)) pending--;
    if (t.scenario && t.status === 'menunggu' && onDay(t.createdAt, date)) pending++;
  }
  return {
    recorded: totals.recorded,
    success: va + qris + day.successful.edc,
    successDetail: `VA ${va} · QRIS ${qris} · EDC ${day.successful.edc}`,
    pending: Math.max(0, pending),
    exceptionsLeft: totals.exceptionsLeft,
    unexplained: totals.unexplained,
  };
}

// ---------------------------------------------------------------- refund

export const REFUND_FLOW: readonly RefundStage[] = [
  'draf',
  'menunggu-supervisor',
  'menunggu-manajer',
  'diproses-btn',
  'dana-kembali',
];

export const REFUND_STAGE_LABEL: Record<RefundStage, string> = {
  draf: 'Draf',
  'menunggu-supervisor': 'Menunggu supervisor',
  'menunggu-manajer': 'Menunggu manajer keuangan',
  'diproses-btn': 'Diproses BTN',
  'dana-kembali': 'Dana kembali',
};

export const REFUND_STAGE_TONE: Record<RefundStage, ChipTone> = {
  draf: 'neutral',
  'menunggu-supervisor': 'warning',
  'menunggu-manajer': 'warning',
  'diproses-btn': 'info',
  'dana-kembali': 'success',
};

export const REFUND_REASON_LABEL: Record<RefundReason, string> = {
  'deposit-berlebih': 'Deposit berlebih',
  'layanan-dibatalkan': 'Layanan dibatalkan',
  'pembayaran-ganda': 'Pembayaran ganda',
  'batal-rawat-inap': 'Batal rawat inap',
  lainnya: 'Lainnya',
};

export const REFUND_NOTE_MIN = 15;

export interface RefundDraftErrors {
  amount?: string;
  reason?: string;
  note?: string;
}

/**
 * Validasi pengajuan refund: nominal 1..maksimum (kelebihan deposit; tanpa batas parsial = nominal transaksi asal),
 * alasan dipilih, keterangan ≥ 15 karakter.
 */
export function refundDraftErrors(
  refund: Pick<Refund, 'maxAmount' | 'amount'>,
  amount: bigint,
  reason: string,
  note: string,
): RefundDraftErrors {
  const e: RefundDraftErrors = {};
  const cap = BigInt(refund.maxAmount ?? refund.amount);
  if (amount <= 0n) e.amount = 'Isi nominal refund.';
  else if (amount > cap) {
    e.amount = refund.maxAmount
      ? `Melebihi kelebihan deposit ${formatRupiah(cap)}.`
      : `Melebihi nominal transaksi asal ${formatRupiah(cap)}.`;
  }
  if (!Object.hasOwn(REFUND_REASON_LABEL, reason)) e.reason = 'Pilih alasan refund.';
  const n = note.trim().length;
  if (n < REFUND_NOTE_MIN) e.note = `Keterangan wajib, minimal ${REFUND_NOTE_MIN} karakter (sekarang ${n}).`;
  return e;
}

export function nextRefundStage(stage: RefundStage): RefundStage | null {
  const i = REFUND_FLOW.indexOf(stage);
  return i < 0 || i >= REFUND_FLOW.length - 1 ? null : (REFUND_FLOW[i + 1] ?? null);
}

/** Isian pengajuan refund yang sudah diterima server (mode presentasi: disimpan di layar). */
export interface RefundSubmission {
  amount: string;
  reason: RefundReason;
  note: string;
}

/**
 * Refund efektif di layar: tahap lokal dan isian pengajuan (nominal, alasan, keterangan) menggantikan nilai fixture,
 * sehingga semua tahap berikutnya dan daftar memakai nominal yang benar-benar diajukan.
 */
export function refundView(r: Refund, stage?: RefundStage, sub?: RefundSubmission): Refund {
  return {
    ...r,
    stage: stage ?? r.stage,
    amount: sub?.amount ?? r.amount,
    reason: sub?.reason ?? r.reason,
    reasonNote: sub?.note ?? r.reasonNote,
  };
}

/** Pemeriksaan server untuk pengajuan refund: refund ada, masih draf, dan isian sah. null = sah. */
export function refundSubmitError(
  refund: Refund | undefined,
  amount: bigint,
  reason: string,
  note: string,
): string | null {
  if (!refund) return 'Refund tidak ditemukan.';
  if (refund.stage !== 'draf') return 'Refund ini sudah diajukan.';
  const e = refundDraftErrors(refund, amount, reason, note);
  return e.amount ?? e.reason ?? e.note ?? null;
}

/** Tahap yang bisa disetujui (tingkat 1, tingkat 2, konfirmasi dana BTN). */
const APPROVABLE: readonly RefundStage[] = ['menunggu-supervisor', 'menunggu-manajer', 'diproses-btn'];

/** Pemeriksaan server untuk persetujuan refund: tahap bisa disetujui dan tidak mundur dari tahap di server. */
export function refundApproveError(refund: Refund | undefined, stage: RefundStage): string | null {
  if (!refund) return 'Refund tidak ditemukan.';
  if (!APPROVABLE.includes(stage)) return 'Tahap refund ini tidak menunggu persetujuan.';
  if (REFUND_FLOW.indexOf(stage) < REFUND_FLOW.indexOf(refund.stage)) return 'Tahap refund ini sudah lewat.';
  return null;
}
