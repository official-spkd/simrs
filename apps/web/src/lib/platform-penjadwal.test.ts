import { describe, expect, it } from 'vitest';
import { DEMO_JOBS } from './demo/fixtures/penjadwal';
import { DEMO_NOW } from './demo/fixtures/waktu';
import { canRunNow, formatDuration, jobHealth, jobSummary, recordRun } from './platform-penjadwal';

const now = new Date(DEMO_NOW);
const job = (id: string) => {
  const j = DEMO_JOBS.find((x) => x.id === id);
  if (!j) throw new Error(id);
  return j;
};

describe('P11 · penjadwal pekerjaan', () => {
  it('fixture: id unik, riwayat terbaru di depan, tidak ada jalan di masa depan', () => {
    expect(new Set(DEMO_JOBS.map((j) => j.id)).size).toBe(DEMO_JOBS.length);
    for (const j of DEMO_JOBS) {
      const times = j.runs.map((r) => Date.parse(r.at));
      expect([...times].sort((a, b) => b - a)).toEqual(times);
      for (const t of times) expect(t).toBeLessThanOrEqual(now.getTime());
    }
  });

  it('kesehatan job dari hasil terakhir, jeda, dan keterlambatan', () => {
    expect(jobHealth(job('aplicare-bed'), now)).toBe('gagal');
    expect(jobHealth(job('backup-jam'), now)).toBe('berhasil');
    expect(jobHealth(job('pengingat-kontrol'), now)).toBe('dijeda');
    expect(jobHealth(job('backup-jam'), new Date('2026-10-05T13:30:00+07:00'))).toBe('terlambat');
    expect(jobSummary(DEMO_JOBS, now)).toMatchObject({ total: 9, active: 8, failing: 2, paused: 1, late: 0 });
  });

  it('jalankan sekarang: diblok saat dijeda/berjalan; riwayat bertambah di depan', () => {
    expect(canRunNow(job('pengingat-kontrol'), false).ok).toBe(false);
    expect(canRunNow(job('aplicare-bed'), true).ok).toBe(false);
    expect(canRunNow(job('aplicare-bed'), false).ok).toBe(true);
    const after = recordRun(job('aplicare-bed'), {
      at: '2026-10-05T10:50:00+07:00',
      durationSec: 2,
      result: 'berhasil',
      message: 'ok',
    });
    expect(jobHealth(after, now)).toBe('berhasil');
    expect(formatDuration(212)).toBe('3 mnt 32 dtk');
  });
});
