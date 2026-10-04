import { accountingBoardSchema, journalBalanced } from '@simrs/shared';
import { describe, expect, it } from 'vitest';
import { applyAction, runScenario } from './demo/engine/run';
import type { ScenarioEvent } from './demo/engine/types';
import {
  ACCOUNTING_KPIS,
  AGING,
  BANK_RECON,
  BPJS_TRANSFER_JOURNAL_ID,
  DISPUTE_JOURNAL_ID,
  STATIC_JOURNALS,
} from './demo/fixtures/keuangan';
import { SCENARIO_ORDER, SCENARIOS } from './demo/skenario';
import {
  agingView,
  closeReadiness,
  formatJuta,
  journalTotals,
  needsMapping,
  periodCloseCheck,
} from './keuangan-akuntansi';
import { demoAccountingBoard, inPeriod, type ScenarioResults, scenarioJournals } from './keuangan-skenario';

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

  it('tutup periode diperiksa terhadap papan server: id terpetakan/terpadan, bukan hitungan klien', () => {
    const board = demoAccountingBoard(fresh());
    expect(board.journals.filter(needsMapping).map((j) => j.id)).toEqual([DISPUTE_JOURNAL_ID]);
    const none = { mappedJournalIds: [], matchedAccountIds: [] };
    expect(periodCloseCheck(board, none).reason).toBe(
      'Belum bisa ditutup: petakan akun JU-26100417 dan padankan selisih BTN ••••9021.',
    );
    expect(periodCloseCheck(board, { ...none, mappedJournalIds: [DISPUTE_JOURNAL_ID] }).ready).toBe(false);
    expect(
      periodCloseCheck(board, { ...none, mappedJournalIds: ['ju-wahyuni'], matchedAccountIds: ['btn-ops'] }),
    ).toMatchObject({ ready: false });
    expect(
      periodCloseCheck(board, { mappedJournalIds: [DISPUTE_JOURNAL_ID], matchedAccountIds: ['btn-klaim'] }),
    ).toEqual({ ready: true, reason: '' });
  });

  it('periode berjalan hanya memuat jurnal skenario bertanggal Oktober (lini masa elektif sampai November)', () => {
    const def = SCENARIOS['elektif-btn'];
    let seq: ScenarioEvent[] = [];
    while (!runScenario(def, seq).finished) {
      const r = applyAction(def, seq, { type: 'auto' });
      if (!r.ok) throw new Error(r.error);
      seq = r.seq;
    }
    const results = { ...fresh(), 'elektif-btn': runScenario(def, seq) };
    const all = scenarioJournals('elektif-btn', results['elektif-btn']);
    const november = all.filter((j) => !inPeriod(j, '2026-10'));
    expect(november.map((j) => j.id).sort()).toEqual(['ju-ratna-bpjs', 'ju-ratna-teruskan']);
    expect(november.every((j) => j.number.startsWith('JU-2611'))).toBe(true);
    const board = accountingBoardSchema.parse(demoAccountingBoard(results));
    expect(board.journals.some((j) => j.number.startsWith('JU-2611'))).toBe(false);
    expect(board.journals.filter((j) => j.scenario)).toHaveLength(all.length - november.length);
    expect(board.journalCount).toBe(2416 + all.length - november.length);
    expect(board.bankRecon.find((b) => b.id === 'btn-ops')?.note).toMatch(
      /\(simulasi, \w{3} \d{1,2} Okt · \d{2}\.\d{2}\)/,
    );
    const times = board.journals.map((j) => Date.parse(j.date));
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });
});
