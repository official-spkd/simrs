import { formatRupiah, paymentTransactionSchema, reconRowSchema, refundSchema } from '@simrs/shared';
import { describe, expect, it } from 'vitest';
import {
  creditedAmount,
  formatJuta,
  formatWhen,
  markPaid,
  nextRefundStage,
  paymentKpis,
  reconTotals,
  refundDraftErrors,
  resolutionError,
  resolveRow,
  settleByResolution,
  settleEdc,
  webhookOutcome,
} from './btn';
import { HARIAN, KONFIGURASI, REFUND, REKONSILIASI, TRANSAKSI } from './demo/fixtures/btn';
import { REKENING } from './demo/fixtures/rs';

const row = (id: string) => {
  const r = REKONSILIASI.find((x) => x.id === id);
  if (!r) throw new Error(id);
  return r;
};
const tx = (id: string) => {
  const t = TRANSAKSI.find((x) => x.id === id);
  if (!t) throw new Error(id);
  return t;
};
const base = BigInt(HARIAN.recorded);
const edc = BigInt(HARIAN.edcUnsettled);
const res = (actionId: string, note = 'Dicek terhadap laporan TPDI dan mutasi BTN') => ({
  actionId,
  note,
  at: '2026-10-05T10:50:00+07:00',
  by: 'Yulia Permatasari, S.E., Ak.',
});

describe('fixture pembayaran digital', () => {
  it('lolos skema ketat; dana selalu ke rekening operasional RS di BTN; secret tersamar', () => {
    for (const t of TRANSAKSI) expect(() => paymentTransactionSchema.parse(t)).not.toThrow();
    for (const r of REKONSILIASI) expect(() => reconRowSchema.parse(r)).not.toThrow();
    for (const r of REFUND) expect(() => refundSchema.parse(r)).not.toThrow();
    expect(TRANSAKSI.every((t) => t.account === REKENING.operasional)).toBe(true);
    expect(KONFIGURASI.webhook.secretMasked).toMatch(/^whsec_••••[0-9a-f]{4}$/);
    expect(new Set(TRANSAKSI.map((t) => t.status))).toEqual(
      new Set(['menunggu', 'lunas', 'kedaluwarsa', 'gagal', 'dikembalikan', 'selisih']),
    );
  });
});

describe('idempotensi webhook', () => {
  it('callback ganda dengan event id sama tidak menambah saldo', () => {
    const t2 = tx('t2');
    expect(t2.webhooks).toHaveLength(2);
    expect(creditedAmount(t2.webhooks)).toBe(5_000_000n);
    const first = t2.webhooks[0];
    const second = t2.webhooks[1];
    if (!first || !second) throw new Error('webhook');
    expect(webhookOutcome([first], second)).toBe('diabaikan-duplikat');
    expect(webhookOutcome([], first)).toBe('diproses');
    expect(webhookOutcome([], { ...first, signatureValid: false })).toBe('ditolak-signature');
    expect(creditedAmount([{ ...first, signatureValid: false }])).toBe(0n);
  });

  it('pelunasan simulasi menambah satu event paid dan melunasi tagihan menunggu', () => {
    const paid = markPaid(tx('t1'), '2026-10-05T10:46:00+07:00', 'evt-uji');
    expect(paid.status).toBe('lunas');
    expect(creditedAmount(paid.webhooks)).toBe(250_400n);
    expect(paid.trail.every((s) => s.state === 'selesai')).toBe(true);
    expect(() => paymentTransactionSchema.parse(paid)).not.toThrow();
    expect(markPaid(tx('t3'), '2026-10-05T10:46:00+07:00', 'evt-uji')).toBe(tx('t3'));
  });
});

describe('rekonsiliasi 3 arah', () => {
  it('awal: tiga pengecualian, selisih belum dijelaskan −Rp 16.500 (EDC belum settlement)', () => {
    const t = reconTotals(base, REKONSILIASI, edc);
    expect(t.exceptionsLeft).toBe(3);
    expect(t.recorded).toBe(48_620_000n);
    expect(t.bankIn).toBe(48_603_500n);
    expect(formatRupiah(t.unexplained)).toBe('−Rp 16.500');
  });

  it('penyelesaian wajib memilih tindakan dan menulis catatan minimal 10 karakter', () => {
    expect(resolutionError(row('x1'), '', 'catatan yang cukup panjang')).toBe('Pilih tindakan penyelesaian.');
    expect(resolutionError(row('x1'), 'lunas', 'singkat')).toMatch(/minimal 10 karakter \(sekarang 7\)/);
    expect(resolutionError(row('x1'), 'lunas', '          ')).toMatch(/sekarang 0/);
    expect(resolutionError(row('r1'), 'lunas', 'catatan yang cukup panjang')).toBe(
      'Baris ini bukan pengecualian.',
    );
    expect(resolutionError(row('x1'), 'lunas', 'Webhook gagal, TPDI + BTN cocok')).toBeNull();
    expect(resolveRow(row('x1'), res('lunas', 'pendek'))).toBe(row('x1'));
  });

  it('semua pengecualian ditangani + settlement EDC masuk → selisih Rp 0', () => {
    const rows = REKONSILIASI.map((r) => {
      if (r.id === 'x1') return resolveRow(r, res('lunas'));
      if (r.id === 'x2') return resolveRow(r, res('mdr'));
      if (r.id === 'x3') return resolveRow(r, res('padan'));
      return settleEdc(r);
    });
    const t = reconTotals(base, rows, edc);
    expect(t.exceptionsLeft).toBe(0);
    expect(t.unexplained).toBe(0n);
    expect(t.recorded).toBe(48_620_000n + 640_000n - 14_000n + 142_500n);
    expect(rows.every((r) => r.status === 'cocok')).toBe(true);
    expect(rows.find((r) => r.id === 'x1')?.kasir.amount).toBe('640000');
    expect(rows.find((r) => r.id === 'x2')?.bank.note).toBe('+ 14.000 beban MDR');
    for (const r of rows) expect(() => reconRowSchema.parse(r)).not.toThrow();
  });

  it('transaksi skenario yang lunas menambah dua sisi sama besar (tidak menimbulkan selisih)', () => {
    const t = reconTotals(base, REKONSILIASI, edc, 3_000_000n);
    expect(t.unexplained).toBe(-16_500n);
    expect(t.recorded).toBe(51_620_000n);
  });
});

describe('format', () => {
  it('juta dan waktu', () => {
    expect(formatJuta(48_620_000n)).toBe('Rp 48,62 jt');
    expect(formatJuta(49_388_500n)).toBe('Rp 49,39 jt');
    expect(formatWhen('2026-10-05T09:12:00+07:00')).toBe('09.12');
    expect(formatWhen('2026-10-01T16:02:00+07:00')).toBe('1 Okt 16.02');
    expect(formatWhen('2026-10-12T00:52:00.000Z')).toBe('12 Okt 07.52');
  });
});

describe('dampak penyelesaian ke transaksi dan KPI', () => {
  it('webhook gagal / selisih nominal → lunas di kasir hanya setelah pengecualian ditangani', () => {
    expect(settleByResolution(tx('t4'), row('x1'))).toBe(tx('t4'));
    const t4 = settleByResolution(tx('t4'), resolveRow(row('x1'), res('lunas')));
    expect(t4.status).toBe('lunas');
    expect(t4.trail.find((s) => s.label === 'Kasir lunas')?.state).toBe('selesai');
    const t10 = settleByResolution(tx('t10'), resolveRow(row('x2'), res('mdr')));
    expect(t10.status).toBe('lunas');
    expect(() => paymentTransactionSchema.parse(t10)).not.toThrow();
  });

  it('KPI: pelunasan simulasi memindahkan satu tagihan dari menunggu ke berhasil', () => {
    const totals = reconTotals(base, REKONSILIASI, edc, 250_400n);
    const paid = TRANSAKSI.map((t) => (t.id === 't1' ? markPaid(t, '2026-10-05T10:46:00+07:00', 'e') : t));
    const k = paymentKpis(HARIAN, paid, new Set(['t1']), totals);
    expect(k).toMatchObject({ success: 188, pending: 11, exceptionsLeft: 3 });
    expect(k.successDetail).toBe('VA 64 · QRIS 99 · EDC 25');
    expect(paymentKpis(HARIAN, TRANSAKSI, new Set(), reconTotals(base, REKONSILIASI, edc)).success).toBe(187);
  });
});

describe('refund berjenjang', () => {
  it('pengajuan wajib nominal ≤ kelebihan deposit, alasan, dan keterangan ≥ 15 karakter', () => {
    const draft = REFUND.find((r) => r.stage === 'draf');
    if (!draft) throw new Error('draf');
    expect(refundDraftErrors(draft, 0n, '', '')).toEqual({
      amount: 'Isi nominal refund.',
      reason: 'Pilih alasan refund.',
      note: 'Keterangan wajib, minimal 15 karakter (sekarang 0).',
    });
    expect(refundDraftErrors(draft, 1_150_001n, 'deposit-berlebih', 'x'.repeat(15)).amount).toBe(
      'Melebihi kelebihan deposit Rp 1.150.000.',
    );
    expect(refundDraftErrors(draft, 1_150_000n, 'deposit-berlebih', 'Kelebihan deposit naik kelas')).toEqual(
      {},
    );
    expect(nextRefundStage('draf')).toBe('menunggu-supervisor');
    expect(nextRefundStage('diproses-btn')).toBe('dana-kembali');
    expect(nextRefundStage('dana-kembali')).toBeNull();
  });
});
