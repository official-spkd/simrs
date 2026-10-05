import { describe, expect, it } from 'vitest';
import { backupKeyFor, type BackupKind } from '../src/manifest';
import { DEFAULT_RETENTION, planRetention, type StoredRun } from '../src/retention';

const NOW = new Date('2026-10-05T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
const run = (h: number, kind: BackupKind, complete = true): StoredRun => ({
  key: backupKeyFor(hoursAgo(h), kind),
  complete,
});

describe('retensi backup', () => {
  it('per jam: hanya N terbaru yang disimpan', () => {
    const runs = Array.from({ length: 60 }, (_, i) => run(i + 1, 'hourly'));
    const plan = planRetention(runs, NOW, { ...DEFAULT_RETENTION, hourly: 48 });
    expect(plan.keep).toHaveLength(48);
    expect(plan.prune).toHaveLength(12);
    expect(plan.prune[0]).toBe(run(49, 'hourly').key);
  });

  it('harian: N terbaru + satu per bulan untuk N bulan', () => {
    const runs = Array.from({ length: 400 }, (_, d) => run(24 * d + 2, 'daily'));
    const plan = planRetention(runs, NOW, { ...DEFAULT_RETENTION, daily: 7, monthly: 12 });
    const kept = new Set(plan.keep);
    // 7 harian terbaru
    for (let d = 0; d < 7; d += 1) expect(kept.has(run(24 * d + 2, 'daily').key)).toBe(true);
    // satu per bulan kalender (UTC), 12 bulan: total ≤ 7 + 12
    expect(plan.keep.length).toBeLessThanOrEqual(19);
    const months = new Set(plan.keep.map((k) => k.slice(0, 6)));
    expect(months.size).toBe(12);
    expect(plan.keep.length + plan.prune.length).toBe(400);
  });

  it('backup lengkap terbaru selalu disimpan walau kuota jenisnya 0', () => {
    const runs = [run(1, 'manual'), run(2, 'manual')];
    const plan = planRetention(runs, NOW, { ...DEFAULT_RETENTION, manual: 0 });
    expect(plan.keep).toEqual([run(1, 'manual').key]);
    expect(plan.prune).toEqual([run(2, 'manual').key]);
  });

  it('run tidak lengkap: dibiarkan selama masa tenggang, lalu dihapus; tidak dihitung kuota', () => {
    const fresh = run(2, 'hourly', false);
    const stale = run(30, 'hourly', false);
    const plan = planRetention([fresh, stale, run(3, 'hourly')], NOW, { ...DEFAULT_RETENTION, hourly: 1 });
    expect(plan.keep).toContain(fresh.key);
    expect(plan.prune).toEqual([stale.key]);
  });

  it('kunci yang dilindungi (run berjalan) tidak pernah dihapus', () => {
    const current = run(0, 'hourly', false);
    const plan = planRetention(
      [current],
      NOW,
      { ...DEFAULT_RETENTION, incompleteGraceHours: 0 },
      new Set([current.key]),
    );
    expect(plan.prune).toEqual([]);
  });

  it('nama asing diabaikan, tidak pernah dihapus', () => {
    const plan = planRetention([{ key: 'laporan', complete: false }, run(1, 'daily')], NOW);
    expect(plan.ignored).toEqual(['laporan']);
    expect(plan.prune).toEqual([]);
  });
});
