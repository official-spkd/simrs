import { type Bed, bedBoardSchema, edBoardSchema, triageAssessmentSchema } from '@simrs/shared';
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
  BOARDING_LATE_LABEL,
  BOARDING_TARGET_MINUTES,
  bedCounts,
  edKpis,
  edLosAlert,
  edVitalFlag,
  filterBeds,
  filterEdItems,
  formatLos,
  formatTimer,
  losOverdue,
  canTriage,
  newWalkIn,
  triageBlocker,
  triageNeedsReason,
  triageSaveAllowed,
  wardSummary,
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

  it('ruang hampir penuh mulai 90% (selaras Dasbor); permintaan terlambat = menunggu ≥ 4 jam', () => {
    const ward = { code: 'UJI', name: 'Ruang uji', kelas: 'Kelas 1', service: 'Umum', beds: 10 } as const;
    const beds = (occupied: number): Bed[] =>
      Array.from({ length: 10 }, (_, i) => ({
        code: `UJI-${i + 1}`,
        wardCode: 'UJI',
        status: i < occupied ? 'terisi' : 'siap',
        patientLabel: null,
        encounterId: null,
        note: '',
      }));
    expect(wardSummary(ward, beds(9))).toMatchObject({ percent: 90, nearlyFull: true });
    expect(wardSummary(ward, beds(8))).toMatchObject({ percent: 80, nearlyFull: false });

    // Penanda "Lewat 4 jam" di layar membaca `late`; data dummy harus selaras dengan target boarding.
    const requests = demoBedRequests(demoBeds());
    expect(requests.some((r) => r.late)).toBe(true);
    for (const r of requests) {
      expect([r.id, r.late]).toEqual([r.id, (r.waitMinutes ?? -1) >= BOARDING_TARGET_MINUTES]);
    }
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

  it('gerbang triase di server: turun dari saran wajib alasan ≥ 10 karakter, batas protokol ditolak', () => {
    // Saran dan batas berasal dari data IGD server; kontrak masukan tidak menerima saran dari klien.
    const item = { suggestedLevel: 2 as const, maxLevel: 3 as const };
    expect(triageBlocker(item, 3, '')).toMatch(/wajib disertai alasan klinis/);
    expect(triageBlocker(item, 3, 'singkat')).toMatch(/wajib disertai alasan klinis/);
    expect(triageBlocker(item, 3, 'EKG awal normal, nyeri atipikal')).toBeNull();
    expect(triageBlocker(item, 1, '')).toBeNull();
    expect(triageBlocker(item, 2, '')).toBeNull();
    expect(triageBlocker(item, 4, 'EKG awal normal, nyeri atipikal')).toMatch(/tidak diizinkan protokol/);
    const input = { encounterId: 'kj-x', chosenLevel: 3, overrideReason: null, orders: [] };
    expect(triageAssessmentSchema.safeParse(input).success).toBe(true);
    expect(triageAssessmentSchema.safeParse({ ...input, suggestedLevel: 5 }).success).toBe(false);
    expect(triageNeedsReason(2, 3)).toBe(true);
    expect(triageNeedsReason(2, 2)).toBe(false);
    expect(triageSaveAllowed(2, 4, '   ')).toBe(false);
    expect(triageSaveAllowed(2, 4, 'Nyeri atipikal, EKG normal')).toBe(true);
  });

  it('triase hanya oleh perawat/dokter; petugas pendaftaran tidak', () => {
    expect(canTriage('perawat')).toBe(true);
    expect(canTriage('dokter')).toBe(true);
    expect(canTriage('dokter_residen')).toBe(true);
    expect(canTriage('petugas_pendaftaran')).toBe(false);
    expect(canTriage(null)).toBe(false);
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

  it('lama tinggal lewat batas bertulisan: ≥ 4 jam, atau triase 1–2 menunggu dokter > 10 menit', () => {
    expect(edLosAlert({ triageLevel: 3, status: 'tunggu-bed' }, BOARDING_TARGET_MINUTES - 1)).toBeNull();
    expect(edLosAlert({ triageLevel: 3, status: 'tunggu-bed' }, BOARDING_TARGET_MINUTES)).toBe(
      BOARDING_LATE_LABEL,
    );
    expect(edLosAlert({ triageLevel: null, status: 'triase' }, 300)).toBe('Lewat 4 jam');
    expect(edLosAlert({ triageLevel: 2, status: 'tunggu-dokter' }, 10)).toBeNull();
    expect(edLosAlert({ triageLevel: 1, status: 'tunggu-dokter' }, 11)).toBe('Dokter lewat 10 menit');
    expect(edLosAlert({ triageLevel: 3, status: 'tunggu-dokter' }, 30)).toBeNull();
    expect(edLosAlert({ triageLevel: 2, status: 'pemeriksaan' }, 30)).toBeNull();
    expect(losOverdue({ triageLevel: 4, status: 'observasi' }, 239)).toBe(false);
    // Papan hari demo: hanya Tn. Fajar (B5, boarding 4 j 40 m) yang lewat batas saat dibuka.
    const late = demoEdBoardBase(DEMO_NOW).items.filter((p) => edLosAlert(p, p.losMinutes) !== null);
    expect(late.map((p) => p.bed)).toEqual(['B5']);
  });

  it('tanda vital IGD abnormal menyebut arahnya (tinggi/rendah); normal tanpa penanda', () => {
    expect(edVitalFlag({ label: 'TD', value: '186/104', abnormal: true })).toBe('tinggi');
    expect(edVitalFlag({ label: 'TD', value: '90/60', abnormal: true })).toBe('rendah');
    expect(edVitalFlag({ label: 'TD', value: '90/60', abnormal: false })).toBeNull();
    expect(edVitalFlag({ label: 'Nadi', value: '124', abnormal: true })).toBe('tinggi');
    expect(edVitalFlag({ label: 'Napas', value: '8', abnormal: true })).toBe('rendah');
    expect(edVitalFlag({ label: 'Suhu', value: '38,9', abnormal: true })).toBe('tinggi');
    expect(edVitalFlag({ label: 'Suhu', value: '35,4', abnormal: true })).toBe('rendah');
    expect(edVitalFlag({ label: 'SpO2', value: '91%', abnormal: true })).toBe('rendah');
    expect(edVitalFlag({ label: 'GCS', value: '8', abnormal: true })).toBe('rendah');
    // Tanpa arah yang bisa dipastikan: tetap bertulisan "abnormal".
    expect(edVitalFlag({ label: 'CRT', value: '3 dtk', abnormal: true })).toBe('abnormal');
    expect(edVitalFlag({ label: 'Nadi', value: '—', abnormal: true })).toBe('abnormal');
    const flags = demoEdBoardBase(DEMO_NOW).items.flatMap((p) =>
      p.vitals.filter((v) => v.abnormal).map(edVitalFlag),
    );
    expect(flags.length).toBeGreaterThan(0);
    expect(flags.every((f) => f === 'tinggi' || f === 'rendah')).toBe(true);
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
