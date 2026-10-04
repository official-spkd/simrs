import { describe, expect, it } from 'vitest';
import { fitScale } from './fit-scale';

describe('fitScale', () => {
  it('anjungan potret di laptop 1366×768: dibatasi tinggi', () => {
    expect(fitScale(1366, 768, 1080, 1920)).toBeCloseTo((768 - 32) / 1920, 5);
  });

  it('TV 1920×1080 di layar 1920×1080: sedikit mengecil karena margin; di layar 2560×1440 membesar', () => {
    expect(fitScale(1920, 1080, 1920, 1080)).toBeLessThan(1);
    expect(fitScale(2560, 1440, 1920, 1080)).toBeGreaterThan(1.3);
  });

  it('nilai tidak sah tetap aman', () => {
    expect(fitScale(0, 0, 1080, 1920)).toBe(0.1);
    expect(fitScale(800, 600, 0, 0)).toBe(1);
  });
});
