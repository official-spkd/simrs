import { describe, expect, it } from 'vitest';
import { ATURAN_JASPEL, feeOf, TINDAKAN_JASPEL } from './demo/fixtures/jaspel';
import { jurnalSeimbang } from './keuangan-jurnal';
import {
  accrualJournal,
  allocate,
  csvCell,
  paymentJournal,
  pphOf,
  realizedFee,
  rekap,
  rekapCsv,
  stepProblem,
} from './keuangan-jaspel';

const t = (id: string) => {
  const x = TINDAKAN_JASPEL.find((i) => i.id === id);
  if (!x) throw new Error(id);
  return x;
};

describe('jasa pelayanan', () => {
  it('aturan pembagian 100%; komponen jasa dari tarif (medis + paramedis)', () => {
    expect(ATURAN_JASPEL.shares.reduce((s, x) => s + x.bp, 0)).toBe(10_000);
    // Visite Kelas 2 Rp 180.000: jasa medis 85% = Rp 153.000 per kali.
    expect(feeOf('VST-SP', 'k2', 1)).toBe(153_000n);
  });

  it('Σ alokasi = jasa terealisasi untuk setiap tindakan', () => {
    for (const x of TINDAKAN_JASPEL) {
      const a = allocate(x, ATURAN_JASPEL);
      expect(a.pelaksana + a.tim + a.bersama + a.manajemen, x.id).toBe(realizedFee(x));
    }
  });

  it('BPJS: realisasi = jasa × INA-CBG dibayar ÷ tarif RS; klaim belum dibayar = ditahan', () => {
    expect(realizedFee(t('jp-01'))).toBe(0n);
    expect(realizedFee(t('jp-06'))).toBe((t('jp-06').fee * 5_420_000n) / 6_180_000n);
    expect(realizedFee(t('jp-03'))).toBe(t('jp-03').fee);
  });

  it('rekap: bruto per PPA + pos = terealisasi; PPh dan neto; jurnal akrual dan bayar seimbang', () => {
    const r = rekap(TINDAKAN_JASPEL, ATURAN_JASPEL);
    const pools = r.pools.reduce((s, p) => s + p.amount, 0n);
    expect(r.totalGross + pools).toBe(r.realized);
    expect(r.held).toBe(t('jp-01').fee + t('jp-02').fee + t('jp-08').fee);
    for (const row of r.rows) {
      expect(row.pph).toBe(pphOf(row.gross, ATURAN_JASPEL.pphBp));
      expect(row.net).toBe(row.gross - row.pph);
    }
    expect(r.rows.some((x) => x.name.includes('Endang'))).toBe(false);
    expect(jurnalSeimbang(accrualJournal(r, 'Oktober').lines)).toBe(true);
    const pay = paymentJournal(r, 'Oktober');
    expect(jurnalSeimbang(pay.lines)).toBe(true);
    expect(pay.lines).toHaveLength(3);
  });

  it('tahapan: akuntan verifikasi, manajemen (bukan pemverifikasi) setuju, akuntan bayar', () => {
    const akuntan = { name: 'A', role: 'akuntan' };
    const mgr = { name: 'M', role: 'manajemen' };
    expect(stepProblem('dihitung', akuntan, null)).toBeNull();
    expect(stepProblem('dihitung', mgr, null)).toMatch(/akuntan/);
    expect(stepProblem('diverifikasi', akuntan, 'A')).toMatch(/manajemen/);
    expect(stepProblem('diverifikasi', { name: 'A', role: 'manajemen' }, 'A')).toMatch(/Pemverifikasi/);
    expect(stepProblem('diverifikasi', mgr, 'A')).toBeNull();
    expect(stepProblem('disetujui', akuntan, 'A')).toBeNull();
    expect(stepProblem('dibayar', akuntan, 'A')).toMatch(/sudah dibayar/);
  });

  it('CSV aman dari formula injection', () => {
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell('@cmd')).toBe("'@cmd");
    expect(csvCell('dr. A; Sp.PD')).toBe('"dr. A; Sp.PD"');
    expect(csvCell('Ns. "Maya"')).toBe('"Ns. ""Maya"""');
    const csv = rekapCsv(rekap(TINDAKAN_JASPEL, ATURAN_JASPEL));
    expect(csv.split('\n')[0]).toBe('PPA;Jumlah tindakan;Bruto;PPh 21;Neto');
  });
});
