import { describe, expect, it } from 'vitest';
import { KASUS_COSTING } from './demo/fixtures/costing';
import { CBG } from './demo/fixtures/keuangan';
import { costShares, hari, losVariance, marginBy, totalView, unitCost } from './keuangan-costing';

const k = (id: string) => {
  const x = KASUS_COSTING.find((y) => y.id === id);
  if (!x) throw new Error(id);
  return x;
};

describe('costing dan case-mix', () => {
  it('tarif INA-CBG sama dengan tarif simulasi bersama (Kasir/Klaim)', () => {
    const tariffs = new Set(Object.values(CBG).map((c) => `${c.code}|${c.classLabel}|${c.tariff}`));
    for (const r of KASUS_COSTING)
      expect(tariffs.has(`${r.cbg.code}|${r.cbg.classLabel}|${r.tariff}`), r.id).toBe(true);
  });

  it('margin per kelompok dan per DPJP berjumlah sama dengan total', () => {
    const total = totalView(KASUS_COSTING);
    for (const by of ['cbg', 'dpjp'] as const) {
      const rows = marginBy(KASUS_COSTING, by);
      expect(
        rows.reduce((s, r) => s + r.margin, 0n),
        by,
      ).toBe(total.margin);
      expect(
        rows.reduce((s, r) => s + r.cases, 0),
        by,
      ).toBe(total.cases);
      const margins = rows.map((r) => r.margin);
      expect(margins).toEqual([...margins].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    }
  });

  it('pneumonia sedang dr. Andini rugi per kasus; dr. Rahmat untung (kode sama)', () => {
    expect(CBG.pneumoniaSedangK2.tariff - unitCost(k('cs-1'))).toBe(-607_200n);
    expect(CBG.pneumoniaSedangK2.tariff - unitCost(k('cs-2')) > 0n).toBe(true);
  });

  it('porsi komponen = 100%; varians lama rawat jadi biaya yang bisa dihindari', () => {
    for (const r of KASUS_COSTING) {
      if (unitCost(r) > 0n)
        expect(
          costShares(r).reduce((s, c) => s + c.pct, 0),
          r.id,
        ).toBe(100);
    }
    const v = losVariance(k('cs-1'));
    expect(v?.extraTenths).toBe(8);
    expect(v?.avoidablePerCase).toBe((((2_610_000n * 10n) / 58n) * 8n) / 10n);
    expect(losVariance(k('cs-2'))).toBeNull();
    expect(hari(58)).toBe('5,8 hari');
  });
});
