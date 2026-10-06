import { describe, expect, it } from 'vitest';
import { CHEMO_PLAN, PRE_CHEMO_LABS } from './demo/fixtures/onkologi';
import { addDays, adjustmentBlock, doseMg, labFailures, mosteller, verifierBlock } from './onkologi';

describe('B11 · onkologi', () => {
  it('LPT Mosteller (golden) dan dosis mg/m²', () => {
    expect(mosteller(158, 54)).toBe(1.54);
    expect(mosteller(170, 70)).toBe(1.82);
    expect(mosteller(0, 70)).toBe(0);
    expect(doseMg(85, 1.54)).toBe(131);
    expect(doseMg(2400, 1.54)).toBe(3696);
    expect(doseMg(85, 1.54, 80)).toBe(105);
  });

  it('penyesuaian dosis < 100% wajib alasan', () => {
    expect(adjustmentBlock(100, '')).toBeNull();
    expect(adjustmentBlock(80, 'neuropati')).toMatch(/alasan/);
    expect(adjustmentBlock(80, 'Neuropati perifer derajat 2')).toBeNull();
  });

  it('gerbang lab: neutrofil di bawah ambang', () => {
    expect(labFailures(PRE_CHEMO_LABS).map((l) => l.label)).toEqual(['Neutrofil absolut']);
  });

  it('verifikasi ganda: dua verifikator berbeda, bukan penulis order', () => {
    const w = CHEMO_PLAN.writer;
    expect(verifierBlock(w, null, null, 1)).toMatch(/Pilih/);
    expect(verifierBlock(w, w, null, 1)).toMatch(/penulis/);
    expect(verifierBlock(w, 'A', null, 1)).toBeNull();
    expect(verifierBlock(w, 'A', 'A', 2)).toMatch(/kedua/);
    expect(verifierBlock(w, 'A', 'B', 2)).toBeNull();
  });

  it('jadwal siklus berikutnya', () => {
    expect(addDays(CHEMO_PLAN.lastCycleDate, CHEMO_PLAN.intervalDays)).toBe('2026-10-08');
  });
});
