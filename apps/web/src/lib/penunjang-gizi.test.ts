import { describe, expect, it } from 'vitest';
import { demoDeliveries, demoDietOrders } from './demo/fixtures/penunjang-gizi';
import {
  allergyConflict,
  averageLeftover,
  deliveryGate,
  mstScore,
  trayLabel,
  wardSummary,
} from './penunjang-gizi';

const order = (id: string) => {
  const o = demoDietOrders().find((x) => x.id === id);
  if (!o) throw new Error(id);
  return o;
};

describe('skrining gizi (MST)', () => {
  it('skor ≥ 2 berisiko malnutrisi', () => {
    expect(mstScore('tidak', false)).toEqual({ score: 0, atRisk: false });
    expect(mstScore('1-5', true)).toEqual({ score: 2, atRisk: true });
    expect(mstScore('tidak-yakin', false).atRisk).toBe(true);
    expect(mstScore('>15', true).score).toBe(5);
  });
});

describe('gerbang distribusi makan', () => {
  it('alergi udang Ny. Wulan: menu siang ditahan sampai diganti atau ada alasan', () => {
    const w = order('gz-03');
    expect(allergyConflict(w.menus.siang, w.foodAllergies)).toEqual(['udang']);
    expect(deliveryGate(w, 'siang', { substituted: false })).toBe('ALLERGY');
    expect(deliveryGate(w, 'siang', { substituted: true })).toBeNull();
    expect(deliveryGate(w, 'siang', { substituted: false, overrideReason: 'pendek' })).toBe(
      'OVERRIDE_REASON',
    );
    expect(
      deliveryGate(w, 'siang', {
        substituted: false,
        overrideReason: 'Udang diganti dapur sendiri, sudah dicek',
      }),
    ).toBeNull();
    expect(trayLabel(w, 'siang', true)).toContain('ALERGI UDANG');
  });

  it('pasien puasa tidak pernah diantar; order belum diverifikasi ditahan', () => {
    expect(
      deliveryGate(order('gz-05'), 'siang', { substituted: false, overrideReason: 'apa pun alasannya' }),
    ).toBe('NPO');
    expect(deliveryGate(order('gz-04'), 'siang', { substituted: false })).toBe('ORDER_UNVERIFIED');
    expect(deliveryGate(order('gz-01'), 'siang', { substituted: false })).toBeNull();
  });

  it('ringkasan jam makan siang dan rata-rata sisa makan pagi', () => {
    expect(wardSummary(demoDietOrders(), 'siang')).toEqual({ trays: 5, npo: 1, unverified: 1, allergy: 1 });
    expect(averageLeftover(Object.values(demoDeliveries()))).toBe(30);
    expect(averageLeftover([])).toBeNull();
  });
});
