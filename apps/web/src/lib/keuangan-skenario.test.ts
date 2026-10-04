import {
  accountingBoardSchema,
  claimBoardSchema,
  type JournalEntry,
  journalBalanced,
  kasirBoardSchema,
} from '@simrs/shared';
import { describe, expect, it } from 'vitest';
import { KLAIM_AMOUNT, scenarioClaim as financedClaim } from './btn-skenario';
import { FASILITAS } from './demo/fixtures/btn';
import { CBG } from './demo/fixtures/keuangan';
import { advanceTo, applyAction, runScenario } from './demo/engine/run';
import { billSummary } from './demo/engine/summary';
import type { ScenarioEvent, ScenarioId, TaskValue } from './demo/engine/types';
import { SCENARIO_ORDER, SCENARIOS } from './demo/skenario';
import { invoiceTotal } from './keuangan';
import {
  classUpgradeAmount,
  demoAccountingBoard,
  demoClaimBoard,
  defaultSelection,
  demoKasirBoard,
  ELEKTIF_SELISIH_ESTIMASI,
  scenarioClaim,
  scenarioFlow,
  scenarioInvoice,
  scenarioJournals,
  type ScenarioResults,
  stepIndex,
} from './keuangan-skenario';

const base = (): ScenarioResults =>
  Object.fromEntries(SCENARIO_ORDER.map((id) => [id, runScenario(SCENARIOS[id], [])])) as ScenarioResults;

/** Urutan kejadian putar otomatis satu skenario, dari kosong sampai selesai. */
function autoplaySeqs(id: ScenarioId): ScenarioEvent[][] {
  const def = SCENARIOS[id];
  let seq: ScenarioEvent[] = [];
  const out = [seq];
  while (!runScenario(def, seq).finished) {
    const r = applyAction(def, seq, { type: 'auto' });
    if (!r.ok) throw new Error(r.error);
    seq = r.seq;
    out.push(seq);
  }
  return out;
}

/** Putar otomatis sampai langkah `stepId` aktif. */
function reach(id: ScenarioId, stepId: string): ScenarioEvent[] {
  const def = SCENARIOS[id];
  const r = advanceTo(def, [], stepIndex(runScenario(def, []), stepId));
  if (!r.ok) throw new Error(r.error);
  return r.seq;
}

function act(id: ScenarioId, seq: ScenarioEvent[], stepId: string, task: string, value: TaskValue = true) {
  const def = SCENARIOS[id];
  const step = stepIndex(runScenario(def, seq), stepId);
  const r = applyAction(def, seq, { type: 'task', step, task, value });
  if (!r.ok) throw new Error(`${stepId}.${task}: ${r.error}`);
  return r.seq;
}

const run = (id: ScenarioId, seq: ScenarioEvent[]) => runScenario(SCENARIOS[id], seq);
const sumAccount = (js: JournalEntry[], code: string) =>
  js
    .flatMap((j) => j.lines)
    .filter((l) => l.account?.code === code)
    .reduce((s, l) => s + BigInt(l.debit) - BigInt(l.credit), 0n);

describe('proyeksi skenario ke layar keuangan', () => {
  it('di setiap kejadian putar otomatis: ketiga papan lolos kontrak, semua jurnal seimbang', () => {
    for (const id of SCENARIO_ORDER) {
      for (const seq of autoplaySeqs(id)) {
        const results = { ...base(), [id]: run(id, seq) };
        kasirBoardSchema.parse(demoKasirBoard(results));
        claimBoardSchema.parse(demoClaimBoard(results));
        const acc = accountingBoardSchema.parse(demoAccountingBoard(results));
        for (const j of acc.journals) expect(journalBalanced(j.lines), j.number).toBe(true);
      }
    }
  });

  it('rawat jalan: tagihan = R.charges, 8 baris Rp 806.000, BPJS menanggung semua, pasien Rp 0', () => {
    let seq = reach('rawat-jalan', 'kasir');
    let R = run('rawat-jalan', seq);
    const inv = scenarioInvoice('rawat-jalan', R);
    expect(inv?.lines.map((l) => [l.name, BigInt(l.amount), l.source])).toEqual(
      R.charges.map((c) => [c.name, c.amount, c.src]),
    );
    expect(inv?.lines).toHaveLength(8);
    expect(invoiceTotal(inv?.lines ?? [])).toBe(806_000n);
    expect(inv).toMatchObject({ status: 'berjalan', patientDue: '0', queueNo: 'K-015' });
    expect(scenarioFlow(R, 'kasir').tasks.final).toMatchObject({ enabled: true, done: false });
    expect(scenarioFlow(R, 'kasir').tasks.tutup?.enabled).toBe(false);
    seq = act('rawat-jalan', seq, 'kasir', 'final');
    expect(scenarioInvoice('rawat-jalan', run('rawat-jalan', seq))?.status).toBe('final');
    seq = act('rawat-jalan', seq, 'kasir', 'tutup');
    R = run('rawat-jalan', seq);
    expect(scenarioInvoice('rawat-jalan', R)?.status).toBe('lunas');
    expect(billSummary(R)).toEqual({ total: 806_000n, covered: 806_000n, patient: 0n });
    const [j] = scenarioJournals('rawat-jalan', R);
    expect(j?.lines.map((l) => [l.account?.code, l.debit, l.credit])).toEqual([
      ['1-1310', '412300', '0'],
      ['4-1900', '393700', '0'],
      ['4-1100', '0', '806000'],
    ]);
  });

  it('IGD → rawat inap: 13 baris Rp 10.620.000, pasien bayar Rp 0 setelah pulang', () => {
    let seq = reach('igd-ranap', 'kasir');
    const inv = scenarioInvoice('igd-ranap', run('igd-ranap', seq));
    expect(inv?.lines).toHaveLength(13);
    expect(invoiceTotal(inv?.lines ?? [])).toBe(10_620_000n);
    expect(inv?.encounter.kind).toBe('rawat-inap');
    seq = act('igd-ranap', seq, 'kasir', 'final');
    seq = act('igd-ranap', seq, 'kasir', 'pulang');
    const R = run('igd-ranap', seq);
    expect(scenarioInvoice('igd-ranap', R)).toMatchObject({ status: 'lunas', patientDue: '0' });
    expect(billSummary(R).patient).toBe(0n);
  });

  it('elektif: selisih Rp 9.400.000 − deposit Rp 3.000.000 = Rp 6.400.000 dibiayai BTN atau lunas QRIS', () => {
    const atKasir = reach('elektif-btn', 'kasir');
    const inv = scenarioInvoice('elektif-btn', run('elektif-btn', atKasir));
    expect(invoiceTotal(inv?.lines ?? [])).toBe(17_905_000n);
    expect(inv?.split).toMatchObject({ patientShare: '9400000', payerPays: '7140000' });
    expect(inv?.payments.map((p) => [p.kind, p.amount])).toEqual([['deposit', '3000000']]);
    expect(inv?.patientDue).toBe('6400000');

    let seq = act('elektif-btn', atKasir, 'kasir', 'final');
    seq = act('elektif-btn', seq, 'kasir', 'cara', 'cicil');
    seq = act('elektif-btn', seq, 'kasir', 'tenor', '6');
    expect(scenarioFlow(run('elektif-btn', seq), 'kasir').tasks.ajukan?.enabled).toBe(true);
    for (const t of ['ajukan', 'setuju', 'cair']) seq = act('elektif-btn', seq, 'kasir', t);
    let R = run('elektif-btn', seq);
    expect(scenarioInvoice('elektif-btn', R)).toMatchObject({ status: 'lunas', patientDue: '0' });
    expect(billSummary(R).patient).toBe(9_400_000n);

    seq = act('elektif-btn', atKasir, 'kasir', 'final');
    seq = act('elektif-btn', seq, 'kasir', 'cara', 'qris');
    expect(scenarioFlow(run('elektif-btn', seq), 'kasir').tasks.tenor?.visible).toBe(false);
    seq = act('elektif-btn', seq, 'kasir', 'qrisbayar');
    R = run('elektif-btn', seq);
    expect(scenarioInvoice('elektif-btn', R)?.payments.at(-1)).toMatchObject({
      method: 'qris',
      amount: '6400000',
    });
  });

  it('klaim: Tn. Suryo muncul setelah berkas dikirim (E11.9 + E78.5); I20.0 menahan grouping', () => {
    let seq = reach('rawat-jalan', 'pasca');
    expect(scenarioClaim('rawat-jalan', run('rawat-jalan', seq))).toBeNull();
    seq = act('rawat-jalan', seq, 'pasca', 'notif');
    // Jalur bawaan memakai PRB: satu-satunya pilihan kontrol adalah rujuk balik ke FKTP.
    seq = act('rawat-jalan', seq, 'pasca', 'kontrol', 'fktp');
    seq = act('rawat-jalan', seq, 'pasca', 'klaim');
    const suryo = scenarioClaim('rawat-jalan', run('rawat-jalan', seq));
    expect(suryo?.diagnoses.map((d) => d.code)).toEqual(['E11.9', 'E78.5']);
    expect(suryo?.status).toBe('draft');

    let ig = reach('igd-ranap', 'klaim');
    expect(scenarioClaim('igd-ranap', run('igd-ranap', ig))?.tag.label).toBe('Perlu validasi');
    ig = act('igd-ranap', ig, 'klaim', 'utama', 'I20.0');
    let R = run('igd-ranap', ig);
    expect(scenarioClaim('igd-ranap', R)?.grouper).toBeNull();
    expect(scenarioClaim('igd-ranap', R)?.diagnoses[0]?.code).toBe('I20.0');
    expect(scenarioFlow(R, 'klaim').tasks.bukti).toMatchObject({ visible: true, enabled: true });
    ig = act('igd-ranap', ig, 'klaim', 'bukti', 'kembali');
    ig = act('igd-ranap', ig, 'klaim', 'sekunder');
    ig = act('igd-ranap', ig, 'klaim', 'kirim');
    R = run('igd-ranap', ig);
    expect(scenarioClaim('igd-ranap', R)).toMatchObject({
      status: 'sent',
      grouper: { cbg: 'I-4-12-II', final: true },
    });
  });

  it('klaim elektif: terkirim → layak bayar → dibayar', () => {
    let seq = reach('elektif-btn', 'klaim');
    seq = act('elektif-btn', seq, 'klaim', 'kode');
    seq = act('elektif-btn', seq, 'klaim', 'kirim');
    expect(scenarioClaim('elektif-btn', run('elektif-btn', seq))?.status).toBe('sent');
    seq = act('elektif-btn', seq, 'klaim', 'layak');
    expect(scenarioClaim('elektif-btn', run('elektif-btn', seq))?.status).toBe('payable');
    const end = autoplaySeqs('elektif-btn').at(-1) ?? [];
    expect(scenarioClaim('elektif-btn', run('elektif-btn', end))?.status).toBe('paid');
  });

  it('jurnal elektif: menunggu rekonsiliasi lalu terposting; uang muka, piutang BPJS, pembiayaan bersih nol', () => {
    let seq = reach('elektif-btn', 'deposit');
    for (const [t, v] of [
      ['kanal', 'va'],
      ['buat', true],
      ['bayar', true],
      ['webhook', true],
    ] as const) {
      seq = act('elektif-btn', seq, 'deposit', t, v);
    }
    const [dp] = scenarioJournals('elektif-btn', run('elektif-btn', seq));
    expect(dp).toMatchObject({ id: 'ju-ratna-dp', status: 'menunggu-rekonsiliasi', source: 'tpdi-btn' });
    const end = autoplaySeqs('elektif-btn').at(-1) ?? [];
    const js = scenarioJournals('elektif-btn', run('elektif-btn', end));
    expect(js.find((j) => j.id === 'ju-ratna-dp')?.status).toBe('terposting');
    expect(sumAccount(js, '2-1210')).toBe(0n);
    expect(sumAccount(js, '1-1320')).toBe(0n);
    expect(sumAccount(js, '2-1310')).toBe(0n);
    expect(js.some((j) => j.number.startsWith('JU-2611'))).toBe(true);
  });

  it('pilihan bawaan: pasien skenario di layar ini (skenario aktif didahulukan), dikunci ke URL', () => {
    const items = [
      { id: 'umum', scenario: null },
      { id: 'rj', scenario: 'rawat-jalan' as const },
      { id: 'ig', scenario: 'igd-ranap' as const },
    ];
    const [umum, rj, ig] = items;
    expect(defaultSelection(items, ['rawat-jalan', 'igd-ranap'], 'igd-ranap', umum)).toEqual({
      item: ig,
      pin: true,
    });
    expect(defaultSelection(items, ['rawat-jalan'], 'igd-ranap', umum)).toEqual({ item: rj, pin: true });
    expect(defaultSelection(items, [], 'rawat-jalan', umum)).toEqual({ item: umum, pin: true });
    // Skenario di layar ini belum punya baris: tidak dikunci, agar barisnya terpilih begitu muncul.
    expect(defaultSelection(items, ['elektif-btn'], 'elektif-btn', umum)).toEqual({ item: umum, pin: false });
  });

  it('elektif tetap pilihan bawaan Kasir setelah lunas (urutan antrean turun) sampai pasien dipulangkan', () => {
    let seq = reach('elektif-btn', 'kasir');
    for (const [t, v] of [
      ['final', true],
      ['cara', 'cicil'],
      ['tenor', '6'],
      ['ajukan', true],
      ['setuju', true],
      ['cair', true],
    ] as const) {
      seq = act('elektif-btn', seq, 'kasir', t, v);
    }
    const R = run('elektif-btn', seq);
    expect(R.def.steps[R.step]?.screen).toBe('kasir');
    const board = demoKasirBoard({ ...base(), 'elektif-btn': R });
    expect(board.invoices[0]?.id).not.toBe('inv-ratna');
    const def = defaultSelection(board.invoices, ['elektif-btn'], 'elektif-btn', board.invoices[0]);
    expect(def).toMatchObject({ item: { id: 'inv-ratna', status: 'lunas' }, pin: true });
    expect(scenarioFlow(R, 'kasir').tasks.pulang?.enabled).toBe(true);
  });

  it('klaim elektif terkirim tetap pilihan bawaan (tugas layak bayar), berlabel tanggal pulang simulasi', () => {
    let seq = reach('elektif-btn', 'klaim');
    seq = act('elektif-btn', seq, 'klaim', 'kode');
    seq = act('elektif-btn', seq, 'klaim', 'kirim');
    const R = run('elektif-btn', seq);
    const board = demoClaimBoard({ ...base(), 'elektif-btn': R });
    const fallback = board.claims.find((c) => c.status === 'draft');
    const def = defaultSelection(board.claims, ['elektif-btn'], 'elektif-btn', fallback);
    expect(def).toMatchObject({ item: { id: 'kl-ratna', status: 'sent' }, pin: true });
    expect(scenarioFlow(R, 'klaim').tasks.layak?.enabled).toBe(true);
    expect(def.item?.ageLabel).toMatch(/^pulang \w{3} \d{1,2} Okt$/);
  });

  it('jurnal pembiayaan = angka layar Pembiayaan: cair 90% Rp 6.426.000, lunas Rp 6.455.600, sisa Rp 684.400', () => {
    const R = run('elektif-btn', autoplaySeqs('elektif-btn').at(-1) ?? []);
    const fin = financedClaim(R, FASILITAS);
    expect(KLAIM_AMOUNT).toBe(CBG.empeduK2.tariff);
    expect(fin).toMatchObject({ advance: '6426000', repayment: { margin: '29600', forwarded: '684400' } });
    const js = scenarioJournals('elektif-btn', R);
    const lines = (id: string) =>
      js.find((j) => j.id === id)?.lines.map((l) => [l.account?.code, BigInt(l.debit), BigInt(l.credit)]);
    expect(lines('ju-ratna-anjak')).toEqual([
      ['1-1120', 6_426_000n, 0n],
      ['2-1310', 0n, 6_426_000n],
    ]);
    expect(lines('ju-ratna-teruskan')).toEqual([
      ['2-1310', 6_426_000n, 0n],
      ['6-2100', 29_600n, 0n],
      ['1-1130', 0n, 6_455_600n],
      ['1-1120', 684_400n, 0n],
      ['1-1130', 0n, 684_400n],
    ]);
    expect(sumAccount(js, '1-1130')).toBe(0n);
  });

  it('jurnal tanpa pencairan awal: dana BPJS diteruskan penuh, tanpa utang pembiayaan', () => {
    let seq = reach('elektif-btn', 'pembiayaan');
    seq = act('elektif-btn', seq, 'pembiayaan', 'pool');
    seq = act('elektif-btn', seq, 'pembiayaan', 'ajukan', 'tidak');
    seq = act('elektif-btn', seq, 'pembiayaan', 'bpjs');
    const js = scenarioJournals('elektif-btn', run('elektif-btn', seq));
    expect(js.some((j) => j.id === 'ju-ratna-anjak')).toBe(false);
    expect(js.find((j) => j.id === 'ju-ratna-teruskan')?.lines).toHaveLength(2);
    expect(sumAccount(js, '2-1310')).toBe(0n);
    expect(sumAccount(js, '1-1120')).toBeGreaterThanOrEqual(7_140_000n);
  });

  it('selisih naik kelas dari rekam skenario: estimasi admisi = hasil final Rp 9.400.000 − deposit = Rp 6.400.000', () => {
    const atKasir = reach('elektif-btn', 'kasir');
    const before = run('elektif-btn', atKasir);
    expect(before.rec.selisih).toBe(0n);
    expect(classUpgradeAmount(before)).toBe(ELEKTIF_SELISIH_ESTIMASI);
    const after = run('elektif-btn', act('elektif-btn', atKasir, 'kasir', 'final'));
    expect(after.rec.selisih).toBe(ELEKTIF_SELISIH_ESTIMASI);
    const inv = scenarioInvoice('elektif-btn', after);
    expect(inv?.split.classUpgrade?.amount).toBe(after.rec.selisih.toString());
    expect(after.rec.selisih).toBe(9_400_000n);
    expect(after.rec.deposit).toBe(3_000_000n);
    expect(BigInt(inv?.patientDue ?? '0')).toBe(after.rec.selisih - after.rec.deposit);
    expect(inv?.patientDue).toBe('6400000');
  });
});
