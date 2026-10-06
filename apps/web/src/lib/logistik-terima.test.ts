import { describe, expect, it } from 'vitest';
import { PO_RECEIPT_LINES } from './demo/fixtures/logistik-terima';
import { FAKTUR_PEMASOK } from './demo/fixtures/hutang';
import { STATIC_JOURNALS } from './demo/fixtures/keuangan';
import { PURCHASE_ORDERS } from './demo/fixtures/manajemen';
import { approvalJournal } from './keuangan-hutang';
import { DEMO_TODAY } from './demo/fixtures/waktu';
import {
  grNumber,
  lineBlock,
  payableDue,
  receiptBlock,
  receiptJournal,
  receiptValue,
} from './logistik-terima';

const lines = PO_RECEIPT_LINES['PO-2610-024'] ?? [];
const ok = (received: string) => ({ received, batch: 'KS2610A', expiry: '2028-03-31' });

describe('B01 · penerimaan barang', () => {
  it('total baris PO = total PO di daftar pengadaan', () => {
    const po = PURCHASE_ORDERS.find((p) => p.id === 'PO-2610-024');
    const sum = lines.reduce((n, l) => n + BigInt(l.unitPrice) * BigInt(l.ordered), 0n);
    expect(sum.toString()).toBe(po?.total);
  });

  it('jumlah ≤ pesanan, batch dan kedaluwarsa ≥ 6 bulan wajib', () => {
    const l = lines[0];
    if (!l) throw new Error('fixture');
    expect(lineBlock(l, ok('7001'), DEMO_TODAY)).toMatch(/melebihi/);
    expect(lineBlock(l, ok('abc'), DEMO_TODAY)).toMatch(/jumlah/);
    expect(lineBlock(l, { ...ok('7000'), batch: '' }, DEMO_TODAY)).toMatch(/batch/);
    expect(lineBlock(l, { ...ok('7000'), expiry: '2027-03-01' }, DEMO_TODAY)).toMatch(/kurang dari 6 bulan/);
    expect(lineBlock(l, { ...ok('7000'), expiry: '2027-04-05' }, DEMO_TODAY)).toBeNull();
    const inputs = Object.fromEntries(lines.map((x) => [x.itemId, ok(String(x.ordered))]));
    expect(receiptBlock(lines, inputs, DEMO_TODAY, false)).toBeNull();
    expect(receiptBlock([{ ...l, cold: true }], inputs, DEMO_TODAY, false)).toMatch(/rantai dingin/);
  });

  it('nilai penerimaan = persediaan (debit) = utang belum difakturkan (kredit); isian tidak sah dihitung 0', () => {
    const inputs = Object.fromEntries(lines.map((x) => [x.itemId, ok(String(x.ordered))]));
    const v = receiptValue(lines, inputs);
    expect(v).toBe(22_700_000n);
    const j = receiptJournal(v);
    expect(j.reduce((n, x) => n + x.debit, 0n)).toBe(j.reduce((n, x) => n + x.credit, 0n));
    expect(receiptValue(lines, { 'kasa-steril': ok('x') })).toBe(0n);
    expect(payableDue(DEMO_TODAY)).toBe('2026-11-04');
    expect(grNumber(145)).toBe('GRN-2610-0145');
  });

  it('penerimaan barang mengkredit utang BELUM difakturkan; faktur memindahkannya ke utang usaha (sekali)', () => {
    const f = FAKTUR_PEMASOK.find((x) => x.grnAmount === x.invoiceAmount) ?? FAKTUR_PEMASOK[0]!;
    const net = new Map<string, bigint>();
    const post = (code: string, debit: bigint, credit: bigint) =>
      net.set(code, (net.get(code) ?? 0n) + debit - credit);
    for (const l of receiptJournal(f.grnAmount)) post(l.account.slice(0, 6), l.debit, l.credit);
    for (const l of approvalJournal(f).lines) post(l.account.code, l.debit, l.credit);
    // 2-1120 kembali nol; 2-1110 terkredit sekali sebesar nilai faktur.
    expect(net.get('2-1120') ?? 0n).toBe(0n);
    expect(net.get('2-1110')).toBe(-f.invoiceAmount);
    // Jurnal GRN di Akuntansi memakai akun yang sama dengan Logistik.
    const grn = STATIC_JOURNALS.find((j) => j.id === 'ju-grn');
    expect(grn?.lines.map((l) => l.account?.code)).toEqual(['1-1410', '2-1120']);
  });
});
