import { financingOverviewSchema, orScheduleSchema, paymentOverviewSchema } from '@simrs/shared';
import { describe, expect, it } from 'vitest';
import { creditedAmount } from './btn';
import {
  demoFinancingOverview,
  demoOrSchedule,
  demoPaymentOverview,
  depositTransaction,
  scenarioClaim,
  scenarioInstalment,
  scenarioReconRows,
  taskDone,
} from './btn-skenario';
import { FASILITAS } from './demo/fixtures/btn';
import { applyAction, defaultValue, firstOpenTask, runScenario } from './demo/engine/run';
import type { RunResult, ScenarioEvent } from './demo/engine/types';
import { ELEKTIF_BTN } from './demo/skenario/elektif-btn';

/**
 * Putar skenario elektif dengan nilai bawaan (atau pilihan `choices`, kunci `langkah.tugas`) sampai `until`
 * terpenuhi. Memakai aturan gerbang mesin yang sama dengan presenter (`applyAction`).
 */
function play(until: (R: RunResult) => boolean, choices: Record<string, string> = {}): RunResult {
  let seq: ScenarioEvent[] = [];
  for (let guard = 0; guard < 400; guard++) {
    const R = runScenario(ELEKTIF_BTN, seq);
    if (until(R) || R.finished) return R;
    const open = firstOpenTask(R, R.step);
    const stepId = ELEKTIF_BTN.steps[R.step]?.id ?? '';
    const r = open
      ? applyAction(ELEKTIF_BTN, seq, {
          type: 'task',
          step: R.step,
          task: open.id,
          value: choices[`${stepId}.${open.id}`] ?? defaultValue(open, R.rec) ?? true,
        })
      : applyAction(ELEKTIF_BTN, seq, { type: 'next' });
    if (!r.ok) throw new Error(r.error);
    seq = r.seq;
  }
  throw new Error('skenario tidak selesai');
}

const at = (step: string, task: string) => (R: RunResult) => taskDone(R, step, task);
const fresh = () => runScenario(ELEKTIF_BTN, []);
const finished = () => play(() => false);

describe('data dummy layar TPDI × BTN lolos kontrak ketat', () => {
  it('di awal, di tengah, dan di akhir skenario', () => {
    for (const R of [fresh(), play(at('deposit', 'bayar')), play(at('kasir', 'cair')), finished()]) {
      expect(() => paymentOverviewSchema.parse(demoPaymentOverview(R))).not.toThrow();
      expect(() => financingOverviewSchema.parse(demoFinancingOverview(R))).not.toThrow();
      expect(() => orScheduleSchema.parse(demoOrSchedule(R))).not.toThrow();
    }
  });

  it('jalur QRIS dan tanpa naik kelas juga lolos kontrak', () => {
    const qris = play(() => false, {
      'deposit.kanal': 'qris',
      'kasir.cara': 'qris',
      'pembiayaan.ajukan': 'tidak',
    });
    expect(() => paymentOverviewSchema.parse(demoPaymentOverview(qris))).not.toThrow();
    expect(() => financingOverviewSchema.parse(demoFinancingOverview(qris))).not.toThrow();
    const hak = play(() => false, { 'admisi.kelas': 'hak' });
    expect(depositTransaction(hak)).toBeNull();
    expect(scenarioInstalment(hak)).toBeNull();
  });
});

describe('deposit Ny. Ratna mengikuti langkah deposit', () => {
  it('belum ada sebelum SEP admisi; draf → menunggu → kredit BTN → lunas; webhook ganda tidak dihitung dua kali', () => {
    expect(depositTransaction(fresh())).toBeNull();
    expect(depositTransaction(play(at('admisi', 'sep')))?.status).toBe('draf');
    const made = depositTransaction(play(at('deposit', 'buat')));
    expect(made).toMatchObject({ status: 'menunggu', reference: '8808 0127 0005 2031', amount: '3000000' });
    const paid = depositTransaction(play(at('deposit', 'bayar')));
    expect(paid?.status).toBe('menunggu');
    expect(paid?.trail.some((s) => s.label === 'Kredit BTN ••••4417' && s.state === 'selesai')).toBe(true);
    const hooked = depositTransaction(play(at('deposit', 'webhook')));
    expect(hooked?.status).toBe('lunas');
    expect(hooked?.webhooks).toHaveLength(1);
    expect(hooked?.webhooks[0]?.signatureValid).toBe(true);
    const dupe = depositTransaction(play(at('deposit', 'dupe')));
    expect(dupe?.webhooks.map((w) => w.duplicate)).toEqual([false, true]);
    expect(creditedAmount(dupe?.webhooks ?? [])).toBe(3_000_000n);
  });

  it('kanal QRIS memakai referensi QR', () => {
    const R = play(at('deposit', 'buat'), { 'deposit.kanal': 'qris' });
    expect(depositTransaction(R)).toMatchObject({ channel: 'QRIS', reference: 'QR-2610-90412' });
  });
});

describe('rekonsiliasi pasien skenario', () => {
  it('deposit + pencairan cicilan menunggu data, lalu cocok di tiga sumber', () => {
    const before = scenarioReconRows(play(at('kasir', 'pulang')));
    expect(before.map((r) => r.status)).toEqual(['menunggu-data', 'menunggu-data']);
    const pulled = scenarioReconRows(play(at('rekonsiliasi', 'tarik')));
    expect(pulled.every((r) => r.status === 'belum-dicocokkan' && r.bank.amount !== null)).toBe(true);
    const matched = scenarioReconRows(play(at('rekonsiliasi', 'cocok')));
    expect(matched.map((r) => [r.status, r.kasir.amount, r.bank.amount])).toEqual([
      ['cocok', '3000000', '3000000'],
      ['cocok', '6400000', '6400000'],
    ]);
    expect(matched[0]?.tpdi.amount).toBe('3000000');
  });

  it('jalur QRIS: pelunasan sisa juga tercatat di laporan TPDI', () => {
    const rows = scenarioReconRows(play(at('rekonsiliasi', 'cocok'), { 'kasir.cara': 'qris' }));
    expect(rows.map((r) => r.id)).toEqual(['skenario-deposit', 'skenario-qris']);
    expect(rows[1]?.tpdi.amount).toBe('6400000');
  });
});

describe('pembiayaan Ny. Ratna', () => {
  it('cicilan muncul setelah diajukan, tahap mengikuti kasir; tenor dari pilihan', () => {
    expect(scenarioInstalment(play(at('kasir', 'tenor')))).toBeNull();
    expect(scenarioInstalment(play(at('kasir', 'ajukan')))?.stage).toBe('verifikasi');
    expect(scenarioInstalment(play(at('kasir', 'setuju')))?.stage).toBe('akad');
    const cair = scenarioInstalment(play(at('kasir', 'cair'), { 'kasir.tenor': '12' }));
    expect(cair).toMatchObject({ stage: 'dicairkan', amount: '6400000', tenorMonths: 12 });
  });

  it('klaim Rp 7.140.000: advance 90% Rp 6.426.000, pelunasan Rp 6.455.600, sisa Rp 684.400', () => {
    expect(scenarioClaim(play(at('klaim', 'kirim')), FASILITAS)).toBeNull();
    expect(scenarioClaim(play(at('klaim', 'layak')), FASILITAS)?.stage).toBe('layak');
    expect(scenarioClaim(play(at('pembiayaan', 'pool')), FASILITAS)?.stage).toBe('di-pool');
    expect(scenarioClaim(play(at('pembiayaan', 'cair')), FASILITAS)).toMatchObject({
      stage: 'dicairkan',
      advance: '6426000',
      decision: 'ya',
    });
    const paid = scenarioClaim(finished(), FASILITAS);
    expect(paid?.repayment).toEqual({
      bpjsPaid: '7140000',
      principal: '6426000',
      margin: '29600',
      days: 21,
      forwarded: '684400',
    });
    const wait = scenarioClaim(
      play(() => false, { 'pembiayaan.ajukan': 'tidak' }),
      FASILITAS,
    );
    expect(wait?.repayment?.forwarded).toBe('7140000');
  });
});

describe('kasus kamar operasi Ny. Ratna', () => {
  const ratna = (R: RunResult) =>
    demoOrSchedule(R)
      .rooms.flatMap((r) => r.cases)
      .find((c) => c.scenario);
  it('dasar: time out berjalan; tilik → semua fase lengkap; op → selesai; pulih → kembali ke kamar', () => {
    const base = ratna(fresh());
    expect(base?.checklist.map((p) => !!p.confirmedAt)).toEqual([true, false, false]);
    expect(base?.icd9cm).toBe('51.23');
    const tilik = ratna(play(at('operasi', 'tilik')));
    expect(tilik?.checklist.every((p) => p.confirmedAt && p.items.every((i) => i.checked))).toBe(true);
    expect(tilik?.status).toBe('berjalan');
    expect(ratna(play(at('operasi', 'op')))?.status).toBe('selesai');
    expect(ratna(play(at('operasi', 'pulih')))?.statusNote).toContain('kembali ke kamar');
  });
});
