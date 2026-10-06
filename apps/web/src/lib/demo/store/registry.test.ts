import { describe, expect, it } from 'vitest';
import { demoLabWorklist } from '../fixtures/penunjang';
import { demoOtherCriticals } from '../fixtures/penunjang-kritis';
import { DEMO_NOW } from '../fixtures/waktu';
import {
  applyStoredReports,
  applyStoredReportToSample,
  criticalDomain,
  type CriticalEvent,
  criticalIdOfLab,
  reportedAtFromTimer,
} from '../../penunjang-kritis';
import { criticalOpen } from '../../penunjang';
import { screenById } from '../../screens';
import { type DemoActor, project, type StoredEvent } from './define';
import { allDomains, DEMO_DOMAINS, isDomainName } from './registry';

const actor: DemoActor = { userId: 'u-9', name: 'Analis Sesi', role: 'analis_lab', baseRole: null };

describe('registri domain toko demo', () => {
  it('kunci = nama domain; layar domain terdaftar di registri layar', () => {
    for (const [key, def] of Object.entries(DEMO_DOMAINS)) {
      expect(def.name).toBe(key);
      for (const id of def.screens) expect(screenById(id), `${key} → ${id}`).toBeDefined();
      for (const sub of def.subscriptions) expect(isDomainName(sub.source), sub.source).toBe(true);
    }
    expect(allDomains().length).toBe(Object.keys(DEMO_DOMAINS).length);
    expect(isDomainName('constructor')).toBe(false);
  });
});

describe('domain hasil-kritis', () => {
  const ev = (seq: number, itemId: string, recipient = 'dr. Penerima Uji'): StoredEvent => ({
    seq,
    domain: 'hasil-kritis',
    at: '2026-10-05T03:50:00.000Z',
    actor,
    data: {
      type: 'laporan.dicatat',
      itemId,
      recipient,
      recipientRole: 'DPJP',
      channel: 'telepon',
      reportedAt: '2026-10-05T03:52:00.000Z',
      via: 'pusat',
    },
  });

  it('pelapor = pengguna sesi; laporan kedua untuk hasil yang sama dilewati', () => {
    const p = project(criticalDomain, {
      seq: 2,
      resetSeq: 0,
      events: [ev(1, 'kr-L1'), ev(2, 'kr-L1', 'dr. Penimpa')],
    });
    expect(p.state.reports['kr-L1']).toMatchObject({
      recipient: 'dr. Penerima Uji',
      reportedBy: 'Analis Sesi',
    });
    expect(p.applied).toBe(1);
    expect(criticalDomain.validate?.(p.state, ev(3, 'kr-L1').data as CriticalEvent, actor)).toMatch(
      /sudah dilaporkan/,
    );
  });

  it('skema menolak laporan tanpa penerima sah atau saluran', () => {
    const bad = { ...(ev(1, 'kr-L1').data as object), recipient: 'dr' };
    expect(criticalDomain.eventSchema.safeParse(bad).success).toBe(false);
    const noChannel = { ...(ev(1, 'kr-L1').data as object), channel: '' };
    expect(criticalDomain.eventSchema.safeParse(noChannel).success).toBe(false);
  });

  it('laporan tersimpan menutup nilai kritis sampel lab dan tampil di Pusat hasil kritis', () => {
    const sample = demoLabWorklist([]).samples.find(criticalOpen);
    expect(sample).toBeDefined();
    if (!sample?.critical) return;
    const id = criticalIdOfLab(sample);
    const reportedAt = reportedAtFromTimer(
      sample.critical.resultAt,
      DEMO_NOW,
      sample.critical.elapsedSeconds + 90,
    );
    const state = project(criticalDomain, {
      seq: 1,
      resetSeq: 0,
      events: [{ ...ev(1, id), data: { ...(ev(1, id).data as object), reportedAt, via: 'lab' } }],
    }).state;
    const after = applyStoredReportToSample(sample, state);
    expect(criticalOpen(after)).toBe(false);
    expect(after.critical).toMatchObject({ recipient: 'dr. Penerima Uji', readBackAt: reportedAt });
    expect(after.critical?.elapsedSeconds).toBe(sample.critical.elapsedSeconds + 90);
    // Sampel lain tidak berubah.
    const other = demoOtherCriticals();
    expect(applyStoredReports(other, state)).toEqual(other);
  });

  it('timer layar dibatasi: tidak lebih awal dari saat data dibuka, tidak lebih dari 12 jam sesudahnya', () => {
    const raised = '2026-10-05T03:39:00.000Z';
    const asOf = '2026-10-05T03:45:00.000Z';
    expect(reportedAtFromTimer(raised, asOf, 0)).toBe(asOf);
    expect(reportedAtFromTimer(raised, asOf, 420)).toBe('2026-10-05T03:46:00.000Z');
    expect(reportedAtFromTimer(raised, asOf, 10 ** 9)).toBe('2026-10-05T15:45:00.000Z');
  });
});
