import { describe, expect, it } from 'vitest';
import { advance, boarding, type CcState, decisionAlerts, SIM_EVENTS, wardRows } from './command-center';
import { demoQueueBoard } from './demo/fixtures/front-office';
import { demoBeds, demoEdBoardBase, demoWards } from './demo/fixtures/rawat-inap';

const wards = demoWards().map((w) => ({ code: w.code, name: w.name, beds: w.beds }));
const ed = demoEdBoardBase();
const initial: CcState = {
  minute: 0,
  beds: demoBeds().map((b) => ({ code: b.code, wardCode: b.wardCode, status: b.status })),
  ed: ed.items.map((i) => ({
    id: i.encounterId,
    label: i.bed ?? 'triase',
    status: i.status,
    losMinutes: i.losMinutes,
    triageLevel: i.triageLevel,
  })),
  queues: demoQueueBoard().clinics.map((c) => ({
    poliCode: c.poliCode,
    poliName: c.poliName,
    waiting: c.waiting.length,
    current: c.current,
  })),
  ambulances: ed.ambulancesIncoming,
};

describe('I09 · command center', () => {
  it('keterisian rawat inap kelas sama dengan Dasbor direksi (214/260)', () => {
    const rows = wardRows(wards, initial.beds).filter((r) =>
      ['VIP', 'ANGGREK', 'MELATI', 'MAWAR', 'KENANGA'].includes(r.code),
    );
    expect(rows.reduce((n, r) => n + r.occupied, 0)).toBe(214);
    expect(rows.reduce((n, r) => n + r.total, 0)).toBe(260);
  });

  it('alert awal: BOR ICU, pasien IGD menunggu bed (kritis), antrean poli', () => {
    const a = decisionAlerts(initial, wards);
    expect(a.map((x) => x.id)).toEqual(['bor', 'boarding', 'antrean']);
    expect(a.find((x) => x.id === 'bor')?.detail).toMatch(/ICU\/ICCU 92%/);
    expect(a.find((x) => x.id === 'boarding')?.level).toBe('critical');
  });

  it('maju 15 menit: LOS bertambah, antrean berkurang, peristiwa berputar; pasien IGD mendapat bed', () => {
    let s = initial;
    for (let i = 0; i < 3; i++) s = advance(s, i).state;
    expect(s.minute).toBe(45);
    expect(boarding(s.ed)).toHaveLength(0);
    expect(s.queues.every((q) => q.waiting <= 2)).toBe(true);
    const r = advance(s, 3);
    expect(r.event).toBe(SIM_EVENTS[3]?.label);
    expect(r.state.ambulances).toBe(initial.ambulances - 1);
    expect(decisionAlerts(r.state, wards).some((x) => x.id === 'boarding')).toBe(false);
  });
});
