import { describe, expect, it } from 'vitest';
import { SCENARIOS } from '../skenario';
import { formatSimClock, formatSimDuration } from './format';
import { advanceTo, applyAction, runScenario, sanitizeSeq, taskKey, visibleTasks } from './run';
import { billSummary, bpjsQueueTasks, recordRows, scenarioSummary } from './summary';
import type { ScenarioDef, ScenarioEvent } from './types';

/** Putar otomatis sampai selesai (nilai bawaan tiap tugas), seperti tombol "Putar otomatis" di mockup. */
function autoplay(def: ScenarioDef): ScenarioEvent[] {
  let seq: ScenarioEvent[] = [];
  for (let i = 0; i < 500; i++) {
    if (runScenario(def, seq).finished) return seq;
    const r = applyAction(def, seq, { type: 'auto' });
    if (!r.ok) throw new Error(r.error);
    seq = r.seq;
  }
  throw new Error('putar otomatis tidak selesai');
}

const RJ = SCENARIOS['rawat-jalan'];
const IGD = SCENARIOS['igd-ranap'];
const BTN = SCENARIOS['elektif-btn'];

describe('golden: putar otomatis sama dengan mockup Simulasi', () => {
  it('rawat jalan BPJS: pulang 10.29, selesai 10.33, 8 baris Rp 806.000, pasien bayar Rp 0', () => {
    const R = runScenario(RJ, autoplay(RJ));
    expect(R.finished).toBe(true);
    expect(formatSimClock(RJ, R.rec.pulangAt ?? 0)).toBe('10.29');
    expect(formatSimClock(RJ, R.clock)).toBe('10.33');
    const s = scenarioSummary(R);
    expect(formatSimDuration(s.lengthOfStay)).toBe('3 j 19 mnt');
    expect(s.waitMinutes).toBe(86);
    expect(s.waitPercent).toBe(42);
    expect(s.chargeLines).toBe(8);
    expect(billSummary(R)).toEqual({ total: 806_000n, covered: 806_000n, patient: 0n });
    expect(R.rec.obat).toEqual(['Metformin 1000 mg 2×1 · 30 hari', 'Atorvastatin 20 mg 1×1 malam · 30 hari']);
    expect(R.rec.klaim).toBe('Siap grouping · E11.9, E78.5');
    // Task ID antrean BPJS 1–7 terkirim semuanya.
    expect(bpjsQueueTasks(R).every((t) => t.at !== null)).toBe(true);
  });

  it('IGD → rawat inap: pulang Kam 8 Okt 08.09, 13 baris Rp 10.620.000, pasien bayar Rp 0', () => {
    const R = runScenario(IGD, autoplay(IGD));
    expect(formatSimClock(IGD, R.def.startMin)).toBe('Sab 3 Okt · 21.40');
    expect(formatSimClock(IGD, R.rec.pulangAt ?? 0)).toBe('Kam 8 Okt · 08.09');
    expect(formatSimClock(IGD, R.clock)).toBe('Jum 9 Okt · 08.30');
    const s = scenarioSummary(R);
    expect(formatSimDuration(s.lengthOfStay)).toBe('4 hr 10 j');
    expect(s.chargeLines).toBe(13);
    expect(billSummary(R).total).toBe(10_620_000n);
    expect(R.rec.bayarPasien).toBe(0n);
    expect(R.rec.klaim).toBe('Terkirim · I21.4 + E87.5, N18.3, I10');
  });

  it('elektif TPDI × BTN: pulang Rab 14 Okt 10.53, selisih dicicil BTN, piutang BPJS dibiayai', () => {
    const R = runScenario(BTN, autoplay(BTN));
    expect(formatSimClock(BTN, R.rec.pulangAt ?? 0)).toBe('Rab 14 Okt · 10.53');
    expect(formatSimClock(BTN, R.clock)).toBe('Kam 19 Nov · 16.11');
    const s = scenarioSummary(R);
    expect(formatSimDuration(s.lengthOfStay)).toBe('2 hr 3 j');
    expect(s.chargeLines).toBe(8);
    expect(s.bill.total).toBe(17_905_000n);
    expect(s.bill.patient).toBe(9_400_000n);
    expect(s.extra.map((x) => x.value)).toEqual([3_000_000n, 6_400_000n, 6_426_000n]);
    expect(R.rec.klaim).toBe('Dibayar BPJS · Rp 7.140.000 (simulasi)');
  });
});

describe('aturan gerbang (sama dengan mockup)', () => {
  it('hanya tugas terbuka pertama di langkah aktif yang boleh dikerjakan', () => {
    expect(applyAction(RJ, [], { type: 'task', step: 0, task: 'tiket', value: true })).toMatchObject({
      ok: false,
      error: 'Tugas ini belum gilirannya.',
    });
    expect(applyAction(RJ, [], { type: 'task', step: 1, task: 'panggil', value: true }).ok).toBe(false);
    expect(applyAction(RJ, [], { type: 'next' })).toMatchObject({ ok: false });
    const ok = applyAction(RJ, [], { type: 'task', step: 0, task: 'scan', value: true });
    expect(ok.ok).toBe(true);
  });

  it('isian divalidasi; pilihan harus ada di daftar; aksi hanya bernilai true', () => {
    const atNurse = advanceTo(RJ, [], 2);
    if (!atNurse.ok) throw new Error(atNurse.error);
    const bad = applyAction(RJ, atNurse.seq, { type: 'task', step: 2, task: 'td', value: '138-86' });
    expect(bad).toMatchObject({ ok: false, task: 'td' });
    const long = applyAction(RJ, atNurse.seq, { type: 'task', step: 2, task: 'td', value: '1'.repeat(200) });
    expect(long.ok).toBe(false);
    const good = applyAction(RJ, atNurse.seq, { type: 'task', step: 2, task: 'td', value: ' 120/80 ' });
    expect(good.ok && good.seq.at(-1)).toEqual({ s: 2, t: 'td', v: '120/80' });
    expect(applyAction(RJ, [], { type: 'task', step: 0, task: 'scan', value: 'x' }).ok).toBe(false);
    const toBio = applyAction(RJ, [], { type: 'task', step: 0, task: 'scan', value: true });
    if (!toBio.ok) throw new Error('scan');
    expect(applyAction(RJ, toBio.seq, { type: 'task', step: 0, task: 'bio', value: 'retina' }).ok).toBe(
      false,
    );
  });

  it('cabang `when`: CDS hanya muncul untuk terapi dengan glimepirid; triase di bawah saran wajib alasan', () => {
    const atRx = advanceTo(RJ, [], 5);
    if (!atRx.ok) throw new Error(atRx.error);
    const b = applyAction(RJ, atRx.seq, { type: 'task', step: 5, task: 'terapi', value: 'b' });
    if (!b.ok) throw new Error(b.error);
    expect(visibleTasks(runScenario(RJ, b.seq), 5).map((t) => t.id)).toEqual(['terapi', 'prb', 'tte']);
    const a = applyAction(RJ, atRx.seq, { type: 'task', step: 5, task: 'terapi', value: 'a' });
    if (!a.ok) throw new Error(a.error);
    expect(visibleTasks(runScenario(RJ, a.seq), 5).map((t) => t.id)).toEqual(['terapi', 'cds', 'prb', 'tte']);

    const atTriage = advanceTo(IGD, [], 1);
    if (!atTriage.ok) throw new Error(atTriage.error);
    let seq = atTriage.seq;
    for (const [task, value] of [
      ['ttv', '158/94 · 112 · 24 · 94%'],
      ['level', '3'],
    ] as const) {
      const r = applyAction(IGD, seq, { type: 'task', step: 1, task, value });
      if (!r.ok) throw new Error(r.error);
      seq = r.seq;
    }
    // Level 3 di bawah saran: tugas alasan muncul dan menolak alasan pendek.
    expect(visibleTasks(runScenario(IGD, seq), 1).map((t) => t.id)).toContain('alasan');
    expect(applyAction(IGD, seq, { type: 'task', step: 1, task: 'alasan', value: 'pendek' }).ok).toBe(false);
    expect(applyAction(IGD, seq, { type: 'next' }).ok).toBe(false);
    // Putar otomatis berhenti di alasan wajib (tidak ada nilai bawaan yang sah).
    expect(applyAction(IGD, seq, { type: 'auto' })).toMatchObject({ ok: false, task: 'alasan' });
  });

  it('setelah selesai tidak ada aksi lagi', () => {
    const seq = autoplay(RJ);
    expect(applyAction(RJ, seq, { type: 'auto' }).ok).toBe(false);
  });
});

describe('keadaan tersimpan', () => {
  it('urutan sah lolos utuh; kejadian tidak sah memotong sisa urutan', () => {
    const seq = autoplay(IGD);
    expect(sanitizeSeq(IGD, seq)).toEqual(seq);
    const tampered: ScenarioEvent[] = [
      ...seq.slice(0, 3),
      { s: 0, t: 'gelang', v: 'palsu' },
      ...seq.slice(3),
    ];
    expect(sanitizeSeq(IGD, tampered)).toEqual(seq.slice(0, 3));
    expect(sanitizeSeq(IGD, [{ adv: 5 }])).toEqual([]);
  });

  it('rekam medis terbentuk hanya menampilkan baris yang terisi', () => {
    expect(recordRows(runScenario(RJ, []))).toEqual([
      { label: 'Penjamin', value: 'BPJS · belum diverifikasi' },
    ]);
    const R = runScenario(RJ, autoplay(RJ));
    expect(recordRows(R).map((r) => r.label)).toContain('No. SEP');
    expect(R.done.get(taskKey(1, 'sep'))).toBe(true);
  });
});
