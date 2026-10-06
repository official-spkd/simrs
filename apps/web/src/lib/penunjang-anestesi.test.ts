import { describe, expect, it } from 'vitest';
import { demoAnesthesia } from './demo/fixtures/penunjang-anestesi';
import { demoOrSchedule } from './btn-skenario';
import { advanceTo, runScenario } from './demo/engine/run';
import { SCENARIOS } from './demo/skenario';
import {
  asaText,
  EMPTY_PRE,
  inductionGate,
  preAnesthesiaMissing,
  vitalsWarnings,
} from './penunjang-anestesi';

describe('anestesi', () => {
  it('setiap kasus kamar operasi punya catatan anestesi awal', () => {
    const r = advanceTo(SCENARIOS['elektif-btn'], [], 0);
    if (!r.ok) throw new Error(r.error);
    const cases = demoOrSchedule(runScenario(SCENARIOS['elektif-btn'], r.seq)).rooms.flatMap((x) => x.cases);
    const recs = demoAnesthesia();
    for (const c of cases) expect(recs[c.id], c.id).toBeDefined();
  });

  it('asesmen lengkap: ASA, puasa (kecuali darurat), jalan napas, rencana, persetujuan', () => {
    expect(preAnesthesiaMissing(EMPTY_PRE)).toEqual([
      'kelas ASA',
      'jam mulai puasa',
      'penilaian jalan napas',
      'rencana anestesi',
      'persetujuan anestesi',
    ]);
    const darurat = {
      ...EMPTY_PRE,
      emergency: true,
      asa: 'II' as const,
      airway: 'Mallampati I',
      plan: 'Spinal',
      consent: true,
    };
    expect(preAnesthesiaMissing(darurat)).toEqual([]);
    expect(asaText(darurat)).toBe('ASA IIE');
  });

  it('induksi terkunci sampai asesmen ber-TTE dan sign in WHO', () => {
    const recs = demoAnesthesia();
    const anisa = recs['ok3-1'];
    const ratna = recs['ok2-2'];
    if (!anisa || !ratna) throw new Error('kasus');
    expect(inductionGate(anisa, true)).toBe('PRE_ANESTHESIA');
    expect(inductionGate(ratna, false)).toBe('SIGN_IN');
    expect(inductionGate(ratna, true)).toBeNull();
    expect(inductionGate(recs['ok4-1'] ?? ratna, true)).toBe('ALREADY');
  });

  it('peringatan monitoring intraoperasi', () => {
    expect(vitalsWarnings({ systolic: 118, diastolic: 72, pulse: 80, spo2: 99, etco2: 35 })).toEqual([]);
    expect(vitalsWarnings({ systolic: 84, diastolic: 50, pulse: 130, spo2: 89, etco2: 50 })).toEqual([
      'SpO₂ 89%',
      'hipotensi 84/50',
      'nadi 130',
      'EtCO₂ 50',
    ]);
  });
});
