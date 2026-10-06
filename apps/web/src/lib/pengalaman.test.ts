import { describe, expect, it } from 'vitest';
import { OPEN_COMPLAINTS, recentComplaints, surveyResponses } from './demo/fixtures/pengalaman';
import { DEMO_NOW } from './demo/fixtures/waktu';
import {
  answerBlock,
  complaintDeadline,
  indexByUnit,
  needsFollowUp,
  responseRate,
  satisfactionIndex,
  slaState,
} from './pengalaman';

describe('B13 · pengaduan', () => {
  it('tenggat per grading; lewat, mendekati, dalam', () => {
    expect(complaintDeadline('2026-10-05T07:30:00+07:00', 'merah')).toBe('2026-10-06T00:30:00.000Z');
    expect(slaState('2026-10-01T09:00:00+07:00', 'kuning', DEMO_NOW, null).state).toBe('lewat');
    expect(slaState('2026-10-04T10:00:00+07:00', 'kuning', DEMO_NOW, null).state).toBe('dalam');
    expect(slaState('2026-10-04T12:00:00+07:00', 'merah', DEMO_NOW, null).state).toBe('mendekati');
    expect(slaState('2026-10-01T09:00:00+07:00', 'kuning', DEMO_NOW, '2026-10-02T09:00:00+07:00').state).toBe(
      'dalam',
    );
  });

  it('fixture: satu pengaduan terbuka lewat SLA, satu belum digrading', () => {
    const late = OPEN_COMPLAINTS.filter(
      (c) => c.grade && slaState(c.receivedAt, c.grade, DEMO_NOW, null).state === 'lewat',
    );
    expect(late.map((c) => c.number)).toEqual(['ADU-2610-016']);
    expect(OPEN_COMPLAINTS.filter((c) => !c.grade)).toHaveLength(1);
  });

  it('INM-12 30 hari = 87% (20/23), sama dengan indikator Mutu', () => {
    expect(responseRate(recentComplaints(), DEMO_NOW)).toEqual({ within: 20, total: 23, pct: 87 });
    expect(answerBlock('Terima kasih')).toMatch(/20 huruf/);
    expect(answerBlock('Terima kasih, rincian tagihan sudah dikoreksi')).toBeNull();
  });
});

describe('B13 · survei', () => {
  it('indeks kepuasan 86 dari 50 respons; dua skor rendah', () => {
    const r = surveyResponses();
    expect(r).toHaveLength(50);
    expect(r.every((x) => x.scores.length === 5 && x.scores.every((s) => s >= 1 && s <= 4))).toBe(true);
    expect(satisfactionIndex(r)).toBe(86);
    expect(r.filter(needsFollowUp)).toHaveLength(2);
    expect(indexByUnit(r).map((u) => u.unit)).toEqual(['Rawat jalan', 'Rawat inap', 'IGD']);
    expect(satisfactionIndex([])).toBeNull();
  });
});
