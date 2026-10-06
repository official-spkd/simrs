import { describe, expect, it } from 'vitest';
import { PO_RECEIPT_LINES } from './demo/fixtures/logistik-terima';
import { PURCHASE_ORDERS } from './demo/fixtures/manajemen';
import { DEMO_TODAY } from './demo/fixtures/waktu';
import {
  grNumber,
  lineBlock,
  payableDue,
  receiptBlock,
  receiptJournal,
  receiptValue,
} from './logistik-terima';

const lines = PO_RECEIPT_LINES['PO-2610-028'] ?? [];
const ok = (received: string) => ({ received, batch: 'RL2610A', expiry: '2028-03-31' });

describe('B01 · penerimaan barang', () => {
  it('total baris PO = total PO di daftar pengadaan', () => {
    const po = PURCHASE_ORDERS.find((p) => p.id === 'PO-2610-028');
    const sum = lines.reduce((n, l) => n + BigInt(l.unitPrice) * BigInt(l.ordered), 0n);
    expect(sum.toString()).toBe(po?.total);
  });

  it('jumlah ≤ pesanan, batch dan kedaluwarsa ≥ 6 bulan wajib', () => {
    const l = lines[0];
    if (!l) throw new Error('fixture');
    expect(lineBlock(l, ok('9001'), DEMO_TODAY)).toMatch(/melebihi/);
    expect(lineBlock(l, ok('abc'), DEMO_TODAY)).toMatch(/jumlah/);
    expect(lineBlock(l, { ...ok('9000'), batch: '' }, DEMO_TODAY)).toMatch(/batch/);
    expect(lineBlock(l, { ...ok('9000'), expiry: '2027-03-01' }, DEMO_TODAY)).toMatch(/kurang dari 6 bulan/);
    expect(lineBlock(l, { ...ok('9000'), expiry: '2027-04-05' }, DEMO_TODAY)).toBeNull();
    const inputs = Object.fromEntries(lines.map((x) => [x.itemId, ok(String(x.ordered))]));
    expect(receiptBlock(lines, inputs, DEMO_TODAY, false)).toBeNull();
    expect(receiptBlock([{ ...l, cold: true }], inputs, DEMO_TODAY, false)).toMatch(/rantai dingin/);
  });

  it('nilai penerimaan = persediaan (debit) = utang usaha (kredit); isian tidak sah dihitung 0', () => {
    const inputs = Object.fromEntries(lines.map((x) => [x.itemId, ok(String(x.ordered))]));
    const v = receiptValue(lines, inputs);
    expect(v).toBe(95_400_000n);
    const j = receiptJournal(v);
    expect(j.reduce((n, x) => n + x.debit, 0n)).toBe(j.reduce((n, x) => n + x.credit, 0n));
    expect(receiptValue(lines, { 'infus-rl-500': ok('x') })).toBe(0n);
    expect(payableDue(DEMO_TODAY)).toBe('2026-11-04');
    expect(grNumber(1)).toBe('GR-2610-0001');
  });
});
