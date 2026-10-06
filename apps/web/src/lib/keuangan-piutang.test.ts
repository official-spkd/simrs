import { describe, expect, it } from 'vitest';
import { INVOICE_ID } from './demo/fixtures/ids';
import { STATIC_INVOICES } from './demo/fixtures/keuangan';
import { BATCH_TAGIHAN, CONTOH_PEMBAGIAN, PENYESUAIAN, PIUTANG_ITEMS } from './demo/fixtures/piutang';
import { DEMO_TODAY } from './demo/fixtures/waktu';
import { jurnalSeimbang, PERIODE_TERTUTUP } from './keuangan-jurnal';
import {
  adjustmentApprovalProblem,
  adjustmentJournal,
  adjustmentProblems,
  agingBucket,
  allocatePayment,
  batchPaid,
  batchProblem,
  batchRemaining,
  batchStatusOf,
  batchStatus,
  batchTotal,
  approveAdjustment,
  hitungPembagian,
  outstanding,
  paymentJournal,
  paymentLocked,
  paymentProblem,
  recognitionJournal,
  selisihNaikKelas,
} from './keuangan-piutang';

const item = (id: string) => PIUTANG_ITEMS.find((i) => i.id === id) ?? PIUTANG_ITEMS[0]!;

describe('pembagian penjamin', () => {
  it('identitas: total = penjamin + pasien + ditanggung RS untuk semua contoh', () => {
    for (const c of CONTOH_PEMBAGIAN) {
      const s = hitungPembagian(c.input);
      expect(s.payer + s.patient + s.hospital, c.id).toBe(s.total);
      expect(s.payer >= 0n && s.patient >= 0n, c.id).toBe(true);
      expect(jurnalSeimbang(recognitionJournal(c.input.scheme, s).lines), c.id).toBe(true);
    }
  });

  it('sama dengan pembagian tagihan Kasir (Ny. Endang naik Kelas 1, Ny. Ayu umum)', () => {
    const endang = STATIC_INVOICES.find((i) => i.id === INVOICE_ID.endang)?.split;
    const s = hitungPembagian(CONTOH_PEMBAGIAN[0]!.input);
    expect(s.payer.toString()).toBe(endang?.payerPays);
    expect(s.patient.toString()).toBe(endang?.patientShare);
    expect(s.hospital.toString()).toBe(endang?.hospitalAbsorbs);
    expect(s.patient).toBe(1_250_400n);
    const ayu = hitungPembagian(CONTOH_PEMBAGIAN[3]!.input);
    expect(ayu).toMatchObject({ payer: 0n, patient: 463_500n, hospital: 0n });
  });

  it('selisih naik kelas: ke Kelas 1 = selisih CBG; ke VIP = 75% CBG Kelas 1 (bigint)', () => {
    expect(selisihNaikKelas('k1', 6_612_800n, 7_863_200n)).toBe(1_250_400n);
    expect(selisihNaikKelas('vip', 11_212_300n, 11_212_300n)).toBe(8_409_225n);
    expect(selisihNaikKelas('tidak', 1n, 2n)).toBe(0n);
  });

  it('asuransi: penjamin sampai plafon, pasien kelebihan dan item di luar tanggungan', () => {
    expect(hitungPembagian(CONTOH_PEMBAGIAN[2]!.input)).toMatchObject({
      payer: 15_000_000n,
      patient: 3_450_000n,
      hospital: 0n,
    });
    expect(hitungPembagian({ scheme: 'asuransi', total: 5_000_000n, plafon: 15_000_000n })).toMatchObject({
      payer: 5_000_000n,
      patient: 0n,
    });
  });
});

describe('piutang dan penagihan', () => {
  it('fixture: pembayaran batch = Σ terbayar item; status batch sesuai', () => {
    for (const b of BATCH_TAGIHAN) {
      const items = PIUTANG_ITEMS.filter((i) => b.itemIds.includes(i.id));
      expect(
        items.every((i) => i.batch === b.number && i.payerName === b.payerName),
        b.number,
      ).toBe(true);
      expect(
        items.reduce((s, i) => s + i.paid, 0n),
        b.number,
      ).toBe(batchPaid(b));
      expect(batchStatus(batchTotal(b, PIUTANG_ITEMS), batchPaid(b), !!b.sentAt), b.number).toBe(b.status);
    }
  });

  it('umur piutang dari tanggal invoice (WIB)', () => {
    expect(agingBucket('2026-10-01', DEMO_TODAY)).toBe(0);
    expect(agingBucket('2026-08-14', DEMO_TODAY)).toBe(1);
    expect(agingBucket('2026-07-20', DEMO_TODAY)).toBe(2);
    expect(agingBucket('2026-07-02', DEMO_TODAY)).toBe(3);
  });

  it('gerbang batch: satu penjamin, belum ditagih, bukan pasien umum', () => {
    expect(batchProblem([])).toMatch(/Centang/);
    expect(batchProblem([item('pi-03'), item('pi-04')])).toBeNull();
    expect(batchProblem([item('pi-03'), item('pi-05')])).toMatch(/satu penjamin/);
    expect(batchProblem([item('pi-01')])).toMatch(/batch penagihan lain/);
    expect(batchProblem([item('pi-09')])).toMatch(/Kasir/);
  });

  it('pelunasan: nominal ≤ sisa, referensi wajib; jurnal Dr bank / Cr piutang seimbang; alokasi FIFO', () => {
    const b = BATCH_TAGIHAN[0]!;
    const remaining = batchTotal(b, PIUTANG_ITEMS) - batchPaid(b);
    expect(remaining).toBe(14_800_000n);
    expect(paymentProblem(remaining, 0n, 'BTN-1')).toMatch(/nominal/);
    expect(paymentProblem(remaining, remaining + 1n, 'BTN-H2H-1')).toMatch(/melebihi/);
    expect(paymentProblem(remaining, remaining, 'x')).toMatch(/referensi/);
    expect(paymentProblem(remaining, remaining, 'BTN-H2H-2610-1')).toBeNull();
    const j = paymentJournal(b, 6_000_000n);
    expect(jurnalSeimbang(j.lines)).toBe(true);
    expect(j.lines.map((l) => l.account.code)).toEqual(['1-1120', '1-1340']);
    const after = allocatePayment(PIUTANG_ITEMS, b, 6_000_000n);
    expect(after.find((i) => i.id === 'pi-01')?.paid).toBe(15_000_000n);
    expect(after.find((i) => i.id === 'pi-02')?.paid).toBe(1_000_000n);
    expect(after.reduce((s, i) => s + i.paid, 0n) - PIUTANG_ITEMS.reduce((s, i) => s + i.paid, 0n)).toBe(
      6_000_000n,
    );
  });

  it('pembayaran di periode tertutup terkunci', () => {
    expect(paymentLocked(BATCH_TAGIHAN[0]!.payments[0]!, PERIODE_TERTUTUP)).toBe(true);
    expect(paymentLocked({ at: '2026-10-05T10:00:00+07:00' }, PERIODE_TERTUTUP)).toBe(false);
  });
});

describe('penyesuaian piutang', () => {
  it('nominal sampai sisa piutang dan alasan ≥ 20 karakter', () => {
    expect(adjustmentProblems(item('pi-03'), 6_450_000n, 'Potongan kontrak 2026 sesuai addendum')).toEqual(
      [],
    );
    expect(adjustmentProblems(item('pi-03'), 6_450_001n, 'Potongan kontrak 2026 sesuai addendum')[0]).toMatch(
      /nominal/,
    );
    expect(adjustmentProblems(undefined, 1n, 'x')).toHaveLength(2);
  });

  it('persetujuan manajemen, pembuat ≠ penyetuju; jurnal beban/potongan seimbang', () => {
    const a = PENYESUAIAN[0]!;
    expect(adjustmentApprovalProblem(a, { name: 'Akuntan', role: 'akuntan' })).toMatch(/manajemen/);
    expect(adjustmentApprovalProblem(a, { name: a.maker, role: 'manajemen' })).toMatch(/sendiri/);
    expect(adjustmentApprovalProblem(a, { name: 'Direktur', role: 'manajemen' })).toBeNull();
    const j = adjustmentJournal(a, 'asuransi');
    expect(jurnalSeimbang(j.lines)).toBe(true);
    expect(j.lines.map((l) => [l.account.code, l.debit, l.credit])).toEqual([
      ['6-3100', 3_250_000n, 0n],
      ['1-1340', 0n, 3_250_000n],
    ]);
    expect(outstanding(item('pi-06'))).toBe(a.amount);
  });
});

describe('penyesuaian disetujui mengurangi sisa batch (regresi kredit ganda)', () => {
  const a = PENYESUAIAN[0]!;
  const b = BATCH_TAGIHAN.find((x) => x.number === 'TG-2607-018')!;
  const director = { name: 'Direktur Keuangan', role: 'manajemen' };

  it('hapus buku pi-06 → sisa batch 0, pelunasan ditolak, batch lunas', () => {
    expect(batchRemaining(b, PIUTANG_ITEMS)).toBe(3_250_000n);
    const after = approveAdjustment(PIUTANG_ITEMS, a);
    expect(outstanding(after.find((i) => i.id === 'pi-06')!)).toBe(0n);
    expect(batchRemaining(b, after)).toBe(0n);
    expect(batchStatusOf(b, after)).toBe('lunas');
    expect(paymentProblem(batchRemaining(b, after), 3_250_000n, 'MUT-261005-01')).toMatch(/melebihi/);
  });

  it('persetujuan memeriksa ulang sisa piutang (pelunasan masuk sesudah pengajuan)', () => {
    const paidMeanwhile = allocatePayment(PIUTANG_ITEMS, b, 1_000_000n);
    const it = paidMeanwhile.find((i) => i.id === 'pi-06');
    expect(adjustmentApprovalProblem(a, director, it)).toMatch(/sisa piutang/);
    expect(adjustmentApprovalProblem(a, director, item('pi-06'))).toBeNull();
  });
});
