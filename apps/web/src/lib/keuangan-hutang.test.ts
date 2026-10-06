import { describe, expect, it } from 'vitest';
import { FAKTUR_PEMASOK } from './demo/fixtures/hutang';
import { PURCHASE_ORDERS } from './demo/fixtures/manajemen';
import { DEMO_TODAY } from './demo/fixtures/waktu';
import { jurnalSeimbang, PERIODE_TERTUTUP } from './keuangan-jurnal';
import {
  applyApproval,
  approvalJournal,
  approveProblem,
  dueGroup,
  invoiceLocked,
  paymentJournal,
  requiredLevels,
  scheduleProblem,
  threeWay,
  verifyProblem,
} from './keuangan-hutang';

const fk = (id: string) => {
  const x = FAKTUR_PEMASOK.find((y) => y.id === id);
  if (!x) throw new Error(id);
  return x;
};
const akuntan = { name: 'Akuntan uji', role: 'akuntan' };
const direktur = { name: 'Direktur uji', role: 'manajemen' };

describe('hutang usaha', () => {
  it('PO sama dengan layar Logistik (nilai PO cairan infus dan reagen)', () => {
    for (const id of ['fp-01', 'fp-02']) {
      const f = fk(id);
      const po = PURCHASE_ORDERS.find((p) => p.id === f.poNumber);
      expect(po?.total).toBe(f.poAmount.toString());
      // Judul PO sama di kedua layar (faktur boleh menambah keterangan tiba).
      expect(f.title.startsWith(po?.title ?? '?')).toBe(true);
    }
  });

  it('pencocokan 3 arah: selisih faktur menahan verifikasi sampai nota kredit atau alasan', () => {
    expect(threeWay(fk('fp-01'))).toMatchObject({ ok: false, variance: 480_000n });
    expect(verifyProblem(fk('fp-01'), akuntan)).toMatch(/selisih/);
    expect(
      verifyProblem({ ...fk('fp-01'), varianceNote: 'Kenaikan harga resmi pemasok' }, akuntan),
    ).toBeNull();
    expect(verifyProblem(fk('fp-02'), akuntan)).toBeNull();
    expect(verifyProblem(fk('fp-02'), direktur)).toMatch(/akuntan/);
    expect(threeWay({ poAmount: 1n, grnAmount: 2n, invoiceAmount: 2n }).overPo).toBe(true);
  });

  it('persetujuan berjenjang: > Rp 50 juta dua tingkat oleh orang berbeda; pemverifikasi tidak menyetujui', () => {
    expect(requiredLevels(fk('fp-03'))).toBe(2);
    expect(requiredLevels(fk('fp-04'))).toBe(1);
    const f3 = fk('fp-03');
    expect(approveProblem(f3, direktur)).toBeNull();
    expect(approveProblem(f3, { name: f3.approvals[0]?.by ?? '', role: 'manajemen' })).toMatch(/tingkat 2/);
    expect(approveProblem(f3, { name: f3.verifiedBy ?? '', role: 'manajemen' })).toMatch(/Pemverifikasi/);
    expect(approveProblem(f3, akuntan)).toMatch(/manajemen/);
    expect(applyApproval(f3, direktur.name, '2026-10-05T11:00:00+07:00').status).toBe('disetujui');
    const v = { ...fk('fp-02'), status: 'diverifikasi' as const, verifiedBy: 'A' };
    expect(applyApproval(v, direktur.name, 'x').status).toBe('diverifikasi');
  });

  it('jurnal persetujuan (dengan selisih harga) dan pembayaran seimbang', () => {
    const j = approvalJournal({ ...fk('fp-01'), varianceNote: 'ok' });
    expect(jurnalSeimbang(j.lines)).toBe(true);
    expect(j.lines.map((l) => l.account.code)).toEqual(['2-1120', '1-1410', '2-1110']);
    expect(jurnalSeimbang(approvalJournal(fk('fp-02')).lines)).toBe(true);
    expect(jurnalSeimbang(approvalJournal({ ...fk('fp-02'), invoiceAmount: 63_000_000n }).lines)).toBe(true);
    expect(jurnalSeimbang(paymentJournal('BYR-2610-003', 61_050_000n).lines)).toBe(true);
  });

  it('jatuh tempo, jadwal bayar, dan kunci periode', () => {
    expect(dueGroup(fk('fp-05').dueDate, DEMO_TODAY)).toBe('lewat');
    expect(dueGroup(fk('fp-04').dueDate, DEMO_TODAY)).toBe('minggu-ini');
    expect(dueGroup(fk('fp-02').dueDate, DEMO_TODAY)).toBe('bulan-ini');
    expect(dueGroup(fk('fp-01').dueDate, DEMO_TODAY)).toBe('bulan-ini');
    expect(scheduleProblem([], 1n)).toMatch(/Centang/);
    expect(scheduleProblem([fk('fp-02')], 10n ** 12n)).toMatch(/disetujui/);
    expect(scheduleProblem([fk('fp-04'), fk('fp-05')], 1_000_000n)).toMatch(/Saldo/);
    expect(scheduleProblem([fk('fp-04'), fk('fp-05')], 1_850_000_000n)).toBeNull();
    expect(invoiceLocked(fk('fp-06'), PERIODE_TERTUTUP)).toBe(true);
    expect(invoiceLocked(fk('fp-04'), PERIODE_TERTUTUP)).toBe(false);
  });
});
