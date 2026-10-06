import { describe, expect, it } from 'vitest';
import { demoKemenkesReports } from './demo/fixtures/integrasi-kemenkes';
import { BANGSAL } from './demo/fixtures/rs';
import { applyFix, receiptNo, sendGate, validateReport } from './integrasi-kemenkes';

const report = (id: string) => {
  const r = demoKemenkesReports().find((x) => x.id === id);
  if (!r) throw new Error(id);
  return r;
};

describe('laporan Kemenkes', () => {
  it('RS Online sama dengan kapasitas bangsal; sudah terkirim (idempoten)', () => {
    const r = report('rso-bed');
    const free = BANGSAL.reduce((a, b) => a + b.beds - b.occupied, 0);
    expect(r.rows.reduce((a, x) => a + x.value, 0)).toBe(free);
    expect(sendGate(r)).toBe('ALREADY_SENT');
  });

  it('kunjungan RJ: total = Σ rincian → siap kirim; total salah → validasi gagal', () => {
    const r = report('sirs-rj');
    expect(sendGate(r)).toBeNull();
    const broken = { ...r, declaredTotal: (r.declaredTotal ?? 0) + 1 };
    expect(validateReport(broken).find((c) => c.id === 'total')?.ok).toBe(false);
    expect(sendGate(broken)).toBe('VALIDATION');
  });

  it('rawat inap tertahan cara keluar; setelah dilengkapi bisa dikirim', () => {
    const r = report('sirs-ri');
    expect(sendGate(r)).toBe('VALIDATION');
    expect(sendGate(applyFix(r, 'cara-keluar'))).toBeNull();
  });

  it('laporan tanpa sumber data belum tersedia; nomor tanda terima', () => {
    expect(sendGate(report('sirs-morb'))).toBe('NOT_AVAILABLE');
    expect(receiptNo(report('sirs-rj'), 7)).toBe('SIRS-2610-0007');
  });
});
