import { describe, expect, it } from 'vitest';
import {
  BUNDLE_AUDITS,
  HAI_MONTH,
  handHygieneObservations,
  ISOLATION_ROOMS,
  ppeAudits,
} from './demo/fixtures/ppi';
import {
  bundleCompliant,
  bundleRate,
  confirmBlock,
  formatRate,
  HAI_DEFS,
  haiOnTarget,
  haiRate,
  hhByProfession,
  hhCompliance,
  roomBlock,
} from './ppi';

describe('B07 · surveilans HAIs', () => {
  it('laju per 1.000 hari alat atau per 100 operasi, 1 desimal; penyebut nol = tanpa laju', () => {
    expect(haiRate(1, 128, 1000)).toBe(7.8);
    expect(haiRate(1, 64, 100)).toBe(1.6);
    expect(haiRate(3, 1180, 1000)).toBe(2.5);
    expect(haiRate(0, 0, 1000)).toBeNull();
    expect(formatRate(7.8, '‰')).toBe('7,8‰');
    expect(formatRate(null, '‰')).toBe('—');
  });

  it('fixture: hanya VAP di atas sasaran', () => {
    const over = HAI_DEFS.filter(
      (d) => !haiOnTarget(haiRate(HAI_MONTH[d.id].cases, HAI_MONTH[d.id].denominator, d.per), d.target),
    );
    expect(over.map((d) => d.id)).toEqual(['vap']);
  });

  it('konfirmasi butuh semua kriteria', () => {
    expect(confirmBlock('vap', [true, true, false])).toMatch(/2\/3/);
    expect(confirmBlock('vap', [true, true, true])).toBeNull();
  });
});

describe('B07 · kepatuhan', () => {
  it('kebersihan tangan bulan berjalan = 88% (sama dengan Dasbor), per profesi', () => {
    const obs = handHygieneObservations();
    expect(hhCompliance(obs)).toEqual({ done: 352, total: 400, pct: 88 });
    expect(hhByProfession(obs).find((r) => r.profession === 'Dokter')).toMatchObject({
      done: 98,
      total: 120,
      pct: 82,
    });
    expect(hhCompliance([]).pct).toBeNull();
  });

  it('APD 96%; bundle all-or-none', () => {
    const ppe = ppeAudits();
    expect(ppe.filter((a) => a.compliant).length / ppe.length).toBe(0.96);
    expect(bundleCompliant([true, true, true])).toBe(true);
    expect(bundleCompliant([true, false, true])).toBe(false);
    expect(bundleCompliant([])).toBe(false);
    const vap = BUNDLE_AUDITS.vap ?? { total: 0, compliant: 0 };
    expect(bundleRate(Array.from({ length: vap.total }, (_, i) => ({ compliant: i < vap.compliant })))).toBe(
      67,
    );
    expect(bundleRate([])).toBeNull();
  });
});

describe('B07 · isolasi', () => {
  it('airborne wajib tekanan negatif; ruang terisi ditolak', () => {
    const neg = ISOLATION_ROOMS.find((r) => r.negativePressure && !r.occupiedBy);
    const std = ISOLATION_ROOMS.find((r) => !r.negativePressure && !r.occupiedBy);
    const full = ISOLATION_ROOMS.find((r) => r.occupiedBy);
    expect(roomBlock('airborne', std)).toMatch(/tekanan negatif/);
    expect(roomBlock('airborne', neg)).toBeNull();
    expect(roomBlock('kontak', std)).toBeNull();
    expect(roomBlock('kontak', full)).toMatch(/terisi/);
    expect(roomBlock('kontak', undefined)).toMatch(/Pilih/);
  });
});
