import { bedBoardSchema, edBoardSchema, triageAssessmentSchema } from '@simrs/shared';
import { describe, expect, it } from 'vitest';
import { advanceTo, applyAction, runScenario } from './demo/engine/run';
import type { ScenarioEvent, TaskValue } from './demo/engine/types';
import {
  demoBedRequests,
  demoBeds,
  demoEdBoardBase,
  demoWards,
  SCENARIO_BEDS,
} from './demo/fixtures/rawat-inap';
import { BANGSAL } from './demo/fixtures/rs';
import { DEMO_NOW } from './demo/fixtures/waktu';
import { SCENARIOS } from './demo/skenario';
import {
  bedCounts,
  edKpis,
  filterBeds,
  filterEdItems,
  formatLos,
  formatTimer,
  losOverdue,
  newWalkIn,
  triageNeedsReason,
  triageSaveAllowed,
} from './rawat-inap';
import {
  applyScenarioBeds,
  hartonoBedRequest,
  hartonoEdItem,
  ratnaBedCode,
  ratnaBedRequest,
  stepIndexOf,
  stepState,
} from './rawat-inap-scenario';

/** Jalankan tugas berurutan di langkah aktif skenario (gagal keras bila mesin menolak). */
function play(
  id: keyof typeof SCENARIOS,
  tasks: Array<[string, TaskValue] | 'next'>,
  seq: ScenarioEvent[] = [],
) {
  const def = SCENARIOS[id];
  let cur = seq;
  for (const t of tasks) {
    const R = runScenario(def, cur);
    const r =
      t === 'next'
        ? applyAction(def, cur, { type: 'next' })
        : applyAction(def, cur, { type: 'task', step: R.step, task: t[0], value: t[1] });
    if (!r.ok) throw new Error(`${String(t)}: ${r.error}`);
    cur = r.seq;
  }
  return cur;
}

describe('K05 · tempat tidur', () => {
  it('jumlah bed dan bed terisi per ruang sama dengan BANGSAL (selaras Dasbor), kode bed unik', () => {
    const beds = demoBeds();
    for (const w of BANGSAL) {
      const c = bedCounts(beds.filter((b) => b.wardCode === w.code));
      expect([w.code, c.total, c.occupied]).toEqual([w.code, w.beds, w.occupied]);
    }
    const kelas = BANGSAL.filter((w) => w.kelas.startsWith('Kelas') || w.kelas === 'VIP');
    expect(kelas.reduce((s, w) => s + w.beds, 0)).toBe(260);
    expect(new Set(beds.map((b) => b.code)).size).toBe(beds.length);
    for (const code of SCENARIO_BEDS) expect(beds.some((b) => b.code === code)).toBe(true);
    expect(beds.find((b) => b.code === 'ICU 3')?.status).toBe('siap');
  });

  it('papan bed lolos kontrak ketat; permintaan biasa tidak ditawari bed skenario', () => {
    const beds = demoBeds();
    const requests = demoBedRequests(beds);
    expect(() => bedBoardSchema.parse({ asOf: DEMO_NOW, wards: demoWards(), beds, requests })).not.toThrow();
    for (const r of requests) {
      expect(r.candidates.length).toBeGreaterThan(0);
      for (const c of r.candidates) expect(SCENARIO_BEDS).not.toContain(c.bedCode);
    }
    const f = filterBeds(beds, demoWards(), { ward: 'semua', kelas: 'ICU', status: 'siap' });
    expect(f.map((b) => b.code)).toEqual(['ICU 3']);
  });

  it('permintaan bed Tn. Hartono baru muncul setelah keputusan rawat; alokasi → dipesan → terisi', () => {
    const def = SCENARIOS['igd-ranap'];
    const elektif = runScenario(SCENARIOS['elektif-btn'], []);
    const beforeDispo = advanceTo(def, [], stepIndexOf(runScenario(def, []), 'tata-laksana'));
    if (!beforeDispo.ok) throw new Error(beforeDispo.error);
    expect(hartonoBedRequest(runScenario(def, beforeDispo.seq))).toBeNull();

    const admisi = advanceTo(def, [], stepIndexOf(runScenario(def, []), 'admisi'));
    if (!admisi.ok) throw new Error(admisi.error);
    const R = runScenario(def, admisi.seq);
    const req = hartonoBedRequest(R);
    expect(req).toMatchObject({ from: 'IGD R2', kelas: 'ICU', scenario: 'igd-ranap' });
    expect(req?.candidates.map((c) => c.bedCode)).toEqual(['ICU 3', 'ICU 5']);

    const alloc = play(
      'igd-ranap',
      [
        ['bpjs', true],
        ['alok', 'ICU 3'],
      ],
      admisi.seq,
    );
    const booked = applyScenarioBeds(demoBeds(), runScenario(def, alloc), elektif).find(
      (b) => b.code === 'ICU 3',
    );
    expect(booked).toMatchObject({ status: 'dipesan', encounterId: 'kj-hartono' });
    const moved = play(
      'igd-ranap',
      [
        ['sep', true],
        ['transfer', true],
      ],
      alloc,
    );
    const Rm = runScenario(def, moved);
    expect(hartonoBedRequest(Rm)).toBeNull();
    expect(applyScenarioBeds(demoBeds(), Rm, elektif).find((b) => b.code === 'ICU 3')?.status).toBe('terisi');
    expect(hartonoEdItem(Rm, DEMO_NOW)).toBeNull();
  });

  it('Ny. Ratna: pilihan kelas menentukan bed (VIP 3 / M-210); permintaan selesai saat SEP terbit', () => {
    const def = SCENARIOS['elektif-btn'];
    const igd = runScenario(SCENARIOS['igd-ranap'], []);
    expect(ratnaBedRequest(runScenario(def, []))?.candidates.map((c) => c.bedCode)).toEqual([
      'VIP 3',
      'M-210',
    ]);
    const hak = play('elektif-btn', [
      ['cek', true],
      ['kelas', 'hak'],
    ]);
    expect(ratnaBedCode(runScenario(def, hak))).toBe('M-210');
    const vip = play('elektif-btn', [
      ['cek', true],
      ['kelas', 'vip'],
      ['setuju', true],
      ['sep', true],
    ]);
    const R = runScenario(def, vip);
    expect(ratnaBedRequest(R)).toBeNull();
    expect(applyScenarioBeds(demoBeds(), igd, R).find((b) => b.code === 'VIP 3')).toMatchObject({
      status: 'terisi',
      patientLabel: 'Ny. Ratna Sari',
    });
  });
});

describe('K03 · IGD', () => {
  it('papan IGD lolos kontrak ketat, dengan dan tanpa pasien skenario', () => {
    const board = demoEdBoardBase(DEMO_NOW);
    expect(() => edBoardSchema.parse(board)).not.toThrow();
    const hartono = hartonoEdItem(runScenario(SCENARIOS['igd-ranap'], []), DEMO_NOW);
    expect(() => edBoardSchema.parse({ ...board, items: [...board.items, hartono] })).not.toThrow();
    expect(board.items.length + 1).toBeGreaterThanOrEqual(9);
    expect(new Set(board.items.map((p) => p.encounterId)).size).toBe(board.items.length);
  });

  it('turun dari saran sistem wajib alasan ≥ 10 karakter; naik atau sama tidak', () => {
    const base = { encounterId: 'kj-x', suggestedLevel: 2 as const, orders: [] };
    expect(triageAssessmentSchema.safeParse({ ...base, chosenLevel: 3, overrideReason: null }).success).toBe(
      false,
    );
    expect(
      triageAssessmentSchema.safeParse({ ...base, chosenLevel: 3, overrideReason: 'singkat' }).success,
    ).toBe(false);
    expect(
      triageAssessmentSchema.safeParse({
        ...base,
        chosenLevel: 3,
        overrideReason: 'EKG awal normal, nyeri atipikal',
      }).success,
    ).toBe(true);
    expect(triageAssessmentSchema.safeParse({ ...base, chosenLevel: 1, overrideReason: null }).success).toBe(
      true,
    );
    expect(triageNeedsReason(2, 3)).toBe(true);
    expect(triageNeedsReason(2, 2)).toBe(false);
    expect(triageSaveAllowed(2, 4, '   ')).toBe(false);
    expect(triageSaveAllowed(2, 4, 'Nyeri atipikal, EKG normal')).toBe(true);
  });

  it('KPI, filter zona/level, dan format lama tinggal', () => {
    const items = demoEdBoardBase(DEMO_NOW).items;
    const k = edKpis(items);
    expect(k.total).toBe(items.length);
    expect(k.high).toBe(items.filter((p) => (p.triageLevel ?? 9) <= 2).length);
    expect(k.boarding).toBe(1);
    expect(filterEdItems(items, 'K', 0).every((p) => p.zone === 'K')).toBe(true);
    expect(filterEdItems(items, 'semua', 3).every((p) => p.triageLevel === 3)).toBe(true);
    expect(formatLos(280)).toBe('04.40 j');
    expect(formatTimer(3725)).toBe('01:02:05');
    expect(losOverdue({ triageLevel: 3, status: 'tunggu-bed' }, 241)).toBe(true);
    expect(losOverdue({ triageLevel: 2, status: 'tunggu-dokter' }, 11)).toBe(true);
    expect(
      edBoardSchema.shape.items.element.safeParse(newWalkIn('baru', 2, '2026-10-05T10:50:00+07:00')).success,
    ).toBe(true);
  });

  it('Tn. Hartono tampil sejak skenario dimulai; triase 3 menahan penempatan sampai alasan ditulis', () => {
    const def = SCENARIOS['igd-ranap'];
    const start = hartonoEdItem(runScenario(def, []), DEMO_NOW);
    expect(start).toMatchObject({ status: 'registrasi', triageLevel: null, bed: null, zone: 'T' });

    const seq = play('igd-ranap', [
      ['id', 'ktp'],
      ['gelang', true],
      'next',
      ['ttv', '158/94 · 112 · 24 · 94%'],
      ['level', '3'],
    ]);
    const R = runScenario(def, seq);
    const tr = stepState(R, 'triase', 7);
    expect(tr.tasks.alasan).toMatchObject({ visible: true, enabled: true });
    expect(tr.tasks.bed?.enabled).toBe(false);
    expect(applyAction(def, seq, { type: 'task', step: R.step, task: 'bed', value: true }).ok).toBe(false);
    expect(hartonoEdItem(R, DEMO_NOW)).toMatchObject({ triageLevel: 3, status: 'triase' });

    const placed = play(
      'igd-ranap',
      [
        ['alasan', 'EKG awal tanpa elevasi ST'],
        ['bed', true],
      ],
      seq,
    );
    const item = hartonoEdItem(runScenario(def, placed), DEMO_NOW);
    expect(item).toMatchObject({ bed: 'R2', zone: 'R', status: 'pemeriksaan' });
    expect(item?.vitals[0]).toMatchObject({ label: 'TD', value: '158/94', abnormal: true });
  });
});
