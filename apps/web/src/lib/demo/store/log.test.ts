import { describe, expect, it } from 'vitest';
import type { DemoActor } from './define';
import { appendEvent, emptyLog, LOG_LIMITS, type LogFile, parseLog, resetLog, serializeLog } from './log';

const actor: DemoActor = { userId: 'u-1', name: 'Admin Uji', role: 'admin_tenant', baseRole: null };
const AT = '2026-10-05T03:45:00.000Z';

function append(log: LogFile, data: unknown = { type: 'x' }) {
  const r = appendEvent(log, 'hasil-kritis', data, actor, AT);
  if (!r.ok) throw new Error(r.error);
  return r.log;
}

describe('log toko demo', () => {
  it('seq naik per kejadian; serialisasi bolak-balik utuh', () => {
    const log = append(append(emptyLog('RSCM')));
    expect(log.seq).toBe(2);
    expect(log.events.map((e) => e.seq)).toEqual([1, 2]);
    expect(parseLog(serializeLog(log), 'RSCM')).toEqual(log);
  });

  it('berkas rusak, format lain, atau milik RS lain dianggap kosong', () => {
    expect(parseLog('{bukan json', 'RSCM')).toEqual(emptyLog('RSCM'));
    expect(parseLog(JSON.stringify({ ...emptyLog('RSCM'), format: 9 }), 'RSCM')).toEqual(emptyLog('RSCM'));
    expect(parseLog(serializeLog(append(emptyLog('RSFA'))), 'RSCM')).toEqual(emptyLog('RSCM'));
    expect(parseLog(JSON.stringify({ ...emptyLog('RSCM'), extra: 1 }), 'RSCM')).toEqual(emptyLog('RSCM'));
  });

  it('kejadian dengan seq tidak naik atau melewati seq berkas dibuang', () => {
    const log = append(append(append(emptyLog('RSCM'))));
    const [a, b, c] = log.events;
    const tampered = { ...log, events: [a, c, b, { ...c, seq: 99 }] };
    expect(parseLog(JSON.stringify(tampered), 'RSCM').events.map((e) => e.seq)).toEqual([1, 3]);
  });

  it('batas ukuran per kejadian', () => {
    const big = { type: 'x', note: 'é'.repeat(LOG_LIMITS.maxEventBytes / 2) };
    const r = appendEvent(emptyLog('RSCM'), 'hasil-kritis', big, actor, AT);
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/terlalu besar/) });
    expect(appendEvent(emptyLog('RSCM'), 'Bukan Domain', {}, actor, AT).ok).toBe(false);
  });

  it('batas jumlah kejadian dan ukuran berkas → penuh, minta mulai ulang', () => {
    const full: LogFile = {
      ...emptyLog('RSCM'),
      seq: LOG_LIMITS.maxEvents,
      events: Array.from({ length: LOG_LIMITS.maxEvents }, (_, i) => ({
        seq: i + 1,
        domain: 'hasil-kritis',
        at: AT,
        actor,
        data: { type: 'x' },
      })),
    };
    expect(appendEvent(full, 'hasil-kritis', { type: 'x' }, actor, AT)).toMatchObject({
      ok: false,
      full: true,
    });

    const chunk = 'a'.repeat(LOG_LIMITS.maxEventBytes - 100);
    let log = emptyLog('RSCM');
    let last: ReturnType<typeof appendEvent> | undefined;
    for (let i = 0; i < LOG_LIMITS.maxFileBytes / chunk.length + 2; i++) {
      last = appendEvent(log, 'hasil-kritis', { type: 'x', chunk }, actor, AT);
      if (!last.ok) break;
      log = last.log;
    }
    expect(last).toMatchObject({
      ok: false,
      full: true,
      error: expect.stringMatching(/Mulai ulang data demo/),
    });
    expect(serializeLog(log).length).toBeLessThanOrEqual(LOG_LIMITS.maxFileBytes);
  });

  it('mulai ulang: kejadian kosong, seq tetap naik, pelaku tercatat', () => {
    const log = append(append(emptyLog('RSCM')));
    const reset = resetLog(log, actor, AT);
    expect(reset.events).toEqual([]);
    expect(reset.seq).toBe(3);
    expect(reset.resetSeq).toBe(3);
    expect(reset.lastReset).toEqual({ at: AT, actor });
    expect(append(reset).events[0]?.seq).toBe(4);
  });
});
