import { claimBoardSchema } from '@simrs/shared';
import { describe, expect, it } from 'vitest';
import { runScenario } from './demo/engine/run';
import { CLAIM_TOTALS, CLAIM_KPIS, STATIC_CLAIMS } from './demo/fixtures/keuangan';
import { SCENARIO_ORDER, SCENARIOS } from './demo/skenario';
import { claimRatio, codingView, docCount, missingDocs, submitLabel } from './keuangan-klaim';
import { demoClaimBoard, type ScenarioResults } from './keuangan-skenario';

const fresh = (): ScenarioResults =>
  Object.fromEntries(SCENARIO_ORDER.map((id) => [id, runScenario(SCENARIOS[id], [])])) as ScenarioResults;
const claim = (id: string) => {
  const c = STATIC_CLAIMS.find((x) => x.id === id);
  if (!c) throw new Error(id);
  return c;
};

describe('data dummy Klaim', () => {
  it('lolos kontrak ketat; jumlah per status = klaim bulan ini; setiap status punya contoh', () => {
    const board = claimBoardSchema.parse(demoClaimBoard(fresh()));
    const sum = Object.values(CLAIM_TOTALS).reduce((a, b) => a + b, 0);
    expect(sum).toBe(CLAIM_KPIS.claimsMonth.total);
    for (const s of ['draft', 'sent', 'pending', 'payable', 'dispute', 'paid'] as const) {
      expect(
        board.claims.some((c) => c.status === s),
        s,
      ).toBe(true);
    }
  });

  it('Ny. Endang: terima J13 + bukti N17.9 → J-4-15-III Rp 9.104.300 (naik Rp 2.491.500)', () => {
    const c = claim('kl-endang');
    const before = codingView(c, { accepted: false, docs: c.documents });
    expect(before.grouper?.cbg).toBe('J-4-15-II');
    expect(before.diagnoses.map((d) => d.code)).toEqual(['J18.9', 'E11.9', 'N17.9']);
    const accepted = codingView(c, { accepted: true, docs: c.documents });
    expect(accepted.diagnoses[0]?.code).toBe('J13');
    expect(accepted.grouper?.cbg).toBe('J-4-15-II');
    expect(accepted.tiles[2]).toMatchObject({ k: 'Jika N17.9 terbukti', tone: 'warn' });
    const docs = c.documents.map((d) => (d.id === 'bukti-n17' ? { ...d, ok: true } : d));
    const both = codingView(c, { accepted: true, docs });
    expect(both.grouper).toMatchObject({ cbg: 'J-4-15-III', tariff: '9104300' });
    expect(both.diagnoses[2]?.role).toBe('sekunder');
    expect(both.tiles[2]?.s).toBe('Rp 6.612.800 · naik Rp 2.491.500');
  });

  it('grouping ditahan bila resume belum final atau pasien masih dirawat', () => {
    expect(codingView(claim('kl-bonifasius-ri'), { accepted: false, docs: [] }).held).toMatch(/resume/);
    expect(codingView(claim('kl-raka'), { accepted: false, docs: [] }).held).toMatch(/masih dirawat/);
  });

  it('tarif RS vs INA-CBG (bigint) dan gerbang kirim', () => {
    expect(claimRatio('19870000', '9104300')).toMatchObject({ percent: 218, overrun: true, cbgWidth: 46 });
    expect(claimRatio('950000', '1006500')).toMatchObject({ overrun: false, cbgWidth: 100, gap: -56_500n });
    expect(claimRatio(null, '1')).toBeNull();
    expect(submitLabel('draft')).toBe('Final dan kirim E-Klaim');
    expect(submitLabel('payable')).toBeNull();
    const docs = claim('kl-aminah').documents;
    expect(missingDocs(docs)).toHaveLength(3);
    expect(docCount(docs)).toBe('1/4 lengkap');
  });
});
