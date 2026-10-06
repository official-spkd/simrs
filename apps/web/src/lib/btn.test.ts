import {
  formatRupiah,
  paymentTransactionSchema,
  reconRowSchema,
  refundSchema,
  webhookEventSchema,
} from '@simrs/shared';
import { describe, expect, it } from 'vitest';
import {
  canSimulatePay,
  creditedAmount,
  dayPaidExtra,
  formatJuta,
  formatWhen,
  markPaid,
  nextRefundStage,
  onDay,
  paymentKpis,
  reconTotals,
  refundApproveError,
  refundDraftErrors,
  refundSubmitError,
  refundView,
  resolutionError,
  resolveRow,
  scenarioTag,
  applyRefund,
  settleByResolution,
  settleEdc,
  settleEdcTx,
  webhookDelivered,
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

  it('nominal tak bertanda; hanya penyesuaian rekonsiliasi yang boleh negatif', () => {
    const t1 = tx('t1');
    const hook = tx('t2').webhooks[0];
    const rf = REFUND[0];
    if (!hook || !rf) throw new Error('fixture');
    expect(paymentTransactionSchema.safeParse({ ...t1, amount: '-250400' }).success).toBe(false);
    expect(webhookEventSchema.safeParse({ ...hook, amount: '-5000000' }).success).toBe(false);
    expect(refundSchema.safeParse({ ...rf, amount: '-1' }).success).toBe(false);
    expect(refundSchema.safeParse({ ...rf, maxAmount: '-1' }).success).toBe(false);
    expect(row('x2').exception?.adjustment).toBe('-14000');
    expect(reconRowSchema.safeParse(row('x2')).success).toBe(true);
    expect(reconRowSchema.safeParse({ ...row('r1'), kasir: { amount: '-1', note: '' } }).success).toBe(false);
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
    expect(scenarioTag('2026-10-12T00:52:00.000Z')).toBe('skenario 12 Okt');
    expect(scenarioTag(null)).toBe('skenario');
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

describe('refund: nominal yang diajukan dipakai di semua tahap; server memeriksa ulang', () => {
  const draft = REFUND.find((r) => r.stage === 'draf');
  const rf13 = REFUND.find((r) => r.id === 'rf13');
  const rf11 = REFUND.find((r) => r.id === 'rf11');
  if (!draft || !rf13 || !rf11) throw new Error('fixture refund');
  const sub = {
    amount: '1000000',
    reason: 'deposit-berlebih' as const,
    note: 'Kelebihan deposit naik kelas VIP',
  };

  it('Rp 1.000.000 dari batas Rp 1.150.000 tetap Rp 1.000.000 sampai dana kembali', () => {
    expect(refundView(draft).amount).toBe('1150000');
    for (const stage of [
      'menunggu-supervisor',
      'menunggu-manajer',
      'diproses-btn',
      'dana-kembali',
    ] as const) {
      expect(refundView(draft, stage, sub)).toMatchObject({
        stage,
        amount: '1000000',
        reason: 'deposit-berlebih',
        reasonNote: 'Kelebihan deposit naik kelas VIP',
      });
    }
    expect(refundView(rf13, 'diproses-btn').amount).toBe('96000');
  });

  it('tanpa batas parsial, nominal tidak boleh melebihi transaksi asal', () => {
    expect(refundDraftErrors(rf13, 96_001n, 'layanan-dibatalkan', 'x'.repeat(15)).amount).toBe(
      'Melebihi nominal transaksi asal Rp 96.000.',
    );
    expect(refundDraftErrors(rf13, 96_000n, 'layanan-dibatalkan', 'x'.repeat(15))).toEqual({});
  });

  it('pengajuan: refund harus ada, masih draf, nominal ≤ batas', () => {
    const note = 'Kelebihan deposit naik kelas';
    expect(refundSubmitError(undefined, 1n, 'deposit-berlebih', note)).toBe('Refund tidak ditemukan.');
    expect(refundSubmitError(rf13, 1n, 'layanan-dibatalkan', note)).toBe('Refund ini sudah diajukan.');
    expect(refundSubmitError(draft, 1_150_001n, 'deposit-berlebih', note)).toBe(
      'Melebihi kelebihan deposit Rp 1.150.000.',
    );
    expect(refundSubmitError(draft, 1_000_000n, 'bukan-alasan', note)).toBe('Pilih alasan refund.');
    expect(refundSubmitError(draft, 1_000_000n, 'deposit-berlebih', note)).toBeNull();
  });

  it('persetujuan: hanya tahap menunggu, dan tidak mundur dari tahap di server', () => {
    expect(refundApproveError(draft, 'menunggu-supervisor')).toBeNull();
    expect(refundApproveError(draft, 'draf')).toBe('Tahap refund ini tidak menunggu persetujuan.');
    expect(refundApproveError(rf13, 'menunggu-manajer')).toBeNull();
    expect(refundApproveError(rf13, 'menunggu-supervisor')).toBe('Tahap refund ini sudah lewat.');
    expect(refundApproveError(rf11, 'diproses-btn')).toBe('Tahap refund ini sudah lewat.');
    expect(refundApproveError(undefined, 'diproses-btn')).toBe('Refund tidak ditemukan.');
  });
});

describe('pelunasan simulasi dan angka hari layar', () => {
  it('hanya VA/QRIS menunggu non-skenario yang bisa disimulasikan lunas', () => {
    expect(canSimulatePay(tx('t1'))).toBe(true);
    expect(canSimulatePay({ ...tx('t1'), scenario: true })).toBe(false);
    expect(canSimulatePay({ ...tx('t1'), channel: 'EDC' })).toBe(false);
    expect(canSimulatePay(tx('t2'))).toBe(false);
  });

  it('pelunasan simulasi hari layar menambah penerimaan; kejadian hari lain tidak', () => {
    const paid = markPaid(tx('t1'), '2026-10-05T10:46:00+07:00', 'e');
    expect(onDay(paid.paidAt, '2026-10-05')).toBe(true);
    expect(onDay(null, '2026-10-05')).toBe(false);
    expect(dayPaidExtra([paid], new Set(['t1']), '2026-10-05')).toBe(250_400n);
    expect(dayPaidExtra([paid], new Set(['t1']), '2026-10-12')).toBe(0n);
    expect(dayPaidExtra([paid], new Set(), '2026-10-05')).toBe(0n);
  });
});

describe('tab Transaksi mencerminkan rekonsiliasi dan refund (mockup Pembayaran)', () => {
  const at = '2026-10-05T10:50:00+07:00';
  it('webhook yang timeout belum diterima: tidak dikreditkan', () => {
    const hook = tx('t4').webhooks[0];
    expect(hook && webhookDelivered(hook)).toBe(false);
    expect(creditedAmount(tx('t4').webhooks)).toBe(0n);
  });

  it('x1 kirim ulang: langkah webhook menjadi diterima dan webhook terkredit sekali', () => {
    const t4 = settleByResolution(tx('t4'), resolveRow(row('x1'), { ...res('ulang'), at }));
    const step = t4.trail.find((s) => s.label === 'Webhook diterima · signature valid');
    expect(step).toMatchObject({ state: 'selesai', note: 'dikirim ulang oleh TPDI atas permintaan', at });
    expect(t4.trail.some((s) => s.state === 'peringatan')).toBe(false);
    expect(creditedAmount(t4.webhooks)).toBe(640_000n);
    const lunas = settleByResolution(tx('t4'), resolveRow(row('x1'), res('lunas')));
    expect(lunas.trail.find((s) => s.label.startsWith('Webhook'))?.note).toMatch(/dilewati/);
  });

  it('x2: langkah mutasi BTN dijelaskan sesuai tindakan (MDR atau koreksi)', () => {
    const mdr = settleByResolution(tx('t10'), resolveRow(row('x2'), res('mdr')));
    expect(mdr.trail.find((s) => s.label.startsWith('Masuk mutasi BTN'))).toMatchObject({
      state: 'selesai',
      note: expect.stringMatching(/dicatat sebagai beban MDR$/),
    });
    const koreksi = resolveRow(row('x2'), res('koreksi'));
    expect(koreksi.bank.note).toBe('+ 14.000 koreksi diajukan ke BTN');
  });

  it('x3 dipadankan: tagihan kedaluwarsa tujuan mendapat langkah transfer manual', () => {
    const t5 = settleByResolution(tx('t5'), resolveRow(row('x3'), { ...res('padan'), at }));
    expect(t5.trail.at(-1)).toMatchObject({ label: 'Dibayar lewat transfer manual', state: 'info', at });
    expect(settleByResolution(tx('t5'), resolveRow(row('x3'), res('titip')))).toBe(tx('t5'));
    expect(() => paymentTransactionSchema.parse(t5)).not.toThrow();
  });

  it('rekonsiliasi dijalankan: settlement EDC menuntaskan langkah bank transaksi EDC', () => {
    expect(settleEdcTx(tx('t3'), null)).toBe(tx('t3'));
    const t3 = settleEdcTx(tx('t3'), at);
    expect(t3.trail.find((s) => s.label.startsWith('Masuk mutasi BTN'))).toMatchObject({
      state: 'selesai',
      at,
    });
  });

  it('refund penuh selesai → transaksi asal dikembalikan; refund sebagian hanya menambah jejak', () => {
    const rf13 = REFUND.find((r) => r.id === 'rf13');
    const rf14 = REFUND.find((r) => r.id === 'rf14');
    if (!rf13 || !rf14) throw new Error('fixture');
    expect(applyRefund(tx('t7'), rf13, null)).toBe(tx('t7'));
    const t7 = applyRefund(tx('t7'), rf13, at);
    expect(t7.status).toBe('dikembalikan');
    expect(t7.trail.filter((s) => s.label.startsWith('Refund RF-2610-0013'))).toEqual([
      { label: 'Refund RF-2610-0013 selesai', at, note: 'dana kembali ke rekening pasien', state: 'info' },
    ]);
    const t2 = applyRefund(tx('t2'), rf14, at);
    expect(t2.status).toBe(tx('t2').status);
    expect(t2.trail.at(-1)?.label).toBe('Refund RF-2610-0014 selesai');
  });
});
