import { instalmentApplicationSchema, receivableBatchSchema } from '@simrs/shared';
import { describe, expect, it } from 'vitest';
import {
  advanceAmount,
  canReject,
  daysBetween,
  eligibleBatches,
  facilityPosition,
  formatRingkas,
  marginFor,
  monthlyInstalment,
  nextInstalmentStage,
  quoteDrawdown,
  repaymentSplit,
  simulateBpjsPayment,
} from './btn-pembiayaan';
import { CICILAN, FASILITAS, PENCAIRAN, POOL_KLAIM } from './demo/fixtures/btn';
import { DEMO_TODAY } from './demo/fixtures/waktu';

const drawdowns = PENCAIRAN.map((d) => ({ ...d, batchIds: [...d.batchIds] }));

describe('aritmetika pembiayaan piutang BPJS (bigint)', () => {
  it('advance 90%, margin 8% p.a. harian dibulatkan Rp 100, pelunasan otomatis dan sisa', () => {
    const advance = advanceAmount(7_140_000n, 90);
    expect(advance).toBe(6_426_000n);
    const margin = marginFor(advance, 800, 21);
    expect(margin).toBe(29_600n);
    expect(repaymentSplit(7_140_000n, advance, margin)).toEqual({ debit: 6_455_600n, forwarded: 684_400n });
    expect(marginFor(advance, 800, 0)).toBe(0n);
    expect(() => repaymentSplit(1_000n, advance, margin)).toThrow(RangeError);
    expect(() => advanceAmount(1n, 90.5)).toThrow(RangeError);
  });

  it('posisi fasilitas per hari demo: outstanding, sisa plafon, margin berjalan', () => {
    expect(daysBetween('2026-09-04', DEMO_TODAY)).toBe(31);
    const pos = facilityPosition(FASILITAS, drawdowns, DEMO_TODAY);
    expect(pos.outstanding).toBe(7_470_000_000n);
    expect(pos.available).toBe(7_530_000_000n);
    expect(pos.activeCount).toBe(2);
    expect(pos.marginRunning).toBe(marginFor(4_320_000_000n, 800, 31) + marginFor(3_150_000_000n, 800, 13));
  });

  it('hanya batch layak bayar yang belum dijaminkan bisa diajukan; nilai cair dibatasi sisa plafon', () => {
    for (const b of POOL_KLAIM) expect(() => receivableBatchSchema.parse(b)).not.toThrow();
    const free = eligibleBatches(POOL_KLAIM, drawdowns);
    expect(free.map((b) => b.id)).toEqual(['p3', 'p4', 'p5', 'p6']);
    const q = quoteDrawdown(free.slice(0, 2), 90, 7_530_000_000n);
    expect(q).toEqual({
      claims: 4_100_000_000n,
      advance: 3_690_000_000n,
      disburse: 3_690_000_000n,
      cappedByLimit: false,
    });
    const all = quoteDrawdown(free, 90, 7_530_000_000n);
    expect(all.cappedByLimit).toBe(true);
    expect(all.disburse).toBe(7_530_000_000n);
  });
});

describe('cicilan biaya pasien', () => {
  it('estimasi angsuran flat 11% p.a. sama dengan opsi tenor skenario', () => {
    expect(monthlyInstalment(6_400_000n, 3, 11)).toBe(2_192_000n);
    expect(monthlyInstalment(6_400_000n, 6, 11)).toBe(1_125_000n);
    expect(monthlyInstalment(6_400_000n, 12, 11)).toBe(592_000n);
    expect(() => monthlyInstalment(6_400_000n, 0, 11)).toThrow(RangeError);
  });

  it('tujuh pengajuan lolos skema; alur Diajukan → Verifikasi → Disetujui → Akad TTE → Dicairkan', () => {
    expect(CICILAN).toHaveLength(7);
    for (const a of CICILAN) expect(() => instalmentApplicationSchema.parse(a)).not.toThrow();
    expect(new Set(CICILAN.map((a) => a.stage)).size).toBe(6);
    expect(nextInstalmentStage('diajukan')).toBe('verifikasi');
    expect(nextInstalmentStage('akad')).toBe('dicairkan');
    expect(nextInstalmentStage('dicairkan')).toBeNull();
    expect(nextInstalmentStage('ditolak')).toBeNull();
    expect(canReject({ stage: 'verifikasi' })).toBe(true);
    expect(canReject({ stage: 'disetujui' })).toBe(false);
  });
});

describe('simulasi pembayaran BPJS dan format ringkas', () => {
  it('BPJS membayar batch dasar: pokok + margin didebit, sisa ke operasional (jumlah = nilai klaim)', () => {
    const first = drawdowns[0];
    if (!first) throw new Error('pencairan');
    const p = simulateBpjsPayment(FASILITAS, first, POOL_KLAIM, DEMO_TODAY);
    expect(p).toMatchObject({ claims: 4_800_000_000n, principal: 4_320_000_000n, days: 31, assumed: false });
    expect(p.margin).toBe(marginFor(4_320_000_000n, 800, 31));
    expect(p.principal + p.margin + p.forwarded).toBe(p.claims);
    const fresh = simulateBpjsPayment(
      FASILITAS,
      { ...first, disbursedOn: DEMO_TODAY },
      POOL_KLAIM,
      DEMO_TODAY,
    );
    expect(fresh).toMatchObject({ days: 34, assumed: true });
  });

  it('format ringkas', () => {
    expect(formatRingkas(15_000_000_000n)).toBe('Rp 15,00 M');
    expect(formatRingkas(7_470_000_000n)).toBe('Rp 7,47 M');
    expect(formatRingkas(6_426_000n)).toBe('Rp 6,4 jt');
    expect(formatRingkas(684_400n)).toBe('Rp 684.400');
  });
});
