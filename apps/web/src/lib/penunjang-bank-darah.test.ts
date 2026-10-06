import { describe, expect, it } from 'vitest';
import { demoBloodRequests, demoBloodUnits } from './demo/fixtures/penunjang-bank-darah';
import { DEMO_TODAY } from './demo/fixtures/waktu';
import {
  applyBlood,
  type BloodResult,
  type BloodState,
  compatible,
  ISSUE_CHECKS,
  reactionCheck,
  stageOf,
  unitGate,
} from './penunjang-bank-darah';

const ctx = { at: '2026-10-05T10:50:00+07:00', by: 'Fitri Handayani, A.Md.AK', today: DEMO_TODAY };
const state = (): BloodState => ({ requests: demoBloodRequests(), units: demoBloodUnits() });
const ok = (r: BloodResult): BloodState => {
  if (!r.ok) throw new Error(r.message);
  return r.state;
};
const allChecks = Object.fromEntries(ISSUE_CHECKS.map((c) => [c.id, true]));
const req = (s: BloodState, id: string) => {
  const r = s.requests.find((x) => x.id === id);
  if (!r) throw new Error(id);
  return r;
};
const unit = (s: BloodState, id: string) => {
  const u = s.units.find((x) => x.id === id);
  if (!u) throw new Error(id);
  return u;
};

describe('kompatibilitas ABO/Rh', () => {
  it('sel darah merah: O universal donor, Rh− hanya menerima Rh−', () => {
    expect(compatible({ abo: 'A', rh: '+' }, { abo: 'O', rh: '-', component: 'PRC' })).toBe(true);
    expect(compatible({ abo: 'O', rh: '+' }, { abo: 'A', rh: '+', component: 'PRC' })).toBe(false);
    expect(compatible({ abo: 'O', rh: '-' }, { abo: 'O', rh: '+', component: 'PRC' })).toBe(false);
    expect(compatible({ abo: 'AB', rh: '+' }, { abo: 'B', rh: '+', component: 'PRC' })).toBe(true);
  });

  it('plasma: AB donor universal, O hanya ke O', () => {
    expect(compatible({ abo: 'O', rh: '+' }, { abo: 'AB', rh: '+', component: 'FFP' })).toBe(true);
    expect(compatible({ abo: 'A', rh: '+' }, { abo: 'O', rh: '+', component: 'FFP' })).toBe(false);
  });
});

describe('alur permintaan', () => {
  it('tahap awal fixture: permintaan, crossmatch, siap keluar, transfusi', () => {
    expect(demoBloodRequests().map(stageOf)).toEqual([
      'crossmatch',
      'permintaan',
      'pengeluaran',
      'transfusi',
    ]);
  });

  it('kantong kedaluwarsa, golongan inkompatibel, atau milik pasien lain ditolak', () => {
    const s = state();
    const anisa = req(s, 'bd-01');
    expect(unitGate(anisa, unit(s, 'bu-o3'), DEMO_TODAY)).toBe('BAG_EXPIRED');
    expect(unitGate(anisa, unit(s, 'bu-a3'), DEMO_TODAY)).toBe('ABO_INCOMPATIBLE');
    expect(unitGate(anisa, unit(s, 'bu-a1'), DEMO_TODAY)).toBe('BAG_UNAVAILABLE');
    expect(unitGate(anisa, unit(s, 'bu-ff1'), DEMO_TODAY)).toBe('COMPONENT_MISMATCH');
    expect(unitGate(req(s, 'bd-02'), unit(s, 'bu-o2'), DEMO_TODAY)).toBe('GROUP_REQUIRED');
  });

  it('crossmatch → cek ganda dua petugas berbeda + semua butir → pindai gelang dan kantong → transfusi', () => {
    let s = ok(
      applyBlood(
        state(),
        { type: 'crossmatch', requestId: 'bd-01', unitId: 'bu-o2', result: 'kompatibel' },
        ctx,
      ),
    );
    expect(stageOf(req(s, 'bd-01'))).toBe('pengeluaran');
    const issue = { type: 'keluarkan', requestId: 'bd-01', unitId: 'bu-o1' } as const;
    expect(applyBlood(s, { ...issue, first: ctx.by, second: ctx.by, items: allChecks }, ctx)).toMatchObject({
      code: 'CHECKER_SAME',
    });
    expect(
      applyBlood(
        s,
        { ...issue, first: ctx.by, second: 'Bd. Wina Kartikasari', items: { identitas: true } },
        ctx,
      ),
    ).toMatchObject({ code: 'CHECKLIST_INCOMPLETE' });
    expect(
      applyBlood(s, { ...issue, unitId: 'bu-o4', first: ctx.by, second: 'Bd. Wina', items: allChecks }, ctx),
    ).toMatchObject({ code: 'CROSSMATCH_REQUIRED' });
    s = ok(applyBlood(s, { ...issue, first: ctx.by, second: 'Bd. Wina Kartikasari', items: allChecks }, ctx));
    expect(unit(s, 'bu-o1').status).toBe('dikeluarkan');
    expect(stageOf(req(s, 'bd-01'))).toBe('transfusi');

    const baseline = { tempC: 36.7, systolic: 118, diastolic: 74, pulse: 96 };
    const bed = { type: 'pasang', requestId: 'bd-01', baseline } as const;
    expect(applyBlood(s, { ...bed, wristband: '00-99-99-99', bag: 'KD-261001-031' }, ctx)).toMatchObject({
      code: 'WRONG_PATIENT',
    });
    const rm = req(s, 'bd-01').patient.rm;
    expect(applyBlood(s, { ...bed, wristband: rm, bag: 'KD-261001-044' }, ctx)).toMatchObject({
      code: 'WRONG_BAG',
    });
    expect(
      applyBlood(
        s,
        { ...bed, wristband: '', bag: '', manual: { reason: 'rusak', secondVerifier: 'Ns' } },
        ctx,
      ),
    ).toMatchObject({ code: 'MANUAL_REASON' });
    s = ok(applyBlood(s, { ...bed, wristband: rm, bag: 'KD-261001-031' }, ctx));
    expect(req(s, 'bd-01').transfusion?.vitals).toHaveLength(1);
  });

  it('pemantauan: suhu naik ≥ 1 °C atau gejala → reaksi, transfusi dihentikan', () => {
    expect(reactionCheck({ tempC: 36.8, systolic: 112 }, { tempC: 37.9, systolic: 110 }, [])).toEqual({
      reaction: true,
      reasons: ['Suhu naik 1,1 °C'],
    });
    expect(reactionCheck({ tempC: 36.8, systolic: 112 }, { tempC: 37, systolic: 108 }, []).reaction).toBe(
      false,
    );
    const s = ok(
      applyBlood(
        state(),
        {
          type: 'ttv',
          requestId: 'bd-04',
          label: '1 jam',
          vitals: { tempC: 37, systolic: 110, diastolic: 70, pulse: 94 },
          signs: ['Menggigil'],
        },
        ctx,
      ),
    );
    expect(req(s, 'bd-04').transfusion?.reaction?.signs).toEqual(['Menggigil']);
    expect(stageOf(req(s, 'bd-04'))).toBe('selesai');
    expect(applyBlood(s, { type: 'selesai', requestId: 'bd-04' }, ctx)).toMatchObject({ code: 'STAGE' });
  });

  it('permintaan baru: terima sampel lalu periksa golongan sebelum crossmatch', () => {
    expect(
      applyBlood(state(), { type: 'golongan', requestId: 'bd-02', abo: 'O', rh: '+' }, ctx),
    ).toMatchObject({ code: 'STAGE' });
    let s = ok(applyBlood(state(), { type: 'terima', requestId: 'bd-02' }, ctx));
    s = ok(applyBlood(s, { type: 'golongan', requestId: 'bd-02', abo: 'O', rh: '+' }, ctx));
    expect(stageOf(req(s, 'bd-02'))).toBe('crossmatch');
  });
});
