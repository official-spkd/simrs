import { describe, expect, it } from 'vitest';
import { PAYROLL_INPUTS, PAYROLL_PREPARER, SERVICE_FEES } from './demo/fixtures/penggajian';
import {
  calculateBlock,
  computeSlip,
  contributionBase,
  journalBalanced,
  parseRupiahInput,
  payrollApproveBlock,
  payrollJournal,
} from './penggajian';

const sample = {
  employeeId: 'x',
  name: 'X',
  position: 'Perawat',
  base: 5_400_000n,
  positionAllowance: 1_200_000n,
  functionalAllowance: 900_000n,
  serviceFee: 1_850_000n,
  pph21: 95_000n,
};

describe('B05 · slip gaji', () => {
  it('bruto = komponen pendapatan; iuran dari dasar tetap (tanpa jasa pelayanan); neto = bruto − potongan', () => {
    const s = computeSlip(sample);
    expect(contributionBase(sample)).toBe(7_500_000n);
    expect(s.gross).toBe(9_350_000n);
    expect(s.deductions.map(([, v]) => v)).toEqual([75_000n, 150_000n, 75_000n, 95_000n]);
    expect(s.net).toBe(9_350_000n - 395_000n);
  });

  it('batas dasar iuran BPJS Kesehatan dan JP', () => {
    const s = computeSlip({ ...sample, base: 20_000_000n, positionAllowance: 0n, functionalAllowance: 0n });
    expect(s.deductions[0]?.[1]).toBe(120_000n);
    expect(s.deductions[1]?.[1]).toBe(400_000n);
    expect(s.deductions[2]?.[1]).toBe(100_000n);
  });
});

describe('B05 · run gaji', () => {
  it('hitung butuh impor jasa pelayanan dan PPh 21 lengkap', () => {
    expect(calculateBlock(PAYROLL_INPUTS, false)).toMatch(/Impor jasa pelayanan/);
    expect(calculateBlock(PAYROLL_INPUTS, true)).toMatch(/2 pegawai/);
    expect(
      calculateBlock(
        PAYROLL_INPUTS.map((i) => ({ ...i, pph21: i.pph21 ?? 0n })),
        true,
      ),
    ).toBeNull();
    for (const i of PAYROLL_INPUTS) expect(SERVICE_FEES[i.name], i.name).toBeGreaterThan(0);
  });

  it('penyetuju ≠ penyusun; jurnal gaji seimbang', () => {
    expect(payrollApproveBlock(PAYROLL_PREPARER, PAYROLL_PREPARER)).toMatch(/berbeda/);
    expect(payrollApproveBlock(PAYROLL_PREPARER, 'Direktur')).toBeNull();
    const slips = PAYROLL_INPUTS.map((i) =>
      computeSlip({ ...i, serviceFee: BigInt(SERVICE_FEES[i.name] ?? 0), pph21: i.pph21 ?? 50_000n }),
    );
    const j = payrollJournal(slips);
    expect(journalBalanced(j)).toBe(true);
    expect(j[0]?.debit).toBe(slips.reduce((n, s) => n + s.gross, 0n));
  });

  it('isian rupiah utuh', () => {
    expect(parseRupiahInput('1.250.000')).toBe(1_250_000n);
    expect(parseRupiahInput('Rp 95000')).toBe(95_000n);
    expect(parseRupiahInput('12,5')).toBeNull();
    expect(parseRupiahInput('')).toBeNull();
  });
});
