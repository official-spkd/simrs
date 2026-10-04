import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { applyAction, runScenario } from '../../demo/engine/run';
import type { ScenarioEvent } from '../../demo/engine/types';
import { SCENARIOS } from '../../demo/skenario';
import { demoKey, DemoStore, emptyRuns } from './store';

const dir = mkdtempSync(join(tmpdir(), 'simrs-demo-store-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const KEY = demoKey('RSCM', '0199a000-0000-7000-8000-00000000abcd');

function autoplay(n: number): ScenarioEvent[] {
  const def = SCENARIOS['rawat-jalan'];
  let seq: ScenarioEvent[] = [];
  for (let i = 0; i < n; i++) {
    const r = applyAction(def, seq, { type: 'auto' });
    if (!r.ok) throw new Error(r.error);
    seq = r.seq;
  }
  return seq;
}

describe('penyimpanan keadaan simulasi', () => {
  it('kosong bila belum ada; simpan lalu muat ulang utuh', async () => {
    const store = new DemoStore(dir, 1);
    expect(await store.load(KEY)).toEqual(emptyRuns());
    const seq = autoplay(5);
    await store.update(KEY, (cur) => ({
      next: { ...cur, runs: { ...cur.runs, 'rawat-jalan': seq }, rev: cur.rev + 1 },
      result: null,
    }));
    const back = await store.load(KEY);
    expect(back.rev).toBe(1);
    expect(back.runs['rawat-jalan']).toEqual(seq);
    expect(runScenario(SCENARIOS['rawat-jalan'], back.runs['rawat-jalan']).step).toBe(1);
  });

  it('perubahan paralel diserialkan: yang kedua melihat revisi terbaru', async () => {
    const store = new DemoStore(dir, 1);
    const key = demoKey('RSCM', '0199a000-0000-7000-8000-00000000beef');
    const seen: number[] = [];
    await Promise.all(
      [0, 1, 2].map(() =>
        store.update(key, (cur) => {
          seen.push(cur.rev);
          return { next: { ...cur, rev: cur.rev + 1 }, result: null };
        }),
      ),
    );
    expect(seen).toEqual([0, 1, 2]);
    expect((await store.load(key)).rev).toBe(3);
  });

  it('berkas rusak, format asing, atau versi skenario lain dianggap kosong', async () => {
    const store = new DemoStore(dir, 2);
    const key = demoKey('RSCM', '0199a000-0000-7000-8000-00000000cafe');
    writeFileSync(join(dir, `${key}.json`), '{bukan json');
    expect(await store.load(key)).toEqual(emptyRuns());
    writeFileSync(
      join(dir, `${key}.json`),
      JSON.stringify({ format: 1, defVersion: 1, active: 'rawat-jalan', runs: {}, rev: 4 }),
    );
    expect(await store.load(key)).toEqual(emptyRuns());
    writeFileSync(
      join(dir, `${key}.json`),
      JSON.stringify({ format: 1, defVersion: 2, active: 'x', runs: {}, rev: 4, extra: true }),
    );
    expect(await store.load(key)).toEqual(emptyRuns());
  });

  it('kunci berkas tidak bisa keluar dari folder', () => {
    expect(demoKey('../..', '0199a000-0000-7000-8000-00000000abcd')).toBe(
      '-0199a000-0000-7000-8000-00000000abcd',
    );
    expect(() => demoKey('..', '/')).toThrow();
  });
});
