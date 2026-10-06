import { describe, expect, it } from 'vitest';
import { LACI, MUTASI_BANK, REKENING_KORAN } from './demo/fixtures/kas-bank';
import { BATCH_TAGIHAN, PIUTANG_ITEMS } from './demo/fixtures/piutang';
import { jurnalSeimbang, PERIODE_TERTUTUP, totalJurnal } from './keuangan-jurnal';
import {
  candidateFits,
  closeJournal,
  closeProblems,
  countTotal,
  exceptionJournal,
  expectedCash,
  matchJournal,
  mutationLocked,
  reconSummary,
  reverseJournal,
} from './keuangan-kasbank';
import { batchPaid, batchTotal } from './keuangan-piutang';

const laci = LACI[0];
const m = (id: string) => {
  const x = MUTASI_BANK.find((y) => y.id === id);
  if (!x) throw new Error(id);
  return x;
};

describe('kas kasir', () => {
  it('saldo seharusnya = modal + Σ transaksi tunai', () => {
    expect(laci && expectedCash(laci)).toBe(4_208_400n);
  });

  it('hitung fisik per pecahan (bilangan bulat, negatif diabaikan)', () => {
    expect(countTotal({ '100000': 42, '5000': 1, '2000': 1, '1000': 1, '200': 2 })).toBe(4_208_400n);
    expect(countTotal({ '100000': -3, '50000': 1.7 })).toBe(50_000n);
  });

  it('selisih wajib alasan; di atas Rp 50.000 wajib supervisor', () => {
    expect(closeProblems(4_208_400n, 4_208_400n, '', false)).toEqual([]);
    expect(closeProblems(4_206_400n, 4_208_400n, 'kurang', false)[0]).toMatch(/alasan selisih/);
    expect(closeProblems(4_206_400n, 4_208_400n, 'Kembalian terlebih satu transaksi', false)).toEqual([]);
    expect(closeProblems(4_108_400n, 4_208_400n, 'Kembalian terlebih satu transaksi', false)).toEqual([
      'selisih di atas Rp 50.000 wajib disaksikan supervisor',
    ]);
    expect(closeProblems(0n, 1n, '', false)[0]).toMatch(/hitungan fisik/);
  });

  it('jurnal tutup laci seimbang: pas, kurang, lebih; setoran = fisik − modal', () => {
    for (const physical of [4_208_400n, 4_206_400n, 4_210_000n]) {
      const j = closeJournal('Loket 1', physical, 4_208_400n, 500_000n);
      expect(jurnalSeimbang(j.lines), physical.toString()).toBe(true);
      expect(j.lines[0]?.debit).toBe(physical - 500_000n);
    }
    expect(
      closeJournal('Loket 1', 4_206_400n, 4_208_400n, 500_000n).lines.map((l) => l.account.code),
    ).toEqual(['1-1120', '6-1300', '1-1110']);
  });
});

describe('mutasi bank', () => {
  it('kandidat cocok sesuai nominal; jurnal padanan, pengecualian, dan balik seimbang', () => {
    for (const mut of MUTASI_BANK) {
      for (const c of mut.candidates) {
        expect(candidateFits(mut, c), `${mut.id} ${c.id}`).toBe(true);
        const j = matchJournal(mut, c);
        expect(jurnalSeimbang(j.lines), mut.id).toBe(true);
        const back = reverseJournal(j, 'balik');
        expect(totalJurnal(back.lines)).toEqual(totalJurnal(j.lines));
        expect(back.lines.find((l) => l.account.code === j.lines[0]?.account.code)?.credit).toBe(
          j.lines[0]?.debit,
        );
        expect(back.lines[0]?.debit).toBeGreaterThan(0n);
      }
    }
    const edc = matchJournal(m('mb-2'), m('mb-2').candidates[0]!);
    expect(edc.lines.map((l) => [l.account.code, l.debit, l.credit])).toEqual([
      ['1-1120', 9_850_000n, 0n],
      ['6-1200', 150_000n, 0n],
      ['1-1210', 0n, 10_000_000n],
    ]);
    expect(jurnalSeimbang(exceptionJournal(m('mb-4')).lines)).toBe(true);
    expect(candidateFits(m('mb-4'), m('mb-2').candidates[0]!)).toBe(false);
  });

  it('transfer asuransi = sisa batch TG-2609-031 di layar Piutang', () => {
    const b = BATCH_TAGIHAN.find((x) => x.number === 'TG-2609-031');
    expect(b && batchTotal(b, PIUTANG_ITEMS) - batchPaid(b)).toBe(m('mb-3').amount);
  });

  it('mutasi periode tertutup terkunci; saldo buku = koran − belum padan', () => {
    expect(mutationLocked(m('mb-0'), PERIODE_TERTUTUP)).toBe(true);
    expect(mutationLocked(m('mb-2'), PERIODE_TERTUTUP)).toBe(false);
    const s = reconSummary(REKENING_KORAN.balance, MUTASI_BANK);
    expect(s.open).toBe(4);
    expect(s.openAmount).toBe(9_850_000n + 14_800_000n + 142_500n - 25_000n);
    expect(s.bookBalance + s.openAmount).toBe(REKENING_KORAN.balance);
  });
});
