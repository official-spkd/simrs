import {
  formatJam,
  formatRupiah,
  isoDateJakarta,
  type PaymentChannel,
  type PaymentStatus,
  type PaymentTransaction,
  type ReconRow,
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
    if (e.event !== 'payment.paid' || !e.signatureValid || seen.has(e.id)) continue;
    seen.add(e.id);
    total += BigInt(e.amount);
  }
  return total;
}

export type WebhookOutcome = 'diproses' | 'diabaikan-duplikat' | 'ditolak-signature';

/** Keputusan penerima webhook untuk satu event baru terhadap event yang sudah tercatat. */
export function webhookOutcome(processed: readonly WebhookEvent[], incoming: WebhookEvent): WebhookOutcome {
  if (!incoming.signatureValid) return 'ditolak-signature';
  return processed.some((e) => e.id === incoming.id && !e.duplicate) ? 'diabaikan-duplikat' : 'diproses';
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
  if (ex.kind === 'nominal-beda') bank = { amount: bank.amount, note: `+ ${digits(-adj)} beban MDR` };
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
