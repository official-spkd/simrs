import { describe, expect, it } from 'vitest';
import { ENCOUNTER_ID } from './demo/fixtures/ids';
import { nursingPlan, SHIFT_EVALS } from './demo/fixtures/rme-askep';
import { rmeChartByEncounter } from './demo/fixtures/rme-pasien';
import {
  dueDoses,
  evalBlocker,
  recordDoseBlocker,
  scanWristband,
  shiftOf,
  shiftProgress,
  WRISTBAND_GATE,
} from './rme-askep';

const AT = '2026-10-05T10:50:00+07:00';
const endang = () => {
  const d = rmeChartByEncounter(ENCOUNTER_ID.endang)?.inpatient;
  if (!d) throw new Error('endang');
  return d;
};

describe('asuhan keperawatan (K12)', () => {
  it('shift dari jam WIB', () => {
    expect(shiftOf('2026-10-05T10:45:00+07:00')).toBe('pagi');
    expect(shiftOf('2026-10-05T14:00:00+07:00')).toBe('siang');
    expect(shiftOf('2026-10-05T22:10:00+07:00')).toBe('malam');
    expect(shiftOf('2026-10-05T06:59:00+07:00')).toBe('malam');
  });

  it('rencana dari fixture rawat inap: diagnosis dengan luaran; evaluasi shift malam ada, shift pagi belum', () => {
    const { dxs, done } = nursingPlan(endang());
    expect(dxs.map((d) => d.label)).toEqual([
      'Risiko jatuh (Morse 35)',
      'Ketidakstabilan kadar glukosa darah',
      'Bersihan jalan napas tidak efektif',
    ]);
    expect(dxs.every((d) => d.outcome.length > 10)).toBe(true);
    expect(Object.keys(done).length).toBeGreaterThan(0);
    expect(shiftProgress(dxs, SHIFT_EVALS, 'malam', '2026-10-04')).toEqual({ done: 2, total: 3 });
    expect(shiftProgress(dxs, SHIFT_EVALS, 'pagi', '2026-10-05')).toEqual({ done: 0, total: 3 });
  });

  it('evaluasi SOAP: O, hasil, dan P wajib', () => {
    expect(evalBlocker({ s: '', o: '', result: '', p: '' })).toMatch(/O \(data objektif\)/);
    expect(evalBlocker({ s: '', o: 'x', result: '', p: '' })).toMatch(/hasil evaluasi/);
    expect(evalBlocker({ s: '', o: 'x', result: 'sebagian', p: '' })).toMatch(/P \(rencana/);
    expect(evalBlocker({ s: '', o: 'x', result: 'sebagian', p: 'y' })).toBeNull();
  });

  it('ronde obat: dosis jatuh tempo dan terlambat dari jadwal eMAR', () => {
    const doses = dueDoses(endang().medications);
    expect(doses.map((d) => [d.name, d.time, d.late, d.highAlert])).toEqual([
      ['Insulin aspart sesuai skala', '12.00', false, true],
      ['Omeprazol 40 mg injeksi', '08.00', true, false],
    ]);
  });

  it('gerbang gelang: tanpa pindai cocok tidak bisa dicatat; terlambat wajib alasan; high-alert wajib cek ganda', () => {
    const rm = '00-07-61-33';
    const late = { late: true, highAlert: false };
    const ha = { late: false, highAlert: true };
    const none = { lateReason: '', secondNurse: '' };
    expect(recordDoseBlocker(late, { scan: { status: 'belum' }, ...none })).toBe(WRISTBAND_GATE);
    const wrong = scanWristband('00-12-45-78', rm, AT);
    expect(wrong).toEqual({ status: 'tidak-cocok', code: '00-12-45-78' });
    expect(recordDoseBlocker(late, { scan: wrong, ...none })).toBe(WRISTBAND_GATE);
    const ok = scanWristband(rm, rm, AT);
    expect(ok.status).toBe('cocok');
    expect(recordDoseBlocker(late, { scan: ok, ...none })).toMatch(/alasan keterlambatan/);
    expect(
      recordDoseBlocker(late, { scan: ok, lateReason: 'Pasien sedang foto toraks', secondNurse: '' }),
    ).toBeNull();
    expect(recordDoseBlocker(ha, { scan: ok, ...none })).toMatch(/cek ganda/);
    expect(recordDoseBlocker(ha, { scan: ok, lateReason: '', secondNurse: 'Ns. B' })).toBeNull();
  });
});
