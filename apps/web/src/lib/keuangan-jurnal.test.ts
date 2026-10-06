import { describe, expect, it } from 'vitest';
import {
  AKUN_LANJUT as A,
  bagiSisaTerbesar,
  cr,
  dr,
  jurnal,
  jurnalSeimbang,
  labelPeriode,
  periodeTerkunci,
  persen,
  ringkasJurnal,
  selisihHari,
  tanggalPendek,
  totalJurnal,
} from './keuangan-jurnal';

describe('jurnal berpasangan', () => {
  it('seimbang bila Σ debit = Σ kredit > 0 dan tiap baris satu sisi', () => {
    const j = jurnal('Setoran kas', [dr(A.bankOps, 1_250_400n), cr(A.kasKasir, 1_250_400n)]);
    expect(jurnalSeimbang(j.lines)).toBe(true);
    expect(totalJurnal(j.lines)).toEqual({ debit: 1_250_400n, credit: 1_250_400n });
    expect(ringkasJurnal(j)).toBe('Dr 1-1120 Rp 1.250.400 · Cr 1-1110 Rp 1.250.400');
  });

  it('tidak seimbang: selisih, satu baris, baris dua sisi, negatif, nol', () => {
    expect(jurnalSeimbang([dr(A.bankOps, 100n), cr(A.kasKasir, 90n)])).toBe(false);
    expect(jurnalSeimbang([dr(A.bankOps, 100n)])).toBe(false);
    expect(jurnalSeimbang([{ account: A.bankOps, debit: 100n, credit: 100n }, cr(A.kasKasir, 0n)])).toBe(
      false,
    );
    expect(jurnalSeimbang([dr(A.bankOps, -100n), cr(A.kasKasir, -100n)])).toBe(false);
    expect(jurnalSeimbang([dr(A.bankOps, 0n), cr(A.kasKasir, 0n)])).toBe(false);
  });

  it('baris nol dibuang saat membentuk jurnal', () => {
    const j = jurnal('x', [dr(A.bankOps, 10n), dr(A.bebanSelisihKas, 0n), cr(A.kasKasir, 10n)]);
    expect(j.lines).toHaveLength(2);
  });
});

describe('pembagian sisa terbesar', () => {
  it('Σ hasil = total tepat untuk bobot apa pun', () => {
    for (const total of [0n, 1n, 99n, 1_000_001n, 987_654_321n]) {
      for (const w of [
        [1n, 1n, 1n],
        [6_000n, 2_500n, 1_000n, 500n],
        [3n, 0n, 7n],
      ]) {
        const out = bagiSisaTerbesar(total, w);
        expect(
          out.reduce((a, b) => a + b, 0n),
          `${total} ${w.join('/')}`,
        ).toBe(total);
      }
    }
    expect(bagiSisaTerbesar(100n, [1n, 1n, 1n])).toEqual([34n, 33n, 33n]);
    expect(bagiSisaTerbesar(100n, [0n, 0n])).toEqual([0n, 0n]);
  });
});

describe('periode dan format', () => {
  it('periode tertutup terkunci; periode berjalan terbuka', () => {
    expect(periodeTerkunci('2026-09-30', ['2026-09'])).toBe(true);
    expect(periodeTerkunci('2026-10-05T10:00:00+07:00', ['2026-09'])).toBe(false);
    expect(labelPeriode('2026-09')).toBe('September 2026');
  });

  it('tanggal pendek, selisih hari, persen tanpa float', () => {
    expect(tanggalPendek('2026-10-05')).toBe('5 Okt 2026');
    expect(selisihHari('2026-09-28', '2026-10-05')).toBe(7);
    expect(selisihHari('2026-10-05', '2026-10-01')).toBe(-4);
    expect(persen(1n, 8n)).toBe('12,5%');
    expect(persen(-25n, 100n)).toBe('−25,0%');
    expect(persen(1n, 0n)).toBe('—');
  });
});
