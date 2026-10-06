import { describe, expect, it } from 'vitest';
import { AMS_REQUESTS, GYSSENS_DONE } from './demo/fixtures/ppra';
import { DEMO_NOW } from './demo/fixtures/waktu';
import {
  appropriateRate,
  approvalHoursLeft,
  decisionBlock,
  GYSSENS_STEPS,
  gyssensResult,
  orderHold,
} from './ppra';

describe('B08 · persetujuan antibiotik', () => {
  it('hanya antibiotik cadangan yang ditahan, dan hanya bila modul aktif', () => {
    expect(orderHold('cadangan', true)).toBe('ditahan');
    expect(orderHold('cadangan', false)).toBe('langsung');
    expect(orderHold('pengawasan', true)).toBe('langsung');
  });

  it('kedaluwarsa 24 jam sejak diminta; fixture: satu mendesak, satu kedaluwarsa', () => {
    const h = AMS_REQUESTS.map((r) => approvalHoursLeft(r.requestedAt, DEMO_NOW));
    expect(h).toEqual([21, 2, -2]);
  });

  it('putusan wajib alasan; tolak wajib alternatif', () => {
    expect(decisionBlock('setuju', 'pendek', '')).toMatch(/10 huruf/);
    expect(decisionBlock('setuju', 'Sepsis berat, riwayat ESBL', '')).toBeNull();
    expect(decisionBlock('tolak', 'Belum ada bukti MRSA', '')).toMatch(/alternatif/);
    expect(decisionBlock('tolak', 'Belum ada bukti MRSA', 'Sefazolin')).toBeNull();
  });
});

describe('B08 · Gyssens', () => {
  it('berhenti pada "Ya" pertama; lolos semua = kategori 0', () => {
    expect(gyssensResult([])).toEqual({ done: false, next: 0 });
    expect(gyssensResult([true])).toEqual({ done: true, category: 'VI' });
    expect(gyssensResult([false, false, false, false, false, false, true])).toEqual({
      done: true,
      category: 'IIIA',
    });
    expect(gyssensResult(GYSSENS_STEPS.map(() => false))).toEqual({ done: true, category: '0' });
  });

  it('persentase penggunaan tepat', () => {
    expect(appropriateRate(GYSSENS_DONE)).toBe(60);
    expect(appropriateRate([])).toBeNull();
  });
});
