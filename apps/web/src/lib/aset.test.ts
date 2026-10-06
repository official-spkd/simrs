import { describe, expect, it } from 'vitest';
import {
  bookValue,
  calibrationStatus,
  completionBlock,
  formatDuration,
  nextCalibration,
  responseWithinSla,
} from './aset';
import { ASSETS, REPAIR_TICKETS } from './demo/fixtures/aset';
import { DEMO_NOW, DEMO_TODAY } from './demo/fixtures/waktu';

describe('B02 · kalibrasi', () => {
  it('lewat = tidak laik, ≤ 30 hari = segera; tanpa jadwal = tidak wajib', () => {
    expect(calibrationStatus('2026-09-28', DEMO_TODAY)).toEqual({ status: 'lewat', days: -7 });
    expect(calibrationStatus('2026-11-04', DEMO_TODAY)).toEqual({ status: 'segera', days: 30 });
    expect(calibrationStatus('2026-11-05', DEMO_TODAY).status).toBe('laik');
    expect(calibrationStatus(null, DEMO_TODAY).status).toBe('tidak-perlu');
    const st = ASSETS.map((a) => calibrationStatus(a.nextCalibration, DEMO_TODAY).status);
    expect(st.filter((s) => s === 'lewat')).toHaveLength(2);
  });

  it('kalibrasi berikutnya 12 bulan, melewati pergantian tahun', () => {
    expect(nextCalibration('2026-10-05')).toBe('2027-10-05');
    expect(nextCalibration('2026-12-01', 1)).toBe('2027-01-01');
    expect(nextCalibration('2026-11-15', 2)).toBe('2027-01-15');
  });
});

describe('B02 · nilai buku dan tiket', () => {
  it('garis lurus per bulan penuh, bigint, habis = 0', () => {
    expect(bookValue(120_000_000n, '2026-01-15', 10, '2026-10-05')).toBe(111_000_000n);
    expect(bookValue(7_800_000n, '2023-06-02', 5, DEMO_TODAY)).toBe(7_800_000n - (7_800_000n * 40n) / 60n);
    expect(bookValue(1_000n, '2010-01-01', 5, DEMO_TODAY)).toBe(0n);
  });

  it('SLA respons per dampak; uji fungsi dan listrik wajib sebelum selesai', () => {
    const late = REPAIR_TICKETS.filter(
      (t) => !responseWithinSla(t.reportedAt, t.respondedAt, DEMO_NOW, t.impact),
    );
    expect(late.map((t) => t.number)).toEqual(['WO-2610-033']);
    expect(formatDuration(35)).toBe('35 menit');
    expect(formatDuration(150)).toBe('2 jam 30 menit');
    expect(formatDuration(120)).toBe('2 jam');
    expect(
      completionBlock({ functionTest: true, electricalSafety: false, note: 'Ganti sensor SpO2' }),
    ).toMatch(/uji/);
    expect(completionBlock({ functionTest: true, electricalSafety: true, note: 'pendek' })).toMatch(
      /10 huruf/,
    );
    expect(
      completionBlock({ functionTest: true, electricalSafety: true, note: 'Ganti sensor SpO2' }),
    ).toBeNull();
  });
});
