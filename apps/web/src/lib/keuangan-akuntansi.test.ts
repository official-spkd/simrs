import { accountingBoardSchema, journalBalanced } from '@simrs/shared';
import { describe, expect, it } from 'vitest';
import { runScenario } from './demo/engine/run';
import {
  ACCOUNTING_KPIS,
  AGING,
  BANK_RECON,
  BPJS_TRANSFER_JOURNAL_ID,
  STATIC_JOURNALS,
} from './demo/fixtures/keuangan';
import { SCENARIO_ORDER, SCENARIOS } from './demo/skenario';
import { agingView, closeReadiness, formatJuta, journalTotals } from './keuangan-akuntansi';
import { demoAccountingBoard, type ScenarioResults } from './keuangan-skenario';

const fresh = (): ScenarioResults =>
  Object.fromEntries(SCENARIO_ORDER.map((id) => [id, runScenario(SCENARIOS[id], [])])) as ScenarioResults;

describe('data dummy Akuntansi', () => {
  it('lolos kontrak ketat; setiap jurnal seimbang (debit = kredit, satu sisi per baris)', () => {
    const board = accountingBoardSchema.parse(demoAccountingBoard(fresh()));
    for (const j of board.journals) {
      const t = journalTotals(j.lines);
      expect(t.debit, j.number).toBe(t.credit);
      expect(journalBalanced(j.lines)).toBe(true);
    }
    expect(
      journalBalanced([
        { debit: '100', credit: '0' },
        { debit: '0', credit: '90' },
      ]),
    ).toBe(false);
    expect(journalBalanced([{ debit: '100', credit: '100' }])).toBe(false);
  });

  it('sumber jurnal mencakup kasir, klaim, TPDI/BTN, logistik; satu perlu pemetaan', () => {
    expect(new Set(STATIC_JOURNALS.map((j) => j.source))).toEqual(
      new Set(['kasir', 'klaim', 'tpdi-btn', 'logistik']),
    );
    expect(STATIC_JOURNALS.filter((j) => j.status === 'perlu-pemetaan')).toHaveLength(1);
  });

  it('transfer BPJS yang belum dipadankan = jumlah mutasi selisih rekening penampungan', () => {
    const transfer = STATIC_JOURNALS.find((j) => j.id === BPJS_TRANSFER_JOURNAL_ID);
    const recon = BANK_RECON.find((b) => b.id === 'btn-klaim');
    const unmatched = (recon?.unmatched ?? []).reduce((s, u) => s + BigInt(u.amount), 0n);
    expect(transfer?.status).toBe('menunggu-rekonsiliasi');
    expect(journalTotals(transfer?.lines ?? []).debit).toBe(unmatched);
    expect(unmatched).toBe(1_820_000_000n);
  });

  it('umur piutang: porsi per kelompok berjumlah 100%; total BPJS = KPI piutang BPJS', () => {
    for (const row of AGING) expect(agingView(row).shares.reduce((a, b) => a + b, 0)).toBe(100);
    const bpjs = AGING.find((r) => r.payer === 'bpjs');
    if (!bpjs) throw new Error('aging bpjs');
    expect(agingView(bpjs)).toMatchObject({
      total: BigInt(ACCOUNTING_KPIS.bpjsReceivable),
      shares: [58, 27, 11, 4],
    });
    expect(formatJuta(agingView(bpjs).total)).toBe('21.412');
  });

  it('tutup periode hanya bila semua jurnal terpetakan dan bank cocok', () => {
    expect(closeReadiness({ unmapped: ['JU-26100417'], unmatchedAccounts: ['BTN ••••9021'] })).toEqual({
      ready: false,
      reason: 'Belum bisa ditutup: petakan akun JU-26100417 dan padankan selisih BTN ••••9021.',
    });
    expect(closeReadiness({ unmapped: [], unmatchedAccounts: [] }).ready).toBe(true);
  });
});
