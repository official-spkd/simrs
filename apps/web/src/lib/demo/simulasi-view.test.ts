import { describe, expect, it } from 'vitest';
import { advanceTo, applyAction, runScenario } from './engine/run';
import type { ScenarioEvent } from './engine/types';
import { guideView } from './guide-view';
import { SCENARIOS } from './skenario';
import { simulationView } from './simulasi-view';

const RJ = SCENARIOS['rawat-jalan'];

function step(seq: ScenarioEvent[], task: string, value: true | string = true): ScenarioEvent[] {
  const R = runScenario(RJ, seq);
  const r = applyAction(RJ, seq, { type: 'task', step: R.step, task, value });
  if (!r.ok) throw new Error(r.error);
  return r.seq;
}

describe('model tampilan Simulasi', () => {
  it('awal: tugas pertama giliran, lainnya menunggu; tile pertama aktif; bisa diserialkan', () => {
    const v = simulationView(runScenario(RJ, []), null);
    expect(v.step?.tasks.map((t) => t.status)).toEqual(['giliran', 'menunggu', 'menunggu']);
    expect(v.step?.canNext).toBe(false);
    expect(v.journey[0]).toMatchObject({ state: 'aktif', viewing: true, clickable: true, time: '07.10' });
    expect(v.journey[1]).toMatchObject({ state: 'belum', clickable: false, time: 'Belum' });
    expect(v.bill).toEqual({ total: 'Rp 0', covered: 'Belum difinalkan', patient: 'Belum difinalkan' });
    expect(() => JSON.stringify(v)).not.toThrow();
    expect(v.progress).toBe(0);
  });

  it('meninjau langkah lampau hanya-baca; jejak sistem terbaru di atas', () => {
    let seq = step([], 'scan');
    seq = step(seq, 'bio', 'jari');
    seq = step(seq, 'tiket');
    const next = applyAction(RJ, seq, { type: 'next' });
    if (!next.ok) throw new Error(next.error);
    const R = runScenario(RJ, next.seq);
    const past = simulationView(R, 0);
    expect(past.step?.past).toBe(true);
    expect(past.step?.tasks.every((t) => !t.enabled)).toBe(true);
    expect(past.step?.tasks[1]?.options.find((o) => o.selected)?.id).toBe('jari');
    const now = simulationView(R, null);
    expect(now.step?.index).toBe(1);
    expect(now.logs[0]?.text).toBe('Tiket A-031 tercetak, notifikasi dikirim ke aplikasi pasien');
    expect(now.step?.screen).toMatchObject({ id: 'daftar', ready: true });
    expect(now.step?.roleName).toBe('Petugas pendaftaran');
  });

  it('selesai: ringkasan menggantikan kartu langkah; panduan menandai selesai', () => {
    const done = advanceTo(RJ, [], 99);
    if (!done.ok) throw new Error(done.error);
    let seq = done.seq;
    while (!runScenario(RJ, seq).finished) {
      const r = applyAction(RJ, seq, { type: 'auto' });
      if (!r.ok) throw new Error(r.error);
      seq = r.seq;
    }
    const R = runScenario(RJ, seq);
    const v = simulationView(R, null);
    expect(v.step).toBeNull();
    expect(v.summary?.stats.find((s) => s.label === 'Tarif RS')?.value).toBe('Rp 806.000');
    expect(v.progress).toBe(100);
    expect(guideView(R, 'perawat')).toMatchObject({ finished: true, nextTask: null });
  });

  it('panduan: posisi pembawa langkah dan tugas berikutnya', () => {
    const at = advanceTo(RJ, [], 2);
    if (!at.ok) throw new Error(at.error);
    const g = guideView(runScenario(RJ, at.seq), 'kasir');
    expect(g).toMatchObject({
      stage: 'Asesmen perawat',
      role: 'perawat',
      roleName: 'Perawat',
      onRole: false,
      nextTask: 'Tekanan darah (mmHg)',
    });
    expect(guideView(runScenario(RJ, at.seq), 'perawat').onRole).toBe(true);
  });
});
