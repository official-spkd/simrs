import { describe, expect, it } from 'vitest';
import { accessUntil, grantBlock, includesMedical } from './akses-keluarga';

describe('I07 · akses keluarga', () => {
  it('butuh lingkup, masa berlaku, dan pernyataan', () => {
    expect(grantBlock([], '30', true)).toMatch(/minimal satu/);
    expect(grantBlock(['jadwal'], '', true)).toMatch(/masa berlaku/);
    expect(grantBlock(['jadwal'], '30', false)).toMatch(/pernyataan/);
    expect(grantBlock(['jadwal'], '30', true)).toBeNull();
  });

  it('data kesehatan disebut eksplisit; masa berlaku dihitung dari hari ini', () => {
    expect(includesMedical(['jadwal', 'tagihan'])).toBe(false);
    expect(includesMedical(['jadwal', 'lab'])).toBe(true);
    expect(accessUntil('2026-10-05', '30')).toBe('2026-11-04');
    expect(accessUntil('2026-10-05', 'cabut')).toBeNull();
  });
});
