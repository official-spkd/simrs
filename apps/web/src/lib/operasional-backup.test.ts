import { describe, expect, it } from 'vitest';
import { BACKUP_LOCATIONS, LAST_RESTORE_TEST } from './demo/fixtures/operasional';
import { DEMO_NOW } from './demo/fixtures/waktu';
import {
  addManualCopy,
  initialRestore,
  locationStale,
  RESTORE_STEPS,
  restorePassed,
  restoreTestStale,
  RETENTION_LIMIT,
  RTO_TARGET_MINUTES,
  stepRestore,
} from './operasional-backup';

const now = new Date(DEMO_NOW);

describe('cadangan & pemulihan (ADR-0071)', () => {
  it('fixture: tiga lokasi segar, retensi tidak melewati batas, uji restore dalam 8 hari', () => {
    expect(BACKUP_LOCATIONS.map((l) => l.id)).toEqual(['edge', 'cloud', 'offsite']);
    for (const l of BACKUP_LOCATIONS) {
      expect(locationStale(l, now)).toBe(false);
      for (const [c, n] of Object.entries(l.kept)) {
        expect(n).toBeLessThanOrEqual(RETENTION_LIMIT[c as keyof typeof RETENTION_LIMIT]);
      }
    }
    expect(locationStale(BACKUP_LOCATIONS[0] as never, new Date('2026-10-05T13:00:00+07:00'))).toBe(true);
    expect(restoreTestStale(LAST_RESTORE_TEST.at, now)).toBe(false);
  });

  it('backup manual: salinan manual dibatasi retensi', () => {
    let loc = BACKUP_LOCATIONS[0];
    if (!loc) throw new Error('lokasi');
    for (let i = 0; i < 20; i++) loc = addManualCopy(loc);
    expect(loc.kept.manual).toBe(RETENTION_LIMIT.manual);
  });

  it('uji restore lulus berurutan dengan RTO di bawah target; kunci salah berhenti sebelum dekripsi', () => {
    let s = initialRestore();
    for (let i = 0; i < RESTORE_STEPS.length; i++) s = stepRestore(s, false);
    expect(restorePassed(s)).toBe(true);
    expect(s.minutes).toBe(36);
    expect(s.minutes).toBeLessThanOrEqual(RTO_TARGET_MINUTES);
    expect(stepRestore(s, false)).toBe(s);

    let w = initialRestore();
    for (let i = 0; i < RESTORE_STEPS.length; i++) w = stepRestore(w, true);
    expect(w.failedAt).toBe(RESTORE_STEPS.findIndex((x) => x.id === 'kunci'));
    expect(w.next).toBeLessThan(RESTORE_STEPS.findIndex((x) => x.id === 'dekripsi') + 1);
    expect(restorePassed(w)).toBe(false);
    expect(w.failReason).toMatch(/sebelum ada plaintext/);
  });
});
