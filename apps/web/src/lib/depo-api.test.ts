import type { StockBalance } from '@simrs/shared';
import { describe, expect, it } from 'vitest';
import { depoSummary, expiryLabel, transferableDrugs, transferPlan } from './depo-api';

const LOC = '0199a000-0000-7000-8000-0000000000a1';
const DRUG = '0199a000-0000-7000-8000-0000000000d1';
const bal = (
  id: string,
  batchNo: string,
  expiryDate: string,
  quantity: number,
  over: Partial<StockBalance> = {},
) =>
  ({
    stockLocationId: LOC,
    drugId: DRUG,
    drugName: 'Seftriakson 2 g injeksi',
    kfa: null,
    stockBatchId: `0199a000-0000-7000-8000-0000000000${id}`,
    batchNo,
    expiryDate,
    quantity,
    expiringSoon: false,
    expired: false,
    ...over,
  }) satisfies StockBalance;

const TODAY = '2026-10-07';
const rows = [
  bal('b1', 'SFX-LAMA', '2026-09-27', 20, { expired: true }),
  bal('b2', 'SFX-DEKAT', '2026-11-21', 30, { expiringSoon: true }),
  bal('b3', 'SFX-BARU', '2028-03-30', 100),
];

describe('Depo mode api · FEFO dan ringkasan', () => {
  it('rencana mutasi FEFO melewati batch kedaluwarsa dan memecah lintas batch', () => {
    const plan = transferPlan(rows, DRUG, 40, TODAY);
    expect(plan).toMatchObject({
      ok: true,
      picks: [
        { batchNo: 'SFX-DEKAT', quantity: 30 },
        { batchNo: 'SFX-BARU', quantity: 10 },
      ],
    });
    expect(transferPlan(rows, DRUG, 200, TODAY)).toEqual({
      ok: false,
      message: 'Stok layak hanya 130; batch kedaluwarsa tidak bisa dimutasi.',
    });
    expect(transferPlan(rows, DRUG, 0, TODAY).ok).toBe(false);
  });

  it('ringkasan, stok layak per obat, dan label ED bertulisan', () => {
    expect(depoSummary(rows)).toEqual({ batches: 3, expired: 1, expiringSoon: 1, drugs: 1 });
    expect(transferableDrugs(rows)).toEqual([
      { drugId: DRUG, drugName: 'Seftriakson 2 g injeksi', usable: 130 },
    ]);
    expect(rows.map(expiryLabel)).toEqual(['Kedaluwarsa', 'Segera kedaluwarsa', 'Aman']);
  });
});
