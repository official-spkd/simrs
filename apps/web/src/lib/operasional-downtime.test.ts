import { describe, expect, it } from 'vitest';
import { DOWNTIME_PAPER_FORMS } from './demo/fixtures/operasional';
import { PASIEN } from './demo/fixtures/pasien';
import {
  backlogTotal,
  canDo,
  type DowntimeAction,
  type DowntimeState,
  incidentSummary,
  initialDowntime,
  reduceDowntime,
} from './operasional-downtime';

const forms = DOWNTIME_PAPER_FORMS;
const run = (s: DowntimeState, ...actions: DowntimeAction[]) =>
  actions.reduce((cur, a) => reduceDowntime(cur, a, forms), s);
const REASON = 'Entri susulan dari formulir kertas darurat';

describe('P13 · mode downtime', () => {
  it('fixture: pasien formulir kertas ada di fixture dan bukan pasien skenario', () => {
    for (const f of forms) {
      const p = PASIEN.find((x) => x.nama === f.patient);
      expect(p, f.patient).toBeDefined();
      expect(p?.scenario).toBeUndefined();
    }
  });

  it('gerbang: alasan wajib, cetak paket sebelum pulih, semua kertas masuk sebelum sinkron', () => {
    const s0 = initialDowntime();
    expect(canDo(s0, { type: 'activate', cause: 'bpjs', reason: 'mati' }, forms).ok).toBe(false);
    const s1 = run(s0, { type: 'activate', cause: 'bpjs', reason: 'VClaim timeout sejak 10.40' });
    expect(s1.stage).toBe(1);
    expect(canDo(s1, { type: 'recover' }, forms)).toEqual({
      ok: false,
      reason: 'Cetak paket darurat dulu (langkah wajib SOP).',
    });
    const s2 = run(
      s1,
      { type: 'print' },
      { type: 'offline-registration' },
      { type: 'tick' },
      { type: 'recover' },
    );
    expect(s2.stage).toBe(2);
    expect(canDo(s2, { type: 'sync' }, forms)).toEqual({
      ok: false,
      reason: '4 formulir kertas belum dimasukkan.',
    });
    expect(canDo(s2, { type: 'back-entry', id: 'kertas-1', reason: 'pendek' }, forms).ok).toBe(false);
  });

  it('alur lengkap: backlog naik saat downtime lalu tersinkron per batch sampai nol; ringkasan insiden', () => {
    let s = run(
      initialDowntime(),
      { type: 'activate', cause: 'jaringan', reason: 'Jaringan ke pusat putus sejak 10.40' },
      { type: 'print' },
      { type: 'offline-registration' },
      { type: 'offline-registration' },
      { type: 'tick' },
      { type: 'recover' },
    );
    expect(backlogTotal(s.backlog)).toBe(25);
    s = run(s, ...forms.map((f): DowntimeAction => ({ type: 'back-entry', id: f.id, reason: REASON })));
    expect(backlogTotal(s.backlog)).toBe(29);
    s = run(s, { type: 'sync' }, { type: 'sync' }, { type: 'sync' });
    expect(s.stage).toBe(4);
    expect(s.syncLog.map((b) => b.sent)).toEqual([12, 12, 5]);
    expect(incidentSummary(s)).toEqual({
      outageMinutes: 28,
      recoveryMinutes: 14,
      messagesSynced: 29,
      dataLost: 0,
    });
  });
});
