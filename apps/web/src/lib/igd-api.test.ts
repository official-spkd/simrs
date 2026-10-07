import type { BedBoardApi, EdBoardItem } from '@simrs/shared';
import { describe, expect, it, vi } from 'vitest';
import { connectBoardStream } from './board-stream';
import {
  allocationCandidates,
  complaintOf,
  edRowFromApi,
  manualTargets,
  parseVitals,
  placementOptions,
  transferTargets,
  vitalsForm,
  vitalTiles,
  zoneOfBedCode,
} from './igd-api';
import type { EventSourceLike } from './queue-sse';

const U = (n: number) => `00000000-0000-7000-8000-${String(n).padStart(12, '0')}`;

const item = (over: Partial<EdBoardItem> = {}): EdBoardItem => ({
  encounterId: U(1),
  number: 'IGD-2610-000001',
  patientId: U(2),
  patientName: 'Sulastri Fiktif',
  rm: '00-01-23',
  unidentified: false,
  sex: 'female',
  ageYears: 46,
  arrivalMode: 'ambulans',
  payer: { kind: 'bpjs', name: 'BPJS Kesehatan' },
  doctor: null,
  doctorUserId: null,
  arrivedAt: '2026-10-07T03:00:00.000Z',
  losMinutes: 42,
  status: null,
  zone: null,
  bedId: null,
  bedCode: null,
  triage: null,
  bedRequest: null,
  sep: null,
  ...over,
});

describe('pemetaan papan IGD API ke baris papan', () => {
  it('belum ditriase: zona area triase, status identifikasi, keluhan apa adanya', () => {
    const row = edRowFromApi(item());
    expect(row).toMatchObject({
      zone: 'T',
      status: 'registrasi',
      sex: 'P',
      ageLabel: '46 th',
      guarantor: 'BPJS Kesehatan',
      triageLevel: null,
      chiefComplaint: 'Belum ditriase',
      scenario: false,
    });
  });

  it('sudah ditriase: level + diskriminator sebagai keluhan; tanpa penjamin/umur ditulis apa adanya', () => {
    const t = {
      id: U(9),
      level: 2 as const,
      suggestedLevel: 2 as const,
      maxLevel: 3 as const,
      at: '2026-10-07T03:05:00.000Z',
      vitals: { sbp: 88, dbp: 60, hr: 118, rr: 24, spo2: 95, temp: 37.9, gcs: 15 },
      discriminators: ['nyeri_dada_kardiak' as const],
      reasons: ['Level 2: TD sistolik 88 (< 90)'],
      overrideReason: null,
    };
    const row = edRowFromApi(
      item({ triage: t, payer: null, ageYears: null, sex: 'unknown', zone: 'R', status: 'resusitasi' }),
    );
    expect(row).toMatchObject({
      triageLevel: 2,
      chiefComplaint: 'Nyeri dada khas jantung',
      guarantor: 'Belum ada penjamin',
      ageLabel: 'umur ?',
      sex: '?',
      zone: 'R',
    });
    expect(complaintOf({ triage: { ...t, discriminators: [] } })).toContain('tanda vital');
    const tiles = vitalTiles(t.vitals);
    expect(tiles.find((v) => v.label === 'TD')).toEqual({ label: 'TD', value: '88/60', abnormal: true });
    expect(tiles.find((v) => v.label === 'Suhu')?.value).toBe('37,9');
  });
});

describe('isian tanda vital', () => {
  it('kosong = tidak diukur; koma desimal suhu; angka di luar rentang/bukan angka → null', () => {
    const form = vitalsForm(null);
    expect(parseVitals(form)).toEqual({
      sbp: null,
      dbp: null,
      hr: null,
      rr: null,
      spo2: null,
      temp: null,
      gcs: null,
    });
    expect(parseVitals({ ...form, sbp: '120', temp: '38,5', gcs: '15' })).toMatchObject({
      sbp: 120,
      temp: 38.5,
      gcs: 15,
    });
    expect(parseVitals({ ...form, gcs: '16' })).toBeNull();
    expect(parseVitals({ ...form, hr: '9x' })).toBeNull();
    expect(vitalsForm({ sbp: 120, dbp: 80, hr: 90, rr: 20, spo2: 98, temp: 36.6, gcs: 15 }).temp).toBe(
      '36,6',
    );
  });
});

const bed = (
  id: number,
  code: string,
  status: BedBoardApi['units'][number]['beds'][number]['status'],
  careClass = 'kelas_1',
) => ({
  bedId: U(id),
  code,
  room: code.slice(0, 7),
  careClass,
  status,
  version: 1,
  encounterId: null,
  patientLabel: null,
  since: '2026-10-07T01:00:00.000Z',
});

describe('bed: penempatan IGD, alokasi, transfer, transisi manual', () => {
  const board: BedBoardApi = {
    asOf: '2026-10-07T03:00:00.000Z',
    boardingAlertHours: 4,
    aplicare: [],
    units: [
      { unitId: U(100), code: 'IGD', name: 'IGD', kind: 'igd', beds: [bed(1, 'IGD-R-A', 'siap', '')] },
      {
        unitId: U(101),
        code: 'ANGGREK',
        name: 'Bangsal Anggrek',
        kind: 'rawat_inap',
        beds: [
          bed(2, 'AGR-101-A', 'siap'),
          bed(3, 'AGR-101-B', 'kotor'),
          bed(4, 'AGR-102-A', 'siap', 'kelas_2'),
        ],
      },
      {
        unitId: U(102),
        code: 'ISOLASI',
        name: 'Ruang Isolasi',
        kind: 'rawat_inap',
        beds: [bed(5, 'ISO-101-A', 'siap', 'isolasi')],
      },
    ],
    requests: [],
  };

  it('kandidat alokasi: siap, rawat inap, kelas sama, unit diminta; isolasi → bed isolasi', () => {
    const req = { careClass: 'kelas_1', unitId: null, isolation: false };
    expect(allocationCandidates(board, req).map((c) => c.bed.code)).toEqual(['AGR-101-A']);
    expect(allocationCandidates(board, { ...req, unitId: U(102) })).toEqual([]);
    expect(allocationCandidates(board, { ...req, isolation: true }).map((c) => c.bed.code)).toEqual([
      'ISO-101-A',
    ]);
  });

  it('tujuan transfer: semua bed rawat inap siap selain bed asal; bed IGD tidak', () => {
    expect(transferTargets(board, U(2)).map((c) => c.bed.code)).toEqual(['AGR-102-A', 'ISO-101-A']);
  });

  it('penempatan IGD: bed siap + bed sekarang; zona dari kode bed', () => {
    const beds = [
      { bedId: U(1), code: 'IGD-R-A', room: 'R', status: 'siap' as const, version: 1, encounterId: null },
      { bedId: U(6), code: 'IGD-B-A', room: 'B', status: 'terisi' as const, version: 2, encounterId: U(1) },
      { bedId: U(7), code: 'IGD-K-A', room: 'K', status: 'kotor' as const, version: 3, encounterId: null },
    ];
    expect(placementOptions(beds, U(6)).map((b) => b.code)).toEqual(['IGD-R-A', 'IGD-B-A']);
    expect(zoneOfBedCode('IGD-K-B')).toBe('K');
    expect(zoneOfBedCode('MLT-201-A')).toBeNull();
  });

  it('transisi manual mengikuti registri bersama', () => {
    expect(manualTargets('kotor')).toEqual(['siap', 'dibersihkan', 'rusak']);
    expect(manualTargets('dipesan')).toEqual([]);
    expect(manualTargets('terisi')).toEqual(['pulang']);
  });
});

class FakeSource implements EventSourceLike {
  static all: FakeSource[] = [];
  readyState = 0;
  onopen: EventSourceLike['onopen'] = null;
  onerror: EventSourceLike['onerror'] = null;
  closed = false;
  private listeners = new Map<string, Array<(ev: MessageEvent) => void>>();
  constructor(readonly url: string) {
    FakeSource.all.push(this);
  }
  addEventListener(type: string, fn: (ev: MessageEvent) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  emit(type: string) {
    for (const fn of this.listeners.get(type) ?? []) fn({ data: '{}' } as MessageEvent);
  }
  fail(state: number) {
    this.readyState = state;
    this.onerror?.call(this, new Event('error'));
  }
  close() {
    this.closed = true;
    this.readyState = 2;
  }
}

describe('klien SSE papan (sinyal → muat ulang)', () => {
  it('potret pertama diabaikan, potret berikut (sambung ulang) dan event perubahan memicu muat ulang', () => {
    FakeSource.all = [];
    const onChange = vi.fn();
    const timers: Array<{ fn: () => void; ms: number }> = [];
    const conn = connectBoardStream({
      url: '/klinis/igd/events',
      snapshotEvent: 'ed.board',
      changeEvents: ['ed.status', 'ed.changed'],
      onChange,
      create: (url) => new FakeSource(url),
      setTimer: (fn, ms) => timers.push({ fn, ms }),
      clearTimer: vi.fn(),
    });
    const es = FakeSource.all[0] as FakeSource;
    es.emit('ed.board');
    expect(onChange).not.toHaveBeenCalled();
    es.emit('ed.changed');
    es.emit('ed.status');
    expect(onChange).toHaveBeenCalledTimes(2);
    es.emit('ed.board');
    es.emit('reset');
    expect(onChange).toHaveBeenCalledTimes(4);
    es.fail(2);
    expect(timers[0]?.ms).toBe(2000);
    timers[0]?.fn();
    expect(FakeSource.all).toHaveLength(2);
    conn.close();
    expect(FakeSource.all[1]?.closed).toBe(true);
  });
});
